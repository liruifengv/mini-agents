# mini-agents-cli

[![npm version](https://img.shields.io/npm/v/mini-agents-cli.svg)](https://www.npmjs.com/package/mini-agents-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

An interactive command-line tool built on top of the [mini-agents](https://www.npmjs.com/package/mini-agents) framework.

## Features

- 🚀 **Out-of-the-box**: Zero-configuration setup with interactive onboarding
- 💬 **Interactive Chat**: Real-time conversation with AI Agent
- 🛠️ **Built-in Tools**: File operations, shell execution, and skill system
- ⌨️ **Keyboard Shortcuts**: Support for command history, auto-completion, and cancellation
- ⚙️ **Configurable**: Persistent settings with JSON configuration files

## Installation

### Global Installation

```bash
npm install -g mini-agents-cli
```

## Usage

### First Run

Simply run the CLI:

```bash
mini-agents-cli
```

On first run, you'll be guided through an interactive setup:
1. Choose your LLM provider (Anthropic or OpenAI)
2. Enter your API key
3. Configure API base URL and model

Configuration is saved to `~/.mini-agents-cli/settings.json`.

### Commands

Once in the CLI, you can use the following commands:

| Command | Description |
|---------|-------------|
| `/help` | Show help information |
| `/clear` | Clear the screen |
| `/exit` or `/quit` | Exit the CLI |

### Keyboard Shortcuts

| Shortcut | Description |
|----------|-------------|
| `Ctrl+C` | Exit the CLI |
| `Esc` | Cancel current Agent execution |
| `↑/↓` | Navigate command history |
| `Tab` | Auto-complete commands |

## Configuration

### Configuration File

Location: `~/.mini-agents-cli/settings.json`

Example configuration:

```json
{
  "llm": {
    "apiKey": "your-api-key",
    "apiBase": "https://api.anthropic.com",
    "model": "claude-sonnet-4-5-20250929",
    "provider": "anthropic",
    "retry": {
      "enabled": true,
      "maxRetries": 3,
      "initialDelay": 1.0,
      "maxDelay": 60.0,
      "exponentialBase": 2.0
    }
  },
  "agent": {
    "maxSteps": 50,
    "workspaceDir": "./workspace",
    "systemPromptPath": "system_prompt.md"
  },
  "tools": {
    "enableFileTools": true,
    "enableBash": true,
    "enableNote": true,
    "enableSkills": true,
    "skillsDir": "./skills",
    "enableMcp": true,
    "mcpConfigPath": "mcp.json"
  }
}
```

### Environment Variables

You can also use environment variables:

- `ANTHROPIC_API_KEY` - Anthropic API key
- `ANTHROPIC_API_BASE_URL` - Anthropic API base URL
- `OPENAI_API_KEY` - OpenAI API key
- `OPENAI_API_BASE_URL` - OpenAI API base URL

### Workspace Directory

By default, the CLI operates in the current working directory. You can specify a different workspace:

```bash
mini-agents-cli --workspace /path/to/project
```

## Skills

Skills are reusable capabilities that the Agent can invoke. Place your skill files (`.md` format) in the `skills/` directory.

Example skill structure:

```
skills/
├── web-search.md
├── code-review.md
└── data-analysis.md
```

## Requirements

- Node.js 18+
- API key from Anthropic or OpenAI

## License

MIT

## Related

- [mini-agents](https://www.npmjs.com/package/mini-agents) - The underlying Agent framework
