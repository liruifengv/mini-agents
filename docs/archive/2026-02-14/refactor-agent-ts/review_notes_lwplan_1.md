# 方案评审记录：lwplan（第 1 轮）

**评审对象**：`docs/current/refactor-agent-ts/llplan.md`
**评审时间**：2026-02-14
**评审结论**：⚠️ 需修订

---

## 可行性分析

### 技术可行性：通过

整体方案是可行的。将 401 行的单文件 Agent 类按职责拆分为 5 个文件（types.ts / summarizer.ts / cancellation.ts / tool-executor.ts / index.ts），每个模块职责单一，接口清晰。纯函数提取策略合理，Agent 类保留为门面编排器。

### 资源可行性：通过

不依赖新外部资源，仅涉及内部代码重组。

### 时间可行性：通过

5 个任务（T1-T5）粒度合理，每个任务独立可验收，估算行数与实际代码量吻合。

---

## 风险点

### R1 [低] summarizeMessages 返回类型内部矛盾

方案中 **2.3 节**和 **2.7 节**对 `summarizeMessages` 的返回类型定义存在矛盾：

- **2.3 节**定义返回类型为 `Promise<{event, messages, skipNextTokenCheck} | null>`，即可返回 `null`。
- **2.7 节**明确修正为始终返回对象（不返回 `null`），并给出了三种场景的返回值。
- **2.6 节** Agent 门面类中的 `_summarizeMessages` 代理方法（第 294-313 行伪代码）仍使用 `if (!result)` 分支处理 `null`，且包含独立的 `_skipNextTokenCheck` 重置逻辑——这与 2.7 节的"纯函数统一返回"设计冲突。

**影响**：实施者在 T2 任务中会面临两种互相矛盾的规格，可能选错导致防抖行为出错。

**建议**：采用 2.7 节的设计（始终返回对象，不返回 `null`），同时更新 2.3 节的签名和 2.6 节的代理方法伪代码，确保三处一致。2.6 节中的代理方法应简化为：

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

### R2 [极低] cleanupIncompleteMessages 语义等价性——确认无问题

经验证，当前实现的 `_cleanupIncompleteMessages` 逻辑（第 68-84 行）为：

```typescript
this.messages = this.messages.slice(0, lastAssistantIdx);
```

这已经是赋值新数组（`slice` 返回新数组）而非原地修改。方案将其改为纯函数 `cleanupIncompleteMessages(messages): Message[]` 返回 `messages.slice(0, lastAssistantIdx)`，调用处改为 `this.messages = cleanupIncompleteMessages(this.messages)`——语义完全等价，无风险。

### R3 [极低] tool-executor.ts 的 import 路径

方案 2.5 节的导入写为：

```typescript
import type { Tool, ToolResult } from '../tools';
```

经验证，`Tool`（抽象类）和 `ToolResult`（接口）均通过 `src/tools/index.ts -> core/index.ts -> base.ts` 正确导出，该导入路径有效。但需注意 `Tool` 是抽象类不是接口，`import type` 仅获取类型信息，`executeTool` 中的 `tools.find()` 运行时使用实例数组，不需要导入类本身，所以 `import type` 正确。

---

## 遗漏或需补充

### O1 [需补充] _createSummary 间接测试覆盖确认

方案 T2 中将 `_createSummary` 从 Agent 类完全移除，变为 `summarizer.ts` 的模块私有函数（不导出）。当前测试 `summarize.test.ts` 第 259-297 行的 `_createSummary fallback` 用例通过 `agent._summarizeMessages()` 间接测试降级行为。

这意味着重构后该测试路径不变（仍通过 `agent._summarizeMessages()` 触发），所以兼容性没问题。但方案中未显式说明这一点，建议在 T2 验收标准中补充：

> - `_createSummary fallback` 测试用例仍通过 `_summarizeMessages` 间接覆盖

### O2 [信息] _apiTotalTokens 的访问修饰符无需变更

方案 2.6 节写 `_apiTotalTokens = 0;`（无访问修饰符），失败模式表也提到"从 private 改为无访问修饰符"。但当前源码（第 29 行）为 `private _apiTotalTokens = 0;`，测试中通过 `(agent as any)._apiTotalTokens = 200000` 访问。

TypeScript 的 `private` 在运行时不强制限制，`(agent as any)` 可以绕过类型检查。因此保持 `private` 即可，无需改为无修饰符。方案 2.8 失败模式表中的措辞可保留（作为备选方案），但建议 T2/T5 明确：**优先保持 `private`，仅当 `(agent as any)` 访问在某些配置下失效时才降级**。

### O3 [信息] `export *` 与 `export type` 的传递导出

当前包入口 `src/index.ts` 使用 `export * from './agent'`，这意味着 `agent/index.ts` 中的所有具名导出都会被传递。方案中使用 `export type { RunOptions, AgentMessageEvent } from './types'` 进行 re-export 是正确的，`export *` 会自动包含这些 type 导出。

但需注意：如果后续 `types.ts` 中添加了不应对外暴露的辅助类型，`export *` 会将其泄漏。当前范围内不是问题，仅作提醒。

### O4 [信息] `generateWithSignal` 中 Promise 悬挂处理

当前 `_generateWithSignal`（第 230-260 行）在 signal 已 aborted 时调用 `generatePromise.catch(() => {})` 防止 unhandled rejection。方案中 `cancellation.ts` 的 `generateWithSignal` 函数签名和说明中未提及这一细节。实施时需确保此防御性代码被保留。

---

## 修订建议

按优先级排序：

| 优先级 | 编号 | 建议 |
|--------|------|------|
| **P1** | R1 | 统一 summarizeMessages 返回类型：2.3、2.6、2.7 三处对齐为"始终返回对象"模式 |
| P2 | O1 | T2 验收标准补充 `_createSummary fallback` 间接测试覆盖说明 |
| P3 | O4 | T3 中明确 `generateWithSignal` 需保留 Promise 悬挂防御代码 |

P1 为阻塞项（影响实施者对防抖逻辑的理解），P2/P3 为建议性补充。

---

## 后续行动

1. **修订 llplan.md**：按 P1 建议统一三处 `summarizeMessages` 返回类型定义
2. 可选：按 P2/P3 补充验收标准和实施细节
3. 修订后进行第 2 轮评审（如仅修订 P1 且改动量小，可合并为通过）

---

快速跳转指令（可在新会话中使用）：
```
refactor-agent-ts lwplan  -> 回到低层方案修订
```
