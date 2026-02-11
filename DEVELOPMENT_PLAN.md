# mini-agents 开发计划

基于 Python 版本 mini-agents 的功能进行 TypeScript 复刻。

---

## 阶段 1：工具系统扩展

### 1.1 Token 工具函数
- 新建 `src/utils/token.ts`
- 实现 `countTokens()` 和 `truncateTextByTokens()`
- 依赖：`tiktoken` 或 `gpt-tokenizer`

**测试**：
- 单元测试：`tests/utils/token.test.ts`
- 验证 token 计数准确性、截断保留头尾

### 1.2 ReadTool - 文件读取
- 新建 `src/tools/read-tool.ts`
- 支持 offset/limit 参数、行号格式输出、token 截断

**测试**：
- 单元测试：`tests/tools/read-tool.test.ts`
- Example：`examples/tools/test-read.ts`

### 1.3 WriteTool - 文件写入
- 新建 `src/tools/write-tool.ts`
- 自动创建父目录、UTF-8 编码

**测试**：
- 单元测试：`tests/tools/write-tool.test.ts`
- Example：`examples/tools/test-write.ts`

### 1.4 EditTool - 文件编辑
- 新建 `src/tools/edit-tool.ts`
- 精确字符串替换、错误处理

**测试**：
- 单元测试：`tests/tools/edit-tool.test.ts`
- Example：`examples/tools/test-edit.ts`

### 1.5 BashTool - Shell 执行
- 新建 `src/tools/bash-tool.ts`、`src/tools/bash-types.ts`
- 前台/后台执行、跨平台支持
- 包含 `BashOutputTool`、`BashKillTool`

**测试**：
- 单元测试：`tests/tools/bash-tool.test.ts`
- Example：`examples/tools/test-bash.ts`

### 1.6 导出更新
- 修改 `src/tools/index.ts` 导出所有新工具

---

## 阶段 2：LLM 客户端完善

### 2.1 类型定义增强
- 修改 `src/types/llm.ts`
- 添加 `LLMProvider` 枚举、完善 `Message` 类型

### 2.2 OpenAI Client
- 新建 `src/llm/openai-client.ts`
- 消息格式转换、Tool call 处理、Reasoning content 支持

**测试**：
- Example：`examples/llm/test-openai.ts`
- 集成测试：使用真实 API 验证

### 2.3 LLM Wrapper
- 新建 `src/llm/llm-wrapper.ts`
- 统一封装，根据 provider 自动选择客户端

**测试**：
- 单元测试：`tests/llm/llm-wrapper.test.ts`

### 2.4 Anthropic Client 增强
- 修改 `src/llm/anthropic-client.ts`
- Extended thinking 支持、Cache tokens 统计

**测试**：
- Example：`examples/llm/test-anthropic.ts`

---

## 阶段 3：配置系统

### 3.1 配置类型与加载器
- 新建 `src/config/types.ts`、`src/config/index.ts`
- YAML 解析、优先级搜索、默认值填充
- 依赖：`js-yaml`

**测试**：
- 单元测试：`tests/config/config.test.ts`
- 测试配置文件搜索优先级

### 3.2 Retry 工具
- 新建 `src/utils/retry.ts`
- 指数退避重试

**测试**：
- 单元测试：`tests/utils/retry.test.ts`

---

## 阶段 4：基础 CLI

### 4.1 CLI 入口
- 修改 `mini-agents-cli/src/index.ts`
- 参数解析、子命令
- 依赖：`commander`

### 4.2 交互式提示
- 新建 `mini-agents-cli/src/prompt.ts`
- 命令历史、补全
- 依赖：`@inquirer/prompts`

### 4.3 Session 命令
- 新建 `mini-agents-cli/src/commands.ts`
- `/help`、`/clear`、`/history`、`/stats`、`/exit`

### 4.4 颜色输出
- 新建 `mini-agents-cli/src/colors.ts`

**测试**：
- 手动测试：`pnpm -F mini-agents-cli dev`
- 验证所有命令正常工作

---

## 阶段 5：Agent 核心增强

### 5.1 取消机制
- 修改 `src/agent/index.ts`
- AbortController、消息清理

### 5.2 自动摘要
- 修改 `src/agent/index.ts`
- Token 阈值检测、LLM 驱动摘要

**测试**：
- 单元测试：`tests/agent/summarize.test.ts`

### 5.3 Agent Logger
- 新建 `src/logger/index.ts`
- JSON 格式、毫秒级时间戳

**测试**：
- 单元测试：`tests/logger/logger.test.ts`

---

## 阶段 6：MCP 支持

