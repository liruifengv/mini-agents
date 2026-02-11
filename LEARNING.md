# Learning Notes — 边写 Agent 边学习

## 1. 内部消息抽象（UI Message）

我们设计了一套统一的内部消息类型，作为 Agent 循环和不同 LLM API 之间的桥梁。

### Message

```typescript
type Message = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<Record<string, unknown>>;
  thinking?: string | null;                // 推理文本（展示用）
  reasoningItems?: ReasoningItem[] | null; // 结构化推理（回传用，带 id）
  toolCalls?: ToolCall[] | null;           // 工具调用列表
  callId?: string | null;                  // tool 消息的关联 ID
  name?: string | null;                    // tool 角色名称
};
```

### ToolCall

```typescript
interface ToolCall {
  id?: string;     // item 自身 ID（Responses API 需要回传）
  callId: string;  // 关联 ID（用于匹配工具执行结果）
  type: 'function';
  function: { name: string; arguments: Record<string, unknown> };
}
```

**为什么有两个 ID？**

| API | item ID | 关联 ID | 说明 |
|-----|---------|---------|------|
| Anthropic | — | `block.id` | 只有一个 ID，既是 item ID 也是关联 ID |
| OpenAI Responses | `id` | `call_id` | 两个不同的 ID |

统一抽象：`callId` 存关联 ID（必填），`id` 存 item ID（可选）。

### ReasoningItem

```typescript
interface ReasoningItem {
  id: string;      // reasoning item 的唯一 ID（回传必须）
  summary: string; // 推理摘要文本
}
```

`thinking` 是拼接后的纯文本，用于展示；`reasoningItems` 保留原始结构和 ID，用于回传 API。

### LLMResponse

```typescript
type LLMResponse = {
  content: string;
  thinking: string | null;
  reasoningItems?: ReasoningItem[] | null;
  toolCalls: ToolCall[] | null;
  finishReason: string;
  usage?: TokenUsage | null;
  responseId?: string | null;  // Responses API 的 response ID
};
```

---

## 2. Anthropic Messages API

### 请求结构

```
client.messages.create({
  model, max_tokens, thinking,
  system: "...",           ← system 消息单独传
  messages: MessageParam[],
  tools: [{ name, description, input_schema }],
})
```

- system 消息从 messages 数组中提取出来，作为独立的 `system` 参数
- tool result 用 `role: 'user'` + `content: [{ type: 'tool_result', tool_use_id, content }]`
- assistant 消息的内容是 ContentBlock 数组，可以混合 thinking / text / tool_use

### 响应结构

```
response.content = ContentBlock[]   ← 数组，按类型区分
  - { type: 'thinking', thinking: '...' }
  - { type: 'text', text: '...' }
  - { type: 'tool_use', id, name, input }
```

### 转换映射

#### Message → Anthropic API（发送）

| 内部 Message | Anthropic API |
|---|---|
| `role: 'system'` | 提取到 `system` 参数 |
| `role: 'user'` | `{ role: 'user', content: '...' }` |
| `role: 'assistant'`（纯文本） | `{ role: 'assistant', content: '...' }` |
| `role: 'assistant'`（含 thinking/toolCalls） | `{ role: 'assistant', content: ContentBlock[] }`，包含 thinking + text + tool_use 块 |
| `role: 'tool'` | `{ role: 'user', content: [{ type: 'tool_result', tool_use_id: callId, content }] }` |

#### Anthropic API → LLMResponse（接收）

| Anthropic ContentBlock | LLMResponse 字段 |
|---|---|
| `{ type: 'text', text }` | `content` += text |
| `{ type: 'thinking', thinking }` | `thinking` += thinking |
| `{ type: 'tool_use', id, name, input }` | `toolCalls[]` ← `{ callId: id, function: { name, arguments: input } }` |

### 工具 Schema

```json
{ "name": "xxx", "description": "...", "input_schema": { ... } }
```

---

## 3. OpenAI Responses API

### 请求结构

```
client.responses.create({
  model, max_output_tokens, reasoning,
  instructions: "...",     ← system 消息单独传
  input: ResponseInputItem[],
  tools: [{ type: 'function', name, description, parameters, strict }],
})
```

- system 消息提取到 `instructions` 参数
- input 是一个**扁平的 item 数组**，不同类型的 item 混在一起
- 工具 schema 是扁平格式（对比 Chat Completions 的嵌套 `{ type: 'function', function: { ... } }`）

### 响应结构

```
response.output = ResponseOutputItem[]   ← 扁平数组，按 type 区分
  - { type: 'reasoning', id, summary: [{ type: 'summary_text', text }] }
  - { type: 'message', id, role: 'assistant', content: [{ type: 'output_text', text }] }
  - { type: 'function_call', id, call_id, name, arguments: '...' }

response.status = 'completed' | 'incomplete' | 'failed' | 'cancelled'
response.usage = { input_tokens, output_tokens, total_tokens }
```

