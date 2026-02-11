# mini-agents

[English](README.en.md) | 中文

**mini-agents** 是一个极简但专业的 TypeScript Agent 框架，灵感来源于 MiniMax 开源的 Python 版本的 [Mini-Agent](https://github.com/MiniMax-AI/Mini-Agent)。项目由两部分组成：

- **mini-agents**: 可独立使用的 Agent 框架，提供 LLM 客户端、工具系统和 Agent 核心逻辑
- **mini-agents-cli**: 基于框架构建的交互式命令行工具

## 特性

*   ✅ **完整的 Agent 执行循环**：可靠的执行框架，配备文件系统操作和 Shell 执行的基础工具集
*   ✅ **智能上下文管理**：自动对会话历史进行摘要，支持长任务执行
*   ✅ **Skill 系统**：渐进式披露的 Skill 机制，Agent 可按需获取 Skill 详情
*   ✅ **多 LLM 支持**：同时支持 Anthropic (Claude) 和 OpenAI 的 API
*   ✅ **取消机制**：支持随时取消 Agent 执行，并正确清理会话状态
*   ✅ **模块化设计**：框架与 CLI 分离，可独立使用或扩展

## 目录

- [mini-agents](#mini-agents)
  - [特性](#特性)
  - [项目结构](#项目结构)
  - [快速开始](#快速开始)
    - [使用 mini-agents-cli](#使用-mini-agents-cli)
    - [在项目中使用 mini-agents 框架](#在项目中使用-mini-agents-框架)
  - [配置说明](#配置说明)
  - [工具列表](#工具列表)
  - [开发](#开发)
  - [许可证](#许可证)

## 项目结构

```
mini-agents/
├── packages/
│   ├── mini-agents/           # 框架层 - 可独立使用
│   │   ├── src/
│   │   │   ├── tools/        # 工具实现 (read/write/edit/bash/skill)
│   │   │   ├── llm/          # LLM 客户端 (anthropic/openai)
│   │   │   ├── agent/        # Agent 核心逻辑
│   │   │   ├── types/        # 类型定义
│   │   │   └── utils/        # 工具函数 (token/retry)
│   │   └── tests/            # 单元测试
│   │
│   └── mini-agents-cli/       # CLI 层 - 交互式应用
│       ├── src/
│       │   ├── index.ts      # 入口
│       │   ├── cli.ts        # CLI 实现
│       │   ├── config.ts     # 配置管理
│       │   └── onboarding.ts # 初始化引导
│       ├── skills/           # 内置 Skills
│       └── config/           # 配置模板
│
└── examples/                 # 示例代码
    └── basic-examples/
```

## 快速开始

### 前置要求

1. **Node.js 18+**
2. **API Key**: 从对应供应商处获取
---

### 使用 mini-agents-cli

**mini-agents-cli** 是一个开箱即用的交互式命令行工具，适合直接体验 Agent 功能。

```bash
# 全局安装
npm install -g mini-agents-cli

# 或使用 npx 直接运行
npx mini-agents-cli
```

**首次运行配置：**

```bash
# 运行 CLI
mini-agents-cli

# CLI 首次运行会引导选择供应商并设置 API_KEY，并写入默认配置文件 ~/.mini-agents-cli/setting.json
```

**CLI 内置命令：**

```
/help     - 显示帮助信息
/clear    - 清空当前会话
/exit     - 退出程序
```

---

### 在项目中使用 mini-agents 框架

**mini-agents** 是一个可独立使用的极简 Agent 开发框架

```bash
# 安装框架
npm install mini-agents

# 框架依赖 Zod 进行参数校验
npm install zod
```

#### 1. 基础使用

```typescript
import { Agent, LLMClient } from 'mini-agents';
import { createReadTool, createWriteTool, createBashTool } from 'mini-agents/tools';

// 创建 LLM 客户端
const llm = new LLMClient({
  provider: 'anthropic',
  model: 'claude-sonnet-4-5-20250929',
  apiKey: "ANTHROPIC_API_KEY",
  apiBaseUrl: "ANTHROPIC_API_BASE_URL",
});

// 创建工作目录限制的工具
const tools = [
  createReadTool('./workspace'),
  createWriteTool('./workspace'),
  createBashTool('./workspace'),
];

// 创建 Agent
const agent = new Agent(llm, 'You are a helpful assistant.', tools);

// 添加用户消息
agent.addUserMessage('请帮我创建一个简单的 HTML 文件');

// 运行 Agent，处理事件流
for await (const event of agent.run()) {
  switch (event.type) {
    case 'thinking':
      console.log('🤔', event.thinking);
      break;
    case 'toolCall':
      console.log('🔧 调用:', event.toolCall.function.name);
      break;
    case 'toolResult':
      console.log('✅ 结果:', event.result.content);
      break;
    case 'assistantMessage':
      console.log('💬', event.content);
      break;
  }
}
```

#### 2. 使用 Skill 系统

```typescript
import { SkillLoader, createGetSkillTool } from 'mini-agents/tools';

// 加载 Skills
const skillLoader = new SkillLoader('./skills');
const skills = await skillLoader.loadAll();

// 创建 GetSkillTool
const getSkillTool = createGetSkillTool(skills);

// 在系统提示词中声明可用的 Skills
const skillList = skillLoader.formatForSystemPrompt(skills);
const systemPrompt = `You are a helpful assistant.

Available Skills:
${skillList}`;

// 创建 Agent，包含 GetSkillTool
const agent = new Agent(
  llm,
  systemPrompt,
  [...tools, getSkillTool]
);
```

#### 3. 取消机制

```typescript
// 创建 AbortController
const controller = new AbortController();

// 支持取消的 Agent 运行
const runPromise = (async () => {
  for await (const event of agent.run({ signal: controller.signal })) {
    // 处理事件...
  }
})();

// 5秒后取消
setTimeout(() => controller.abort(), 5000);

await runPromise;
```

#### 4. 自定义工具

```typescript
import { tool } from 'mini-agents';
import { z } from 'zod';

// 使用工厂函数创建自定义工具
export function createMyTool(apiKey: string) {
  return tool({
    name: 'my_custom_tool',
    description: 'My custom tool description',
    parameters: z.object({
      input: z.string().describe('Input parameter'),
    }),
    async execute({ input }) {
      // 工具逻辑
      const result = await fetch(`https://api.example.com/${input}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return result.text();
    },
  });
}
```

## 配置说明

### CLI 配置

**配置文件路径**: `~/.mini-agents-cli/setting.json`

```json
{
  "llm": {
    "defaultProvider": "anthropic",
    "defaultModel": "claude-sonnet-4-5-20250929",
    "anthropic": {
      "apiKey": null,
      "baseUrl": null
    },
    "openai": {
      "apiKey": null,
      "baseUrl": null
    }
  },
  "agent": {
    "maxIterations": 100,
    "summaryThreshold": 80000
  }
}
```

**配置优先级**:
1. 环境变量 (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`)
2. `~/.mini-agents-cli/setting.json`
3. 内置默认值

### 框架配置

框架可以通过代码直接配置，无需配置文件：

```typescript
const llm = new LLMClient({
  provider: 'anthropic',
  model: 'claude-sonnet-4-5-20250929',
  apiKey: "ANTHROPIC_API_KEY",
  apiBaseUrl: "ANTHROPIC_API_BASE_URL",
});

const agent = new Agent(llm, systemPrompt, tools, {
  tokenLimit: 80000,  // 触发摘要的 token 阈值
});
```

## 工具列表

| 工具 | 描述 | 参数 |
|------|------|------|
| `read` | 读取文件内容 | `file_path`, `offset`, `limit` |
| `write` | 写入文件 | `file_path`, `content` |
| `edit` | 编辑文件（字符串替换） | `file_path`, `old_string`, `new_string` |
| `bash` | 执行 Shell 命令 | `command`, `timeout`, `work_dir` |
| `get_skill` | 获取 Skill 详情 | `skill_name` |

## 本地开发

如果你想参与项目开发或从源码构建，请参考以下步骤。

### 克隆并安装

```bash
# 克隆仓库
git clone https://github.com/liruifengv/mini-agents.git
cd mini-agents

# 安装依赖
pnpm install
```

### 运行测试

```bash
# 运行所有测试
pnpm test

# 运行框架测试
pnpm test packages/mini-agents

# 运行 CLI 测试
pnpm test packages/mini-agents-cli

# 运行特定测试文件
pnpm test packages/mini-agents/tests/tools/read-tool.test.ts
```

### 构建

```bash
# 构建所有包
pnpm build

# 构建框架
pnpm -F mini-agents build

# 构建 CLI
pnpm -F mini-agents-cli build
```

### 本地开发

```bash
# 启动框架监视模式
pnpm -F mini-agents dev

# 启动 CLI 监视模式（依赖框架）
pnpm -F mini-agents-cli dev
```

## 许可证

本项目采用 [MIT 许可证](LICENSE) 授权。

## 参考资源

- MiniAgent Python 版本: https://github.com/MiniMax-AI/Mini-Agent
- MiniMax API: https://platform.minimaxi.com/document
- MiniMax-M2: https://github.com/MiniMax-AI/MiniMax-M2
- Anthropic API: https://docs.anthropic.com/claude/reference
- OpenAI API: https://platform.openai.com/docs/api-reference
- Claude Skills: https://github.com/anthropics/skills

---

**⭐ 如果这个项目对您有帮助，请给它一个 Star！**
