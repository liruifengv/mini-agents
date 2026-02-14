# 澄清问题汇总

## 已回答

## 头脑风暴决策

1. 按职责拆文件，Agent 类保留为门面，组合调用各模块，对外 API（构造函数、`addUserMessage`、`run`）零变化
2. 拆出 **summarizer.ts** — `_summarizeMessages`、`_createSummary`、`_estimateTokens`
3. 拆出 **cancellation.ts** — `_checkCancelled`、`_cleanupIncompleteMessages`、`_generateWithSignal`
4. 拆出 **tool-executor.ts** — 工具查找、参数解析、执行、异常包装
5. 拆出 **types.ts** — `AgentMessageEvent`、`RunOptions` 等类型定义
6. Agent 类变薄，只保留构造函数 + `addUserMessage` + `run` 主循环编排
7. 测试策略：仅确保现有测试全部通过，不新增模块级测试
8. 不涉及 REFACTOR_DESIGN.md 的新架构（流式 API、事件系统等留到后续）

**用户确认**：✅ 已确认
**确认时间**：2026-02-14
