/**
 * 记忆文件管理
 *
 * 管理 ~/.mini-agents-cli/memory.md 文件，为 Agent 提供跨会话的持久化记忆。
 */

import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DIR } from './config.js';

/** 记忆文件路径 */
const MEMORY_FILE = join(CONFIG_DIR, 'MEMORY.md');

/** 默认记忆模板 */
const MEMORY_TEMPLATE = `# Agent Memory

## User Info
<!-- User preferences, identity, communication style -->

## Project Context
<!-- Project-specific information, tech stack, architecture -->

## Active Tasks
<!-- Current work items, TODOs -->

## Decisions
<!-- Key decisions made and their rationale -->
`;

/**
 * 确保记忆文件存在，不存在则创建默认模板
 * @returns 记忆文件的绝对路径
 */
export function ensureMemoryFile(): string {
  if (!existsSync(MEMORY_FILE)) {
    writeFileSync(MEMORY_FILE, MEMORY_TEMPLATE, 'utf-8');
  }
  return MEMORY_FILE;
}

/**
 * 获取记忆管理指令，用于注入到 system prompt
 * @returns 记忆管理指令文本
 */
export function getMemoryInstructions(): string {
  const memoryFile = ensureMemoryFile();

  return `## Memory Management

You have a memory file at: \`${memoryFile}\`

This file persists across all sessions. Guidelines:
1. **At the start of conversation**: Read this file to understand previous context
2. **At the end of conversation**: Update this file with new information worth remembering (user preferences, project details, decisions, action items)
3. **Be selective**: Only record important, persistent information. Delete outdated entries instead of just appending.
4. **Keep organized**: Maintain information under the existing sections (User Info, Project Context, Active Tasks, Decisions)`;
}
