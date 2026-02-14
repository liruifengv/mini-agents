# Agent.ts 重构调研报告

> 调研时间：2026-02-14
> 调研范围：Agent 类代码结构、依赖关系、设计文档、测试覆盖、Python 参考

---

## A. 系统边界与现有能力

mini-agents 是一个 TypeScript Agent 框架，核心能力包括：

- **Agent 执行循环**：LLM 调用 -> 工具执行 -> 结果反馈的多步循环
- **多 LLM 支持**：Anthropic、OpenAI (Responses API)、OpenAI Chat Completions
- **工具系统**：基于抽象类 `Tool` + Zod 工厂模式 `tool()` 的双轨工具定义
- **取消机制**：基于 AbortController 的三检查点取消
- **自动摘要**：token 超限时自动压缩历史消息
- **Skill 系统**：SKILL.md 解析与动态加载

系统**不做**：流式输出（当前 LLM 调用为非流式）、多 Agent 协作、记忆持久化（尚未实现）

---

## B. 入口与主流程

### 主要入口

- **包入口**：`packages/mini-agents/src/index.ts` -- 导出 agent、llm、types
- **Agent 入口**：`packages/mini-agents/src/agent/index.ts` -- Agent 类定义（单文件，401 行）

### 核心流程

```
用户调用 agent.run()
  -> AsyncGenerator 循环（最多 maxSteps=50 步）
    -> 检查点1：检查取消信号
    -> _summarizeMessages()：检查并压缩 token
    -> _generateWithSignal()：调用 LLM（带 AbortSignal）
    -> 处理 LLM 响应：
       - 有 thinking -> yield thinking 事件
       - 有 content 且无 toolCalls -> yield assistantMessage 事件，return
       - 无 toolCalls -> return（任务完成）
    -> 检查点2：检查取消信号
    -> 遍历 toolCalls：
       - yield toolCall 事件
       - 查找并执行 tool.execute()
       - yield toolResult 事件
       - 检查点3：检查取消信号
    -> step++
```

---

## C. 关键模块与职责划分

### C.1 Agent 类当前职责（`src/agent/index.ts`，401 行）

Agent 类承担了**6 项职责**，全部集中在单一文件中：

| 职责 | 方法 | 行数范围 | 说明 |
|------|------|----------|------|
| **构造与初始化** | `constructor` | 33-48 | 初始化 llmClient、tools、tokenLimit、messages |
| **消息管理** | `addUserMessage` | 50-55 | 添加用户消息到 messages 数组 |
| **取消检测** | `_checkCancelled`, `_cleanupIncompleteMessages`, `_generateWithSignal` | 60-260 | 三检查点取消 + 不完整消息清理 + AbortSignal 包装 |
| **Token 估算** | `_estimateTokens` | 89-110 | 遍历消息列表估算总 token |
| **自动摘要** | `_summarizeMessages`, `_createSummary` | 116-224 | token 超限检测 + 分轮摘要 + LLM 摘要调用 + 降级 |
| **主执行循环** | `run` | 265-400 | AsyncGenerator 循环：LLM调用 -> 事件yield -> 工具执行 |

### C.2 工具系统（`src/tools/`）

| 模块 | 文件 | 说明 |
|------|------|------|
| 基类 | `core/base.ts` | 抽象类 `Tool`，定义 name/description/parameters/execute + schema 转换 |
| Zod 工具 | `core/zod-tool.ts` | `ZodTool` 类继承 `Tool`，`tool()` 工厂函数 |
| 文件操作 | `filesystem/read-tool.ts`, `write-tool.ts`, `edit-tool.ts` | 使用 `tool()` 工厂创建 |
| Shell | `shell/bash-tool.ts` | Bash 执行工具 |
| Skill | `skill/skill-tool.ts`, `skill-loader.ts` | Skill 系统工具 |

### C.3 LLM 客户端（`src/llm/`）

| 模块 | 文件 | 说明 |
|------|------|------|
| 基类 | `base.ts` | `LLMClientBase` 抽象类，实现 `ILLMClient` 接口 |
| Anthropic | `anthropic-client.ts` | Claude API 适配，支持 extended thinking |
| OpenAI | `openai-client.ts` | OpenAI Responses API 适配 |
| OpenAI Chat | `openai-chat-client.ts` | OpenAI Chat Completions API 适配 |
| 统一封装 | `llm-wrapper.ts` | `LLMClient` 类，策略模式自动选择底层客户端 |

### C.4 类型系统（`src/types/`）

| 文件 | 关键类型 |
|------|---------|
| `llm.ts` | `Message`, `ToolCall`, `FunctionCall`, `LLMResponse`, `ILLMClient`, `TokenUsage`, `ReasoningItem` |
| `retry.ts` | `RetryConfig`, `DEFAULT_RETRY_CONFIG` |