### 6.1 MCP 类型与连接管理
- 新建 `src/mcp/types.ts`、`src/mcp/connection.ts`
- 支持 stdio/sse/http/streamable_http

### 6.2 MCP 工具加载器
- 新建 `src/mcp/loader.ts`、`src/mcp/config.ts`
- 从 MCP 服务器发现并包装工具

**测试**：
- Example：`examples/mcp/test-mcp.ts`
- 使用本地 MCP 服务器验证

---

## 阶段 7：会话记忆系统

### 7.1 Note 工具
- 新建 `src/tools/note-tool.ts`
- `SessionNoteTool`、`RecallNoteTool`
- JSON 存储到 `.agent_memory.json`

**测试**：
- 单元测试：`tests/tools/note-tool.test.ts`
- Example：`examples/tools/test-note.ts`

---

## 阶段 8：Skill 系统

### 8.1 SKILL.md 解析与加载
- 新建 `src/skills/parser.ts`、`src/skills/loader.ts`
- 依赖：`gray-matter`

### 8.2 GetSkillTool
- 新建 `src/tools/skill-tool.ts`
- 渐进式披露

**测试**：
- 单元测试：`tests/skills/skill.test.ts`
- Example：`examples/skills/test-skill.ts`

---

## 阶段 9：ACP 服务器

### 9.1 ACP 协议实现
- 新建 `src/acp/types.ts`、`src/acp/transport.ts`
- stdio 传输、JSON-RPC

### 9.2 会话管理与服务器
- 新建 `src/acp/session.ts`、`src/acp/server.ts`
- 多会话、实时更新推送

**测试**：
- Example：`examples/acp/test-acp-server.ts`
- 使用 ACP 客户端验证

---

## 阶段 10：CLI 高级功能

### 10.1 Esc 键取消
- 新建 `mini-agents-cli/src/key-listener.ts`
- 跨平台键盘监听

### 10.2 高级交互
- 修改 `mini-agents-cli/src/prompt.ts`
- 历史建议、自定义快捷键

### 10.3 系统集成
- 新建 `mini-agents-cli/src/system.ts`
- 打开日志目录

**测试**：
- 手动测试 CLI 交互功能

---

## 实施进度

- [x] **阶段 1：工具系统扩展**
  - [x] 1.1 Token 工具
  - [x] 1.2 ReadTool
  - [x] 1.3 WriteTool
  - [x] 1.4 EditTool
  - [x] 1.5 BashTool
  - [x] 1.6 导出更新
- [x] **阶段 2：LLM 客户端完善**
  - [x] 2.1 类型定义增强
  - [x] 2.2 OpenAI Client
  - [x] 2.3 LLM Wrapper
  - [x] 2.4 Anthropic Client 增强
- [x] **阶段 3：配置系统**
  - [x] 3.1 配置类型与加载器
  - [x] 3.2 Retry 工具
- [x] **阶段 4：基础 CLI**
  - [x] 4.1 CLI 入口
  - [x] 4.2 交互式提示
  - [x] 4.3 Session 命令
  - [x] 4.4 颜色输出
- [ ] **阶段 5：Agent 核心增强**
  - [x] 5.1 取消机制
  - [x] 5.2 自动摘要
  - [ ] 5.3 Agent Logger
- [ ] **阶段 6：MCP 支持**
  - [ ] 6.1 MCP 类型与连接管理
  - [ ] 6.2 MCP 工具加载器
- [ ] **阶段 7：会话记忆系统**
  - [ ] 7.1 Note 工具
- [x] **阶段 8：Skill 系统**
  - [x] 8.1 SKILL.md 解析与加载
  - [x] 8.2 GetSkillTool
- [ ] **阶段 9：ACP 服务器**
  - [ ] 9.1 ACP 协议实现
  - [ ] 9.2 会话管理与服务器
- [ ] **阶段 10：CLI 高级功能**
  - [ ] 10.1 Esc 键取消
  - [ ] 10.2 高级交互
  - [ ] 10.3 系统集成

---

## 依赖安装

```bash
# 阶段 1
pnpm add -F mini-agents gpt-tokenizer

# 阶段 3
pnpm add -F mini-agents js-yaml
pnpm add -F mini-agents -D @types/js-yaml

# 阶段 4
pnpm add -F mini-agents-cli commander @inquirer/prompts

# 阶段 8
pnpm add -F mini-agents gray-matter
```

---

## 测试命令

```bash
# 单元测试
pnpm test

# 运行单个测试文件
pnpm test tests/tools/read-tool.test.ts

# 运行 example
pnpm tsx examples/tools/test-read.ts

# CLI 开发模式
pnpm -F mini-agents-cli dev
```