### 转换映射

#### Message → Responses API Input（发送）

| 内部 Message | Responses API Input Item |
|---|---|
| `role: 'system'` | 提取到 `instructions` 参数 |
| `role: 'user'` | `{ role: 'user', content: '...' }` (EasyInputMessage) |
| `role: 'assistant'` 的 reasoningItems | 每个 → `{ type: 'reasoning', id: ri.id, summary: [{ type: 'summary_text', text }] }` |
| `role: 'assistant'` 的 toolCalls | 每个 → `{ type: 'function_call', id: tc.id, call_id: tc.callId, name, arguments: JSON.stringify(...), status: 'completed' }` |
| `role: 'assistant'` 的 content | `{ role: 'assistant', content: '...' }` (EasyInputMessage) |
| `role: 'tool'` | `{ type: 'function_call_output', call_id: callId, output: '...' }` |

**注意**：一条 assistant Message 会展开为多个 input items（reasoning + function_call + message）。

#### Responses API Output → LLMResponse（接收）

| Responses API Output Item | LLMResponse 字段 |
|---|---|
| `{ type: 'message' }` → content[].text | `content` += text |
| `{ type: 'reasoning', id, summary }` | `thinking` += summary text；`reasoningItems[]` ← `{ id, summary }` |
| `{ type: 'function_call', id, call_id, name, arguments }` | `toolCalls[]` ← `{ id, callId: call_id, function: { name, arguments: JSON.parse(...) } }` |

Status 映射：`completed → stop`，`incomplete → length`，`failed → error`

Usage 映射：`input_tokens → promptTokens`，`output_tokens → completionTokens`

### 工具 Schema

```json
{ "type": "function", "name": "xxx", "description": "...", "parameters": { ... }, "strict": null }
```

---

## 4. Agent 循环中的消息流

一个完整的 tool calling 多轮对话：

```
messages = [
  { role: 'system', content: 'You are helpful.' },
  { role: 'user', content: '北京天气怎么样' },
]

→ LLM 返回 LLMResponse:
    toolCalls: [{ id: 'fc_001', callId: 'call_abc', function: { name: 'get_weather', arguments: { city: '北京' } } }]
    reasoningItems: [{ id: 'rs_001', summary: '用户问天气，需要调用工具' }]

→ Agent 构建 assistant message 并追加:
  { role: 'assistant', content: '', thinking: '...', reasoningItems: [...], toolCalls: [...] }

→ Agent 执行工具，构建 tool message 并追加:
  { role: 'tool', content: '晴天 25°C', callId: 'call_abc', name: 'get_weather' }

→ 再次调用 LLM，此时 messages 包含完整的上下文
→ LLM 返回最终文本回复
```

### 关联 ID 的流转

```
LLM 响应:  function_call.call_id = "call_abc"
                  ↓
Agent:     toolCall.callId = "call_abc"
                  ↓
Message:   { role: 'tool', callId: "call_abc" }
                  ↓
下一轮请求: function_call_output.call_id = "call_abc"  ← 关联上了
```

---

## 5. 三种 API 的关键差异对比

| 特性 | Anthropic Messages | OpenAI Responses |
|------|-------------------|-----------------|
| system 消息 | 独立 `system` 参数 | 独立 `instructions` 参数 |
| 消息结构 | `messages: MessageParam[]`（按 role 分） | `input: ResponseInputItem[]`（扁平 item 数组） |
| assistant 回传 | 一条消息，content 是 ContentBlock[] | 展开为多个独立 items（reasoning + function_call + message） |
| tool result | `role: 'user'` + `tool_result` 块 | `{ type: 'function_call_output' }` item |
| tool call ID | 单个 `id`（block.id） | 双 ID：`id`（item ID）+ `call_id`（关联 ID） |
| reasoning 回传 | thinking block 在 content 数组中 | 独立 reasoning item（需要带 id） |
| tool call arguments | `input: object`（已解析） | `arguments: string`（JSON 字符串，需 parse/stringify） |
| 工具 schema | `{ name, description, input_schema }` | `{ type: 'function', name, description, parameters, strict }` |
| 停止原因 | `stop_reason: 'end_turn' \| 'tool_use' \| ...` | `status: 'completed' \| 'incomplete' \| ...` |

---

## 6. Agent Loop 设计

### 核心循环流程

Agent Loop 是 Agent 与 LLM 多轮交互的核心机制，实现**观察-思考-行动**循环：

```
┌─────────────────────────────────────────────────────────────┐
│                         Agent Loop                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │  1. Generate │───→│  2. Parse    │───→│ 3. Execute   │  │
│  │  调用 LLM    │    │  解析响应    │    │  执行工具    │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│         ↑                                       │           │
│         └───────────────────────────────────────┘           │
│                    (如果有 toolCalls)                       │
│                          否则结束                           │
└─────────────────────────────────────────────────────────────┘
```

### 消息生命周期

