# mini-agents

[![npm version](https://img.shields.io/npm/v/mini-agents.svg)](https://www.npmjs.com/package/mini-agents)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

A minimalist yet professional TypeScript Agent framework, inspired by MiniMax's open-source Python version of [Mini-Agent](https://github.com/MiniMax-AI/Mini-Agent).

## Features

- ✅ **Complete Agent Execution Loop**: Reliable execution framework with a basic toolset for file system operations and shell execution
- ✅ **Smart Context Management**: Automatic summarization of conversation history to support long task execution
- ✅ **Skill System**: Progressive disclosure Skill mechanism, where the Agent can retrieve Skill details on demand
- ✅ **Multi-LLM Support**: Supports both Anthropic (Claude) and OpenAI APIs
- ✅ **Cancellation Mechanism**: Support for canceling Agent execution at any time with proper cleanup of session state
- ✅ **Modular Design**: Clean separation of concerns with modular architecture

## Installation

```bash
npm install mini-agents
```

## Quick Start

### Basic Usage

```typescript
import { Agent, LLMClient } from 'mini-agents';
import { createReadTool, createWriteTool, createBashTool } from 'mini-agents/tools';

// Create LLM client
const llm = new LLMClient({
  provider: 'anthropic',
  model: 'claude-sonnet-4-5-20250929',
  apiKey: process.env.ANTHROPIC_API_KEY,
  apiBase: process.env.ANTHROPIC_API_BASE_URL,
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

## API Reference

### Agent

The core Agent class that manages the conversation loop and tool execution.

```typescript
import { Agent } from 'mini-agents';

const agent = new Agent(
  llmClient,      // LLMClient instance
  systemPrompt,   // System prompt string
  tools,          // Array of tools
  options         // Optional configuration
);
```

### LLMClient

Unified client for interacting with LLM providers.

```typescript
import { LLMClient } from 'mini-agents';

const client = new LLMClient({
  provider: 'anthropic', // or 'openai'
  model: 'claude-sonnet-4-5-20250929',
  apiKey: 'your-api-key',
  apiBase: 'https://api.anthropic.com',
});
```

### Tools

#### File System Tools

```typescript
import { createReadTool, createWriteTool, createEditTool } from 'mini-agents/tools';

const readTool = createReadTool(workspaceDir);
const writeTool = createWriteTool(workspaceDir);
const editTool = createEditTool(workspaceDir);
```

#### Bash Tool

```typescript
import { createBashTool } from 'mini-agents/tools';

const bashTool = createBashTool(workspaceDir);
```

#### Skill Tool

```typescript
import { SkillLoader, createGetSkillTool } from 'mini-agents/tools';

const skillLoader = new SkillLoader('./skills');
const skills = skillLoader.discoverSkills();
const getSkillTool = createGetSkillTool(skillLoader);
```

### Custom Tools

```typescript
import { tool } from 'mini-agents';
import { z } from 'zod';

const myTool = tool({
  name: 'my_tool',
  description: 'My custom tool',
  parameters: z.object({
    input: z.string().describe('Input parameter'),
  }),
  async execute({ input }) {
    // Tool logic here
    return `Result: ${input}`;
  },
});
```

## Exports

```typescript
// Core
export { Agent, LLMClient } from 'mini-agents';

// Tools
export {
  createReadTool,
  createWriteTool,
  createEditTool,
  createBashTool,
  createBashKillTool,
  createBashOutputTool,
  SkillLoader,
  createGetSkillTool,
  tool,
} from 'mini-agents/tools';

// Types
export type {
  Message,
  LLMProvider,
  Tool,
  ToolResult,
  AgentMessageEvent,
} from 'mini-agents/types';
```

## License

MIT
