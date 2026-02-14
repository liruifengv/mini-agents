import type { ToolResult } from '../tools/core/base';
import type { ToolCall } from '../types/llm';

/**
 * Agent 运行选项
 */
export interface RunOptions {
  /** 取消信号，用于中止 Agent 执行 */
  signal?: AbortSignal;
}

/**
 * Agent 执行步骤事件类型
 */
export type AgentMessageEvent =
  | { type: 'thinking'; thinking: string | null | undefined; content: string }
  | { type: 'toolCall'; toolCall: ToolCall }
  | { type: 'toolResult'; toolCall: ToolCall; result: ToolResult }
  | { type: 'assistantMessage'; content: string }
  | { type: 'cancelled' }
  | { type: 'summarized'; beforeTokens: number; afterTokens: number };
