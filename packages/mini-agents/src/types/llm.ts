import type { Tool } from '../tools/base';

/**
 * LLM 提供商类型
 */
export type LLMProvider = 'anthropic' | 'openai';

/**
 * 函数调用详情
 */
export interface FunctionCall {
  /** 函数名称 */
  name: string;
  /** 函数参数 */
  arguments: Record<string, unknown>;
}

/**
 * 工具调用结构
 *
 * Chat Completions API 只有一个 id（既是 item ID 也是关联 ID）。
 * Responses API 有两个 ID：
 * - id: item 自身 ID
 * - call_id: 用于与 function_call_output 关联的 ID
 *
 * 在 Agent 循环中，callId 用于关联 tool result（toolCallId），
 * id 主要用于回传 Responses API function_call input item 的 id 字段。
 *
 * 对于 Claude，block.id 既可作为工具调用 ID 也可作为关联 ID，因此统一使用 callId 字段。
 */
export interface ToolCall {
  /** Responses API 中的 item ID */
  id?: string;
  /** 工具调用关联 ID，用于发送工具调用结果时关联 */
  callId: string;
  /** 类型，固定为 "function" */
  type: 'function';
  /** 函数调用详情 */
  function: FunctionCall;
}

/**
 * 推理 item（保留原始结构，用于回传）
 *
 * Responses API 的 reasoning item 有唯一 id，
 * 在多轮对话中需要带 id 回传给 API。
 */
export interface ReasoningItem {
  /** reasoning item 的唯一 ID */
  id: string;
  /** 推理摘要文本 */
  summary: string;
}

/**
 * 消息角色类型
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export type Message = {
  role: MessageRole;
  /** 消息内容，可以是字符串或内容块数组 */
  content: string | Array<Record<string, unknown>>;
  /** 扩展思考内容（可选，用于 assistant 消息，拼接后的纯文本，用于展示） */
  thinking?: string | null;
  /** 结构化推理 items（可选，保留 id，用于回传 Responses API） */
  reasoningItems?: ReasoningItem[] | null;
  /** 工具调用列表（可选） */
  toolCalls?: ToolCall[] | null;
  /** 工具调用 ID（可选，用于 tool 消息） */
  callId?: string | null;
  /** 名称（可选，用于 tool 角色） */
  name?: string | null;
};

/**
 * Token 使用统计
 */
export interface TokenUsage {
  /** 输入 token 数 */
  promptTokens: number;
  /** 输出 token 数 */
  completionTokens: number;
  /** 总 token 数 */
  totalTokens: number;
}

export type LLMResponse = {
  content: string;
  thinking: string | null;
  /** 结构化推理 items（可选，保留 id，用于回传 Responses API） */
  reasoningItems?: ReasoningItem[] | null;
  toolCalls: ToolCall[] | null;
  finishReason: string;
  /** Token 使用统计（可选） */
  usage?: TokenUsage | null;
  /** Response ID（可选，用于 OpenAI Responses API，未来可用于 previous_response_id） */
  responseId?: string | null;
};

export interface ILLMClient {
  generate(messages: Message[], tools?: Tool[]): Promise<LLMResponse>;
}
