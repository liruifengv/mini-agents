# 低层实施方案：refactor-agent-ts

> 生成时间：2026-02-14
> 决策基线：clarifications.md 头脑风暴决策（轻量路径）
> 约束级别：SHOULD — 不应偏离决策摘要

---

## 1. 范围与对齐

### 目标

将 `packages/mini-agents/src/agent/index.ts`（401 行单文件）按职责拆分为 5 个文件，Agent 类变薄为门面（facade），仅编排主循环。

### 非目标

- 不涉及 REFACTOR_DESIGN.md 中的新架构（流式 API、事件系统、createAgent 工厂等）
- 不新增模块级单元测试
- 不改变对外 API 签名（constructor / addUserMessage / run）
- 不变更 `messages` 字段的 public 可见性
- 不修改 `maxSteps = 50` 硬编码

### 关键约束

1. **对外 API 零变化**：`Agent` 类的构造函数签名、`addUserMessage` 签名、`run` 返回类型完全不变
2. **导出路径不变**：`import { Agent, AgentMessageEvent, RunOptions } from '../../src/agent'` 继续有效
3. **现有测试全绿**：`cancel.test.ts`（9 用例）和 `summarize.test.ts`（8 用例）无需任何修改即可通过
4. **测试中的半公开方法访问**：`agent._estimateTokens()` 和 `agent._summarizeMessages()` 仍可从 Agent 实例上调用（通过代理方法或直接暴露）

### 假设

- A1：测试通过 `(agent as any)._apiTotalTokens = 200000` 直接访问私有字段，重构后此路径仍需可用
- A2：测试通过 `agent.messages.push(...)` 直接修改 messages 数组，重构后仍需可用

---

## 2. 详细设计

### 2.1 文件结构

重构后 `src/agent/` 目录结构：

```
src/agent/
├── index.ts           # Agent 类（门面）+ 统一导出
├── types.ts           # AgentMessageEvent、RunOptions 类型定义
├── summarizer.ts      # 摘要相关：estimateTokens、summarizeMessages、createSummary
├── cancellation.ts    # 取消相关：checkCancelled、cleanupIncompleteMessages、generateWithSignal
└── tool-executor.ts   # 工具执行：executeTool
```

### 2.2 types.ts — 类型定义

**目标**：将 Agent 相关的类型定义从 `index.ts` 提取到独立文件，解除循环依赖。

**文件内容**：

```typescript
// src/agent/types.ts

import type { ToolCall } from '../types';
import type { ToolResult } from '../tools';

/**
 * Agent 运行选项
 */
export interface RunOptions {
  /** 取消信号，用于中止 Agent 执行 */
  signal?: AbortSignal;
}

/**
 * Agent 执行步骤事件类型
 */
export type AgentMessageEvent =
  | { type: 'thinking'; thinking: string | null | undefined; content: string }
  | { type: 'toolCall'; toolCall: ToolCall }
  | { type: 'toolResult'; toolCall: ToolCall; result: ToolResult }
  | { type: 'assistantMessage'; content: string }
  | { type: 'cancelled' }
  | { type: 'summarized'; beforeTokens: number; afterTokens: number };
```

**变更点**：

- 从 `index.ts` 剪切 `RunOptions`（第 8-11 行）和 `AgentMessageEvent`（第 16-22 行）
- 无逻辑变更，纯粹移动

**边界条件**：无

### 2.3 summarizer.ts — 摘要模块

**目标**：封装 token 估算和消息摘要压缩的全部逻辑。

**函数签名**：

```typescript
// src/agent/summarizer.ts

import type { ILLMClient, Message } from '../types';
import type { AgentMessageEvent } from './types';

/**
 * 估算消息列表的总 token 数
 */
export function estimateTokens(messages: Message[]): number;

/**
 * 检查是否需要摘要，如果需要则执行消息压缩
 *
 * @param messages - 当前消息列表
 * @param tokenLimit - token 阈值
 * @param apiTotalTokens - API 报告的 token 总数
 * @param skipNextTokenCheck - 防抖标志
 * @param llmClient - LLM 客户端（用于生成摘要）
 * @returns { event, messages, skipNextTokenCheck }
 *   - event 为 null 表示未执行摘要（防抖跳过或 token 未超限）
 *   - event 非 null 表示执行了摘要
 *   - 始终返回对象，调用者无需判空
 */
export async function summarizeMessages(params: {
  messages: Message[];
  tokenLimit: number;
  apiTotalTokens: number;
  skipNextTokenCheck: boolean;
  llmClient: ILLMClient;
}): Promise<{
  event: AgentMessageEvent | null;   // null 表示未摘要
  messages: Message[];               // 可能是原数组引用或新数组
  skipNextTokenCheck: boolean;       // 更新后的防抖标志
}>;
```