```typescript
// 1. 初始化：system + user 消息
messages = [
  { role: 'system', content: systemPrompt },
  { role: 'user', content: userInput },
];

// 2. LLM 返回 assistant 消息（可能包含 toolCalls）
messages.push({
  role: 'assistant',
  content: response.content,
  thinking: response.thinking,
  toolCalls: response.toolCalls,  // 如果有工具调用
});

// 3. 执行工具，添加 tool 消息
messages.push({
  role: 'tool',
  content: toolResult,
  callId: toolCall.callId,  // 关键：关联 assistant 的 toolCalls
  name: toolCall.function.name,
});

// 4. 再次调用 LLM，循环继续...
```

### AgentMessageEvent 流式输出

Agent 使用 `AsyncGenerator` 实现流式事件输出，让调用方实时了解执行状态：

```typescript
type AgentMessageEvent =
  | { type: 'thinking'; thinking: string; content: string }
  | { type: 'toolCall'; toolCall: ToolCall }
  | { type: 'toolResult'; toolCall: ToolCall; result: ToolResult }
  | { type: 'assistantMessage'; content: string }
  | { type: 'cancelled' }
  | { type: 'summarized'; beforeTokens: number; afterTokens: number };

async *run(options?: RunOptions): AsyncGenerator<AgentMessageEvent, string, void> {
  while (step < this.maxSteps) {
    // 实时 yield 事件
    yield { type: 'thinking', thinking, content };
    yield { type: 'toolCall', toolCall };
    yield { type: 'toolResult', toolCall, result };
    // ...
  }
}
```

**使用方式**：
```typescript
const agent = new Agent(llm, systemPrompt, tools);
for await (const event of agent.run()) {
  switch (event.type) {
    case 'thinking':
      console.log('🤔 Thinking:', event.thinking);
      break;
    case 'toolCall':
      console.log('🔧 Calling:', event.toolCall.function.name);
      break;
    case 'toolResult':
      console.log('✅ Result:', event.result.content);
      break;
  }
}
```

---

## 8. Token 计算与自动摘要

### Token 计数

使用 `gpt-tokenizer` 库进行 token 计数，与 OpenAI 的 tiktoken 兼容：

```typescript
import { encode } from 'gpt-tokenizer';

export function countTokens(text: string): number {
  return encode(text).length;
}
```

### 智能截断策略

当消息过长需要截断时，采用**头尾保留策略**：

```typescript
export function truncateTextByTokens(
  text: string,
  maxTokens: number,
  options: { headTokens?: number; tailTokens?: number } = {}
): string {
  const tokens = encode(text);
  if (tokens.length <= maxTokens) return text;

  const headTokens = options.headTokens ?? Math.floor(maxTokens * 0.7);
  const tailTokens = options.tailTokens ?? Math.floor(maxTokens * 0.3);

  const head = tokens.slice(0, headTokens);
  const tail = tokens.slice(-tailTokens);

  return decode([...head, ellipsisToken, ...tail]);
}
```

**设计思考**：保留头部（上下文）和尾部（最新内容），中间用省略号连接，避免丢失关键信息。

### 自动摘要机制

当会话消息超过 token 阈值时，触发 LLM 驱动的摘要：

```typescript
// 保留的消息结构
{
  system: string;        // 系统提示词
  summary: string;       // LLM 生成的历史摘要
  recent: Message[];     // 最近 N 条完整消息
}
```

**摘要提示词设计**：
- 要求 LLM 保留关键信息（用户意图、重要结论、待办事项）
- 丢弃细节（具体代码片段、中间思考过程）
- 保持时间线清晰（使用 "首先...然后...最后..." 结构）

---

## 9. Skill 系统设计

### 核心概念

Skill 是**渐进式披露**的工具——Agent 初始不知道 Skill 详情，需要时通过 `GetSkillTool` 获取。

```
┌─────────────────────────────────────────┐
│  1. 系统提示词告知可用的 Skill 列表       │
│     （只有名称和一句话描述）              │
├─────────────────────────────────────────┤
│  2. Agent 调用 GetSkillTool 获取详情      │
│     （返回完整的使用指南）                │
├─────────────────────────────────────────┤
│  3. Agent 根据指南使用 Skill             │
│     （如使用特定工具组合完成代码审查）     │
└─────────────────────────────────────────┘
```

### Skill 文件格式（SKILL.md）

使用 front-matter + markdown 正文：

```yaml
---
name: code_review
description: 执行代码审查
version: 1.0.0
---

## 使用指南

1. 使用 ReadTool 读取目标文件
2. 分析代码风格和潜在问题
3. 提供改进建议

## 示例

...示例代码...
```

### 实现要点

1. **动态发现**：运行时扫描 `skills/` 目录加载所有 SKILL.md
2. **懒加载**：仅在 Agent 调用 `GetSkillTool` 时才读取完整内容
3. **系统提示词注入**：启动时将 Skill 列表注入到 system message

---
