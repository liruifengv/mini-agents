---
"mini-agents-cli": patch
---

Add memory support via MEMORY.md

- Add `memory.ts` module for managing `~/.mini-agents-cli/MEMORY.md`
- Inject memory management instructions into system prompt
- Agent can now read and update memory file across sessions
