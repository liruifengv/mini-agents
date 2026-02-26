# mini-agents

English | [中文](README.md)

**mini-agents** is a minimalist yet professional TypeScript Agent framework, inspired by MiniMax's open-source Python version of [Mini-Agent](https://github.com/MiniMax-AI/Mini-Agent). The project consists of two parts:

- **mini-agents**: A standalone Agent framework providing LLM clients, tool system, and core Agent logic
- **mini-agents-cli**: An interactive command-line tool built on top of the framework

## Features

*   ✅ **Complete Agent Execution Loop**: Reliable execution framework with a basic toolset for file system operations and shell execution
*   ✅ **Smart Context Management**: Automatic summarization of conversation history to support long task execution
*   ✅ **Cross-Session Memory**: Persistent memory system based on MEMORY.md, allowing the Agent to remember user preferences and project context across sessions
*   ✅ **Skill System**: Progressive disclosure Skill mechanism, where the Agent can retrieve Skill details on demand
*   ✅ **Multi-LLM Support**: Supports Anthropic (Claude), OpenAI, OpenAI Chat (compatible with Ollama/vLLM/DeepSeek, etc.), and Google Gemini
*   ✅ **Cancellation Mechanism**: Support for canceling Agent execution at any time with proper cleanup of session state
*   ✅ **Modular Design**: Separation of framework and CLI, allowing independent use or extension

## Table of Contents