### C.5 工具函数（`src/utils/`）

| 文件 | 函数 |
|------|------|
| `token.ts` | `countTokens()`, `truncateTextByTokens()` |
| `retry.ts` | `asyncRetry()`, `calculateDelay()`, `RetryExhaustedError` |

---

## C.6 Agent 类的依赖关系图

```
Agent (src/agent/index.ts)
  ├── 直接依赖
  │   ├── Tool (interface) <-- src/tools/core/base.ts
  │   │   └── ToolResult (interface)
  │   ├── ILLMClient (interface) <-- src/types/llm.ts
  │   │   ├── LLMResponse
  │   │   ├── Message
  │   │   └── ToolCall
  │   └── countTokens() <-- src/utils/token.ts
  │
  ├── 自身导出
  │   ├── RunOptions (interface)
  │   ├── AgentMessageEvent (union type)
  │   └── Agent (class)
  │
  └── 不直接依赖（但运行时关联）
      ├── LLMClient (llm-wrapper.ts) -- 通常作为 ILLMClient 传入
      └── ZodTool / tool() -- 工具实例作为 Tool[] 传入
```

**关键观察**：

1. Agent 类通过 `ILLMClient` 接口与 LLM 层解耦，这是好的设计
2. Agent 类通过 `Tool` 抽象类与工具层耦合（而非接口）
3. Agent 类直接依赖 `countTokens()` 工具函数
4. `Message` 类型同时被 Agent 和 LLM 层使用，是核心共享类型
5. Agent 类内部的 `AgentMessageEvent` 类型定义了事件系统，与设计文档中的新事件系统有较大差距

---

## D. 核心数据 / 状态 / 配置

### D.1 Agent 内部状态

| 字段 | 类型 | 可见性 | 说明 |
|------|------|--------|------|
| `llmClient` | `ILLMClient` | private | LLM 客户端实例 |
| `tools` | `Tool[]` | private | 注册的工具列表 |
| `maxSteps` | `number` | private | 最大步数，硬编码 50 |
| `tokenLimit` | `number` | private | token 阈值，默认 80000 |
| `_apiTotalTokens` | `number` | private | API 报告的 token 总数 |
| `_skipNextTokenCheck` | `boolean` | private | 摘要防抖标志 |
| `messages` | `Message[]` | public | 对话消息列表（外部可读写） |

### D.2 关键数据流

- **messages 数组**：Agent 的核心状态，贯穿整个执行循环
  - 构造时初始化为 `[{ role: 'system', content: systemPrompt }]`
  - `addUserMessage()` 追加 user 消息
  - `run()` 中追加 assistant 和 tool 消息
  - `_summarizeMessages()` 会重组 messages 数组
  - `_cleanupIncompleteMessages()` 会截断 messages 数组
- **AgentMessageEvent**：yield 出的事件流，6 种事件类型

---

## E. 外部依赖与系统边界

| 外部依赖 | 类型 | 调用方向 | 位置 |
|---------|------|---------|------|
| `@anthropic-ai/sdk` | npm 包 | 出 | anthropic-client.ts |
| `openai` | npm 包 | 出 | openai-client.ts, openai-chat-client.ts |
| `gpt-tokenizer` | npm 包 | 内 | utils/token.ts |
| `zod` | npm 包 | 内 | tools/core/zod-tool.ts |

---

## F. 已阅读文档清单

| 路径 | 内容 | 与实现一致性 |
|------|------|-------------|
| `REFACTOR_DESIGN.md` | API 重构设计文档 v1.2 | **设计文档是目标状态，与当前实现有显著差距** |
| `DEVELOPMENT_PLAN.md` | 开发计划 | 一致，阶段 5 (Agent 核心增强) 部分完成 |
| `CLAUDE.md` | 开发指南 | 一致 |
| `docs/current/refactor-agent-ts/README.md` | 重构规划 README | 一致，当前处于调研阶段 |

### F.1 REFACTOR_DESIGN.md 核心设计方向分析

设计文档定义了 7 个重构方向：

| 编号 | 方向 | 与当前代码的差距 |
|------|------|-----------------|
| 1. 工具系统重构 | `defineTool()` + `ToolContext` + `ToolDefinition` | 当前已有 `tool()` + `ZodTool`，缺少 `ToolContext` |
| 2. Agent API 重构 | `createAgent()` + `AgentConfig` + `AgentRuntime` | 当前为 `new Agent()` 类构造 |
| 3. 消息流设计 | ContentBlock 驱动 + 细粒度事件流 (16种事件) | 当前为粗粒度 6 种 AgentMessageEvent |
| 4. 记忆系统 | `MemoryProvider` 接口 | 当前不存在 |
| 5. MCP 集成 | `loadMCPTools()` | 当前不存在 |
| 6. 完整示例 | - | - |
| 7. 迁移路径 | 旧 API -> 新 API 映射表 | - |