**设计说明**：

- `estimateTokens` 是纯函数，接收 `Message[]`，返回 `number`。与当前 `_estimateTokens()` 逻辑完全一致。
- `summarizeMessages` 接收所有必要的状态作为参数（不持有 Agent 引用），返回新的 messages 数组和更新后的防抖标志。这是纯函数风格 —— 不修改传入的 messages，而是返回新数组。
- 内部辅助函数 `createSummary(llmClient, executionMessages, roundNum)` 不导出，作为模块私有函数。

**内部辅助函数**：

```typescript
/**
 * 调用 LLM 生成单轮执行过程的摘要（模块私有）
 * 失败时降级为简单文本拼接
 */
async function createSummary(
  llmClient: ILLMClient,
  executionMessages: Message[],
  roundNum: number
): Promise<string>;
```

**对 Agent 类的影响**：

- Agent 类中 `_estimateTokens()` 方法变为：调用 `estimateTokens(this.messages)` 的代理方法
- Agent 类中 `_summarizeMessages()` 方法变为：调用 `summarizeMessages(...)` 并更新自身状态的代理方法
- `_createSummary()` 从 Agent 类中完全移除

### 2.4 cancellation.ts — 取消模块

**目标**：封装 AbortSignal 相关的检查、清理和包装逻辑。

**函数签名**：

```typescript
// src/agent/cancellation.ts

import type { ILLMClient, LLMResponse, Message, Tool } from '../types';

/**
 * 检查是否已被取消
 */
export function checkCancelled(signal?: AbortSignal): boolean;

/**
 * 清理不完整的 assistant 消息及其后续 tool 消息
 * 返回清理后的 messages 数组（截断到最后一条完整 assistant 之前）
 */
export function cleanupIncompleteMessages(messages: Message[]): Message[];

/**
 * 将 LLM generate 调用与 AbortSignal 关联
 * 当 signal 触发时立即 reject，不必等待 API 响应返回
 */
export function generateWithSignal(
  llmClient: ILLMClient,
  messages: Message[],
  tools: Tool[],
  signal?: AbortSignal
): Promise<LLMResponse>;
```

**设计说明**：

- `checkCancelled` 是纯函数：`signal?.aborted === true`
- `cleanupIncompleteMessages` 是纯函数，接收 messages 返回新数组（slice）。注意：不修改原数组，返回截断后的新引用。
- `generateWithSignal` 将当前 Agent 私有方法的逻辑提取出来，接收 `llmClient`、`messages`、`tools`、`signal` 作为参数。内部仍然使用 Promise 竞争模式。

**对 Agent 类的影响**：

- `_checkCancelled()` 从 Agent 中移除，run() 中直接调用 `checkCancelled(signal)`
- `_cleanupIncompleteMessages()` 从 Agent 中移除，run() 中调用 `this.messages = cleanupIncompleteMessages(this.messages)`
- `_generateWithSignal()` 从 Agent 中移除，run() 中调用 `generateWithSignal(this.llmClient, this.messages, this.tools, signal)`

### 2.5 tool-executor.ts — 工具执行模块

**目标**：封装工具查找、执行和异常包装逻辑。

**函数签名**：

```typescript
// src/agent/tool-executor.ts

import type { Tool, ToolResult } from '../tools';

/**
 * 执行单个工具调用
 * 包括：工具查找、参数传递、异常捕获与包装
 *
 * @param tools - 已注册的工具列表
 * @param functionName - 要执行的工具名称
 * @param functionArgs - 工具参数
 * @returns 工具执行结果（永远不抛异常，错误封装在 ToolResult 中）
 */
export async function executeTool(
  tools: Tool[],
  functionName: string,
  functionArgs: Record<string, unknown>
): Promise<ToolResult>;
```