- [mini-agents](#mini-agents)
  - [Features](#features)
  - [Project Structure](#project-structure)
  - [Quick Start](#quick-start)
    - [Using mini-agents-cli](#using-mini-agents-cli)
    - [Using mini-agents Framework in Your Project](#using-mini-agents-framework-in-your-project)
  - [Configuration](#configuration)
  - [Tool List](#tool-list)
  - [Development](#development)
  - [License](#license)

## Project Structure

```
mini-agents/
├── packages/
│   ├── mini-agents/           # Framework layer - can be used standalone
│   │   ├── src/
│   │   │   ├── tools/        # Tool implementations (read/write/edit/bash/skill)
│   │   │   ├── llm/          # LLM clients (anthropic/openai/openai-chat/gemini)
│   │   │   ├── agent/        # Core Agent logic (execution loop/cancel/summarize)
│   │   │   ├── types/        # Type definitions
│   │   │   └── utils/        # Utility functions (token/retry)
│   │   └── tests/            # Unit tests
│   │
│   └── mini-agents-cli/       # CLI layer - interactive application
│       ├── src/
│       │   ├── index.ts      # Entry point
│       │   ├── cli.ts        # CLI implementation
│       │   ├── config.ts     # Configuration management
│       │   ├── memory.ts     # Cross-session memory
│       │   └── onboarding.ts # Initialization guide
│       ├── skills/           # Built-in Skills
│       └── config/           # Configuration templates
│
└── examples/                 # Example code
```

## Quick Start

### Prerequisites

1. **Node.js 18+**
2. **API Key**: Obtain from the corresponding provider

---

### Using mini-agents-cli

**mini-agents-cli** is an out-of-the-box interactive command-line tool, perfect for directly experiencing Agent functionality.

```bash
# Global installation
npm install -g mini-agents-cli

# Or run directly with npx
npx mini-agents-cli
```

**First Run Configuration:**

```bash
# Run CLI
mini-agents-cli

# The CLI will guide you to select a provider (Anthropic/OpenAI/OpenAI Chat/Gemini)
# and set API_KEY on first run, writing to the default config file ~/.mini-agents-cli/settings.json
```

**CLI Built-in Commands:**

```
/help     - Show help information
/clear    - Clear current session
/exit     - Exit the program
```

---

### Using mini-agents Framework in Your Project

**mini-agents** is a minimalist Agent development framework that can be used independently

```bash
# Install framework
npm install mini-agents

# Framework depends on Zod for parameter validation
npm install zod
```

#### 1. Basic Usage

```typescript
import { Agent, LLMClient } from 'mini-agents';
import { createReadTool, createWriteTool, createBashTool } from 'mini-agents/tools';

// Create LLM client
const llm = new LLMClient({
  provider: 'anthropic',
  model: 'claude-sonnet-4-5-20250929',
  apiKey: "ANTHROPIC_API_KEY",
  apiBaseUrl: "ANTHROPIC_API_BASE_URL",
});

// Create tools with working directory restrictions
const tools = [
  createReadTool('./workspace'),
  createWriteTool('./workspace'),
  createBashTool('./workspace'),
];

// Create Agent
const agent = new Agent(llm, 'You are a helpful assistant.', tools);

// Add user message
agent.addUserMessage('Please help me create a simple HTML file');

// Run Agent, processing event stream
for await (const event of agent.run()) {
  switch (event.type) {
    case 'thinking':
      console.log('🤔', event.thinking);
      break;
    case 'toolCall':
      console.log('🔧 Call:', event.toolCall.function.name);
      break;
    case 'toolResult':
      console.log('✅ Result:', event.result.content);
      break;
    case 'assistantMessage':
      console.log('💬', event.content);
      break;
  }
}
```

#### 2. Using the Skill System

```typescript
import { SkillLoader, createGetSkillTool } from 'mini-agents/tools';

// Load Skills
const skillLoader = new SkillLoader('./skills');
const skills = await skillLoader.loadAll();

// Create GetSkillTool
const getSkillTool = createGetSkillTool(skills);

// Declare available Skills in system prompt
const skillList = skillLoader.formatForSystemPrompt(skills);
const systemPrompt = `You are a helpful assistant.

Available Skills:
${skillList}`;

// Create Agent, including GetSkillTool
const agent = new Agent(
  llm,
  systemPrompt,
  [...tools, getSkillTool]
);
```

#### 3. Cancellation Mechanism

```typescript
// Create AbortController
const controller = new AbortController();

// Agent run with cancellation support
const runPromise = (async () => {
  for await (const event of agent.run({ signal: controller.signal })) {
    // Process events...
  }
})();

// Cancel after 5 seconds
setTimeout(() => controller.abort(), 5000);

await runPromise;
```

#### 4. Custom Tools

```typescript
import { tool } from 'mini-agents';
import { z } from 'zod';

// Create custom tools using factory functions
export function createMyTool(apiKey: string) {
  return tool({
    name: 'my_custom_tool',
    description: 'My custom tool description',
    parameters: z.object({
      input: z.string().describe('Input parameter'),
    }),
    async execute({ input }) {
      // Tool logic
      const result = await fetch(`https://api.example.com/${input}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return result.text();
    },
  });
}
```

## Configuration

### CLI Configuration

**Config file path**: `~/.mini-agents-cli/settings.json`

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
    },
    "openaiChat": {
      "apiKey": null,
      "baseUrl": null
    },
    "gemini": {
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

**Configuration Priority**:
1. Environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`)
2. `~/.mini-agents-cli/settings.json`
3. Built-in defaults

### Framework Configuration

The framework can be configured directly through code, no config file needed:

```typescript
// Supported providers: 'anthropic' | 'openai' | 'openai-chat' | 'gemini'
const llm = new LLMClient({
  provider: 'anthropic',
  model: 'claude-sonnet-4-5-20250929',
  apiKey: "ANTHROPIC_API_KEY",
  apiBaseUrl: "ANTHROPIC_API_BASE_URL",
});

const agent = new Agent(llm, systemPrompt, tools, {
  tokenLimit: 80000,  // Token threshold to trigger summarization
});
```

**Supported LLM Providers**:

| Provider | Description | Compatible Services |
|----------|-------------|---------------------|
| `anthropic` | Anthropic Messages API | Claude |
| `openai` | OpenAI Responses API | GPT-4o, etc. |
| `openai-chat` | OpenAI Chat Completions API | Ollama, vLLM, DeepSeek, OpenRouter, Groq, etc. |
| `gemini` | Google Gemini API | Gemini Pro/Flash, etc. |

## Tool List

| Tool | Description | Parameters |
|------|-------------|------------|
| `read` | Read file content | `file_path`, `offset`, `limit` |
| `write` | Write file | `file_path`, `content` |
| `edit` | Edit file (string replacement) | `file_path`, `old_string`, `new_string` |
| `bash` | Execute Shell command (foreground/background) | `command`, `timeout`, `work_dir` |
| `bash_output` | Get background command output | `id`, `regex` |
| `bash_kill` | Terminate background command | `id` |
| `get_skill` | Get Skill details | `skill_name` |

## Local Development

If you want to contribute to the project or build from source, please refer to the following steps.

### Clone and Install

```bash
# Clone repository
git clone https://github.com/liruifengv/mini-agents.git
cd mini-agents

# Install dependencies
pnpm install
```

### Run Tests

```bash
# Run all tests
pnpm test

# Run framework tests
pnpm test packages/mini-agents

# Run CLI tests
pnpm test packages/mini-agents-cli

# Run specific test file
pnpm test packages/mini-agents/tests/tools/read-tool.test.ts
```

### Build

```bash
# Build all packages
pnpm build

# Build framework
pnpm -F mini-agents build

# Build CLI
pnpm -F mini-agents-cli build
```

### Local Development

```bash
# Start framework watch mode
pnpm -F mini-agents dev

# Start CLI watch mode (depends on framework)
pnpm -F mini-agents-cli dev
```

## License

This project is licensed under the [MIT License](LICENSE).

## References

- MiniAgent Python version: https://github.com/MiniMax-AI/Mini-Agent
- MiniMax API: https://platform.minimaxi.com/document
- MiniMax-M2: https://github.com/MiniMax-AI/MiniMax-M2
- Anthropic API: https://docs.anthropic.com/claude/reference
- OpenAI API: https://platform.openai.com/docs/api-reference
- Google Gemini API: https://ai.google.dev/docs
- Claude Skills: https://github.com/anthropics/skills

---

**⭐ If this project helps you, please give it a Star!**