**设计文档的关键架构决策**：

1. **工厂函数替代类构造**：`createAgent()` 而非 `new Agent()`
2. **配置对象模式**：`AgentConfig` 统一配置入口
3. **运行时分离**：`AgentRuntime` 接口定义运行时行为
4. **流式优先**：`stream()` 为核心 API，`run()` 为语法糖
5. **内容块驱动**：ContentBlock 为基本单位
6. **生命周期钩子**：`AgentHooks` 支持 `onToolCall`、`onError` 等
7. **可插拔策略**：`ExecutionStrategy` 自定义执行策略

---

## G. 测试覆盖情况

### G.1 Agent 相关测试

| 测试文件 | 覆盖的 Agent 职责 | 测试用例数 |
|---------|------------------|-----------|
| `tests/agent/cancel.test.ts` | 取消机制（3 检查点 + 消息清理 + AbortError） | ~9 个 |
| `tests/agent/summarize.test.ts` | 自动摘要（token 估算 + 摘要触发 + 防抖 + 降级 + run集成） | ~8 个 |

### G.2 其他模块测试

| 测试文件 | 覆盖内容 |
|---------|---------|
| `tests/tools/read-tool.test.ts` | ReadTool |
| `tests/tools/write-tool.test.ts` | WriteTool |
| `tests/tools/edit-tool.test.ts` | EditTool |
| `tests/tools/bash-tool.test.ts` | BashTool |
| `tests/tools/skill-loader.test.ts` | SkillLoader |
| `tests/llm/llm-wrapper.test.ts` | LLMClient 策略选择 |
| `tests/llm/openai-chat-client.test.ts` | OpenAI Chat 客户端 |
| `tests/utils/token.test.ts` | countTokens, truncateTextByTokens |
| `tests/utils/retry.test.ts` | asyncRetry |

### G.3 Agent 测试缺失点

- **主循环正常流程**：无专门的 happy path 测试（cancel.test.ts 中有简单验证）
- **工具执行异常处理**：`run()` 中的 `catch` 分支未专门测试
- **maxSteps 达上限**：未测试
- **thinking 事件 yield**：未测试
- **多工具调用**：仅在取消测试中附带测试

---

## H. Python 版本参考

### H.1 可用性

`libs/Mini-Agent/` 目录存在但为**空目录**。Python 版本代码不在本地仓库中。

- `CLAUDE.md` 中提到 Python 版本位于 `libs/Mini-Agent/`
- `DEVELOPMENT_PLAN.md` 描述项目为"基于 Python 版本 mini-agents 的功能进行 TypeScript 复刻"
- **当前无法直接参考 Python 代码**（推断：可能是 git submodule 未初始化，或代码被移除）

---

## G. 不确定点清单

| 编号 | 不确定点 | 如何确认 |
|------|---------|---------|
| U1 | Python 版本代码去向：`libs/Mini-Agent/` 为空目录，不确定是 submodule 未初始化还是代码已移除 | 询问用户 Python 代码当前位置 |
| U2 | REFACTOR_DESIGN.md 中的设计是否为最终方案：文档标注 v1.2，部分设计（如记忆系统、MCP 集成）范围较大 | 询问用户本次重构的范围边界 |
| U3 | `maxSteps = 50` 是否应该变为可配置：当前硬编码，设计文档中 `AgentConfig.maxSteps` 为可选配置 | 在方案阶段确认 |
| U4 | `messages` 数组的 public 可见性是否是有意设计：当前外部可直接修改 messages，测试中也用到了这一特性 | 在方案阶段确认封装策略 |
| U5 | 重构是否需要保持向后兼容：当前 Agent 类在 CLI 和 examples 中被使用 | 询问用户迁移策略偏好 |

---

## 附录：Agent.ts 方法签名速查

```typescript
// 公开 API
constructor(llmClient: ILLMClient, systemPrompt: string, tools: Tool[], options?: { tokenLimit?: number })
addUserMessage(message: string): void
async *run(options?: RunOptions): AsyncGenerator<AgentMessageEvent, string, void>

// 半公开（测试可访问）
_estimateTokens(): number
async _summarizeMessages(): Promise<AgentMessageEvent | null>

// 私有
private _checkCancelled(signal?: AbortSignal): boolean
private _cleanupIncompleteMessages(): void
private async _createSummary(executionMessages: Message[], roundNum: number): Promise<string>
private _generateWithSignal(signal?: AbortSignal): Promise<LLMResponse>
```