**设计说明**：

- 这是一个纯函数，封装了 `run()` 方法中第 340-361 行的逻辑
- 工具查找：`tools.find(t => t.name === functionName)`
- 未找到工具：返回 `{ success: false, content: '', error: 'Unknown tool: xxx' }`
- 执行异常：捕获所有异常，转换为 `{ success: false, content: '', error: 'Tool execution failed: ...' }`
- **永远不抛异常**，所有错误都封装在 `ToolResult` 中

**对 Agent 类的影响**：

- run() 中工具执行的 if-else-try-catch 块（约 22 行）替换为一行 `executeTool(this.tools, functionName, functionArgs)` 调用

### 2.6 index.ts — Agent 门面类（重构后）

**目标**：Agent 类仅保留状态持有 + 主循环编排 + 代理方法（为测试兼容性）。

**重构后结构**：

```typescript
// src/agent/index.ts

// 重新导出类型（保持导入路径兼容）
export type { RunOptions, AgentMessageEvent } from './types';

// 导入拆分后的模块
import type { RunOptions, AgentMessageEvent } from './types';
import { estimateTokens, summarizeMessages } from './summarizer';
import { checkCancelled, cleanupIncompleteMessages, generateWithSignal } from './cancellation';
import { executeTool } from './tool-executor';
import type { Tool, ToolResult } from '../tools';
import type { ILLMClient, LLMResponse, Message, ToolCall } from '../types';

export class Agent {
  private llmClient: ILLMClient;
  private tools: Tool[];
  private maxSteps = 50;
  private tokenLimit: number;
  _apiTotalTokens = 0;                  // 需保持可被测试通过 (agent as any) 访问
  private _skipNextTokenCheck = false;
  messages: Message[];                    // public，测试中直接访问

  constructor(
    llmClient: ILLMClient,
    systemPrompt: string,
    tools: Tool[],
    options?: { tokenLimit?: number }
  ) {
    // ... 与现有实现完全一致
  }

  addUserMessage(message: string) {
    // ... 与现有实现完全一致
  }

  /**
   * 代理方法：估算 token（测试兼容）
   */
  _estimateTokens(): number {
    return estimateTokens(this.messages);
  }

  /**
   * 代理方法：摘要消息（测试兼容）
   * summarizeMessages 始终返回对象，无需判空
   */
  async _summarizeMessages(): Promise<AgentMessageEvent | null> {
    const result = await summarizeMessages({
      messages: this.messages,
      tokenLimit: this.tokenLimit,
      apiTotalTokens: this._apiTotalTokens,
      skipNextTokenCheck: this._skipNextTokenCheck,
      llmClient: this.llmClient,
    });
    this.messages = result.messages;
    this._skipNextTokenCheck = result.skipNextTokenCheck;
    return result.event;
  }

  /**
   * 运行 Agent，返回 AsyncGenerator 以流式输出每个步骤
   */
  async *run(options?: RunOptions): AsyncGenerator<AgentMessageEvent, string, void> {
    const signal = options?.signal;
    let step = 0;
    while (step < this.maxSteps) {
      try {
        // 检查点 1：每步开始前
        if (checkCancelled(signal)) {
          this.messages = cleanupIncompleteMessages(this.messages);
          yield { type: 'cancelled' };
          return 'Task cancelled by user.';
        }

        // 检查是否需要摘要压缩消息
        const summarizeEvent = await this._summarizeMessages();
        if (summarizeEvent) {
          yield summarizeEvent;
        }

        const response = await generateWithSignal(
          this.llmClient, this.messages, this.tools, signal
        );

        // 更新 API 报告的 token 总数
        if (response.usage) {
          this._apiTotalTokens = response.usage.totalTokens;
        }

        const assistantMessage: Message = {
          role: 'assistant',
          content: response.content,
          thinking: response.thinking,
          reasoningItems: response.reasoningItems,
          toolCalls: response.toolCalls,
        };
        this.messages.push(assistantMessage);

        // 发送 thinking 事件
        if (response.thinking) {
          yield { type: 'thinking', thinking: response.thinking, content: response.content };
        }

        // 发送 assistantMessage 事件
        if (response.content && !response.toolCalls) {
          yield { type: 'assistantMessage', content: response.content };
        }

        // 如果没有工具调用，任务完成
        if (!response.toolCalls) {
          return response.content;
        }

        // 检查点 2：LLM 返回后、执行工具前
        if (checkCancelled(signal)) {
          this.messages = cleanupIncompleteMessages(this.messages);
          yield { type: 'cancelled' };
          return 'Task cancelled by user.';
        }

        // 处理工具调用
        for (const toolCall of response.toolCalls) {
          yield { type: 'toolCall', toolCall };

          const result = await executeTool(
            this.tools,
            toolCall.function.name,
            toolCall.function.arguments
          );

          yield { type: 'toolResult', toolCall, result };

          const toolMsg: Message = {
            role: 'tool',
            content: result.success ? result.content : `Error: ${result.error}`,
            callId: toolCall.callId,
            name: toolCall.function.name,
          };
          this.messages.push(toolMsg);

          // 检查点 3：每个工具执行完后
          if (checkCancelled(signal)) {
            this.messages = cleanupIncompleteMessages(this.messages);
            yield { type: 'cancelled' };
            return 'Task cancelled by user.';
          }
        }

        step += 1;
      } catch (error) {
        if (signal?.aborted) {
          yield { type: 'cancelled' };
          return 'Task cancelled by user.';
        }
        throw error;
      }
    }

    return `Task couldn't be completed after ${this.maxSteps} steps.`;
  }
}
```

### 2.7 _summarizeMessages 代理方法的防抖逻辑处理

**关键细节**：当前 `_summarizeMessages` 方法中防抖标志 `_skipNextTokenCheck` 的重置逻辑在方法内部（第 118-121 行）。提取到 `summarizeMessages` 纯函数后，需要确保：

- 当 `skipNextTokenCheck` 为 `true` 时，`summarizeMessages` 返回 `null`，但外层需知道要重置标志
- **解决方案**：`summarizeMessages` 函数在防抖跳过时也返回一个结构（而非 null），让调用者知道标志需要重置

**修正后的 summarizeMessages 返回类型**：

```typescript
export async function summarizeMessages(params: {
  messages: Message[];
  tokenLimit: number;
  apiTotalTokens: number;
  skipNextTokenCheck: boolean;
  llmClient: ILLMClient;
}): Promise<{
  event: AgentMessageEvent | null;   // null 表示未摘要
  messages: Message[];               // 可能是原数组引用或新数组
  skipNextTokenCheck: boolean;       // 更新后的防抖标志
}>;
```

当防抖跳过时，返回 `{ event: null, messages: params.messages, skipNextTokenCheck: false }`。
当 token 未超限时，返回 `{ event: null, messages: params.messages, skipNextTokenCheck: params.skipNextTokenCheck }`。
当执行摘要后，返回 `{ event: { type: 'summarized', ... }, messages: newMessages, skipNextTokenCheck: true }`。

这样 Agent 的代理方法更简洁：

```typescript
async _summarizeMessages(): Promise<AgentMessageEvent | null> {
  const result = await summarizeMessages({
    messages: this.messages,
    tokenLimit: this.tokenLimit,
    apiTotalTokens: this._apiTotalTokens,
    skipNextTokenCheck: this._skipNextTokenCheck,
    llmClient: this.llmClient,
  });
  this.messages = result.messages;
  this._skipNextTokenCheck = result.skipNextTokenCheck;
  return result.event;
}
```

### 2.8 失败模式与回滚

| 失败场景 | 处理方式 |
|---------|---------|
| 拆分后导入路径错误 | 编译时即暴露；`pnpm check` 捕获 |
| 测试引用 `(agent as any)._apiTotalTokens` 失效 | 将 `_apiTotalTokens` 从 private 改为无访问修饰符（TypeScript 运行时无实际限制，但类型层面允许 `as any` 访问） |
| `agent._estimateTokens()` 测试调用失效 | 保留为 Agent 上的代理方法 |
| 重构引入行为差异导致测试失败 | 逐个比对 run() 执行路径，单步调试 |
| 回滚 | `git revert` 单次提交即可完全回滚 |

---

## 3. 实施步骤与任务拆解

### T1：创建 types.ts

**目标**：将 `RunOptions` 和 `AgentMessageEvent` 类型定义移到独立文件。

**影响范围**：
- 新增文件：`src/agent/types.ts`
- 修改文件：`src/agent/index.ts`（删除类型定义，改为 re-export）

**具体操作**：
1. 创建 `src/agent/types.ts`，写入 `RunOptions` 和 `AgentMessageEvent` 定义
2. 在 `src/agent/index.ts` 顶部添加 `export type { RunOptions, AgentMessageEvent } from './types';`
3. 删除 `index.ts` 中原始的 `RunOptions`（第 8-11 行）和 `AgentMessageEvent`（第 16-22 行）定义
4. `index.ts` 内部使用改为 `import type { RunOptions, AgentMessageEvent } from './types';`

**验收标准**：
- `pnpm check` 通过
- `pnpm test` 全绿
- `import { AgentMessageEvent, RunOptions } from '../../src/agent'` 在测试中仍有效

### T2：创建 summarizer.ts

**目标**：将 token 估算和摘要逻辑提取为独立模块。

**影响范围**：
- 新增文件：`src/agent/summarizer.ts`
- 修改文件：`src/agent/index.ts`（移除方法实现，改为代理调用）

**具体操作**：
1. 创建 `src/agent/summarizer.ts`，实现以下函数：
   - `estimateTokens(messages: Message[]): number` — 从 `_estimateTokens` 提取
   - `summarizeMessages(params): Promise<{event, messages, skipNextTokenCheck}>` — 从 `_summarizeMessages` 提取
   - `createSummary(llmClient, executionMessages, roundNum): Promise<string>` — 从 `_createSummary` 提取（不导出）
2. 修改 `index.ts` 中 Agent 类：
   - 移除 `_estimateTokens` 方法体，替换为代理：`return estimateTokens(this.messages);`
   - 移除 `_summarizeMessages` 方法体，替换为代理调用并更新状态
   - 完全移除 `_createSummary` 方法
3. 添加 `import { estimateTokens, summarizeMessages } from './summarizer';`

**验收标准**：
- `summarize.test.ts` 全部 8 个用例通过
- `agent._estimateTokens()` 返回值与重构前一致
- `agent._summarizeMessages()` 行为与重构前一致（包括防抖、降级）
- `_createSummary` 的 LLM 调用失败降级行为通过 `summarize.test.ts` 间接覆盖（摘要后的 messages 内容验证即可，无需为 `_createSummary` 单独新增测试）

### T3：创建 cancellation.ts

**目标**：将取消检测、消息清理和 AbortSignal 包装提取为独立模块。

**影响范围**：
- 新增文件：`src/agent/cancellation.ts`
- 修改文件：`src/agent/index.ts`（移除方法，run() 中改为模块函数调用）

**具体操作**：
1. 创建 `src/agent/cancellation.ts`，实现以下函数：
   - `checkCancelled(signal?: AbortSignal): boolean` — 从 `_checkCancelled` 提取
   - `cleanupIncompleteMessages(messages: Message[]): Message[]` — 从 `_cleanupIncompleteMessages` 提取，改为返回新数组而非修改 `this.messages`
   - `generateWithSignal(llmClient, messages, tools, signal?): Promise<LLMResponse>` — 从 `_generateWithSignal` 提取，需保留以下防御代码：
     - 对 `signal.aborted` 的前置检查（在发起 LLM 调用前立即判断，避免信号已触发仍发起请求）
     - `generatePromise.catch(() => {})` 的 Promise 悬挂防御（当 AbortSignal 胜出竞争后，原 generate Promise 未被 await，需防止 unhandled rejection）
2. 修改 `index.ts` 中 Agent 类：
   - 完全移除 `_checkCancelled`、`_cleanupIncompleteMessages`、`_generateWithSignal` 方法
   - `run()` 中所有 `this._checkCancelled(signal)` 替换为 `checkCancelled(signal)`
   - `run()` 中所有 `this._cleanupIncompleteMessages()` 替换为 `this.messages = cleanupIncompleteMessages(this.messages)`
   - `run()` 中 `this._generateWithSignal(signal)` 替换为 `generateWithSignal(this.llmClient, this.messages, this.tools, signal)`

**验收标准**：
- `cancel.test.ts` 全部 9 个用例通过
- 取消后消息清理行为完全一致

### T4：创建 tool-executor.ts

**目标**：将工具查找和执行逻辑提取为独立模块。

**影响范围**：
- 新增文件：`src/agent/tool-executor.ts`
- 修改文件：`src/agent/index.ts`（run() 中工具执行块替换为函数调用）

**具体操作**：
1. 创建 `src/agent/tool-executor.ts`，实现：
   - `executeTool(tools, functionName, functionArgs): Promise<ToolResult>` — 从 `run()` 第 340-361 行提取
2. 修改 `index.ts` 中 `run()` 方法：
   - 工具执行的 if-else-try-catch 块（约 22 行）替换为 `const result = await executeTool(this.tools, toolCall.function.name, toolCall.function.arguments);`

**验收标准**：
- 所有含工具调用的测试用例通过
- 未知工具返回 `{ success: false, error: 'Unknown tool: ...' }`
- 工具执行异常被正确捕获并包装

### T5：清理 index.ts 并最终验证

**目标**：确保 Agent 类仅保留门面逻辑，所有导入正确，代码格式符合规范。

**影响范围**：
- 修改文件：`src/agent/index.ts`

**具体操作**：
1. 确认 `index.ts` 中 Agent 类只保留：
   - 字段声明（7 个字段）
   - `constructor`（初始化）
   - `addUserMessage`（1 行方法）
   - `_estimateTokens`（代理方法，1 行）
   - `_summarizeMessages`（代理方法，~6 行）
   - `run`（主循环编排，使用模块函数）
2. 确认 re-export：`export type { RunOptions, AgentMessageEvent } from './types';`
3. 移除所有不再使用的 import（如 `countTokens`）
4. 运行 `pnpm biome check --fix .` 修复格式
5. 运行 `pnpm check` 确认通过
6. 运行 `pnpm test` 确认全绿

**验收标准**：
- `pnpm check` 通过（格式 + lint）
- `pnpm test` 全部测试通过（包括 agent 目录的 17 个用例和其他所有测试）
- `index.ts` 行数 < 140 行（从 401 行降低约 65%）
- 无 TypeScript 编译错误

---

## 4. 风险与不确定点

### 已关闭的 U 点

| U 点 | 关闭方式 |
|------|---------|
| _apiTotalTokens 的 private 访问 | 测试通过 `(agent as any)` 访问，TypeScript 运行时无访问限制，保持 private 即可 |
| messages 的 public 可见性 | 保持 public，决策摘要明确"对外 API 零变化" |
| maxSteps 硬编码 | 不变，不在本次范围内 |

### 剩余风险

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| summarizeMessages 纯函数的防抖状态同步错误 | 低 | 摘要行为异常 | T2 中逐行比对 _summarizeMessages 逻辑，特别关注 _skipNextTokenCheck 的读写时序 |
| cleanupIncompleteMessages 由原地修改改为返回新数组，语义差异 | 极低 | 消息状态不一致 | 原实现用 `this.messages = this.messages.slice(...)` 已是赋值操作，改为返回新数组语义等价 |
| 工具执行模块化后 toolCall 循环中的取消检查时序 | 极低 | 取消延迟或遗漏 | 取消检查仍在 run() 循环内，executeTool 只负责单次执行，不影响时序 |

---

## 5. 代码行数预估

| 文件 | 预估行数 | 内容 |
|------|---------|------|
| types.ts | ~20 行 | 2 个类型定义 + 导入 |
| summarizer.ts | ~120 行 | 3 个函数 + 注释 |
| cancellation.ts | ~70 行 | 3 个函数 + 注释 |
| tool-executor.ts | ~40 行 | 1 个函数 + 注释 |
| index.ts（重构后）| ~130 行 | Agent 门面类 + re-export |
| **合计** | **~380 行** | 从 401 行单文件拆为 5 文件共 ~380 行 |

总代码量基本持平（略减），但职责清晰度显著提升。
