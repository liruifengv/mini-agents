# mini-agents

## 0.0.3

### Patch Changes

- ef5642a: feat: add Google Gemini LLM provider support with function calling, thinking extraction, and custom base URL

## 0.0.2

### Patch Changes

- 3e2dd0b: refactor: modularize Agent class by extracting responsibilities into separate files (summarizer, cancellation, tool-executor, types) while keeping the public API unchanged.
- 7878837: BREAKING: rename `apiBase`/`apiBaseUrl` to `apiBaseURL` across both packages for naming consistency.
- e3de83c: refactor: reorganize tools directory into subdirectories by category (core, filesystem, shell, skill) and remove unused weather-tool.
- 7878837: Unify `anthropicOptions`/`openaiOptions`/`openaiChatOptions` into a single `providerOptions` field in `LLMClientOptions`. Add OpenAI Chat Completions API client (`openai-chat` provider).

## 0.0.1

### Patch Changes

- mini-agents 0.0.1
