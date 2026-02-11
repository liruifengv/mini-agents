/**
 * OpenAI 协议 LLM 客户端实现（Responses API）
 *
 * 使用 OpenAI SDK 的 Responses API（client.responses.create），支持：
 * - 原生 reasoning（通过 reasoning 参数）
 * - Tool calling（function_call items）
 * - Token usage 统计
 * - 手动拼接 input items 模式（客户端管理对话历史）
 */

import OpenAI from 'openai';
import type {
  FunctionTool,
  Response,
  ResponseFunctionToolCall,
  ResponseInput,
  ResponseInputItem,
  ResponseOutputMessage,
  ResponseReasoningItem,
} from 'openai/resources/responses/responses';
import type { Reasoning } from 'openai/resources/shared';
import type { Tool } from '../tools/base';
import type { LLMResponse, Message, ReasoningItem, TokenUsage, ToolCall } from '../types';
import type { RetryConfig } from '../types/retry';
import { asyncRetry } from '../utils/retry';
import { LLMClientBase } from './base';

/**
 * 消息转换结果
 */
interface ConvertMessagesResult {
  /** instructions 参数（从 system 消息提取） */
  instructions: string | null;
  /** 输入 items 列表 */
  input: ResponseInput;
}

/**
 * OpenAI 客户端配置选项
 */
export interface OpenAIClientOptions {
  /** 最大输出 token 数（默认 16384） */
  maxOutputTokens?: number;
  /** 推理配置（effort + summary） */
  reasoning?: Reasoning | null;
  /** 是否存储响应（默认 undefined，由服务端决定） */
  store?: boolean;
}

export class OpenAIClient extends LLMClientBase {
  private client: OpenAI;
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: initialized but used via getter
  private maxOutputTokens: number;
  private reasoning: Reasoning | null;
  private store: boolean | undefined;

  constructor(
    apiKey: string,
    apiBaseUrl: string,
    model: string,
    options?: OpenAIClientOptions,
    retryConfig?: RetryConfig
  ) {
    super(apiKey, apiBaseUrl, model, retryConfig);

    this.maxOutputTokens = options?.maxOutputTokens ?? 16384;
    this.reasoning = options?.reasoning ?? null;
    this.store = options?.store;

    this.client = new OpenAI({
      apiKey,
      baseURL: apiBaseUrl,
    });
  }

  /**
   * 将内部消息格式转换为 Responses API 的 input items
   *
   * 转换映射：
   * - system 消息 → 提取到 instructions 参数
   * - user 消息 → EasyInputMessage (role: 'user')
   * - assistant 消息（thinking）→ reasoning item（summary）
   * - assistant 消息（纯文本）→ EasyInputMessage (role: 'assistant')
   * - assistant 消息（含 toolCalls）→ function_call items + 可选的 message item
   * - tool 消息 → function_call_output item
   */
  _convertMessages(messages: Message[]): ConvertMessagesResult {
    let instructions: string | null = null;
    const input: ResponseInput = [];

    for (const msg of messages) {
      // system 消息：提取到 instructions 参数
      if (msg.role === 'system') {
        instructions = msg.content as string;
        continue;
      }

      // user 消息：使用 EasyInputMessage 简写格式
      if (msg.role === 'user') {
        input.push({
          role: 'user',
          content: msg.content as string,
        });
        continue;
      }

      // assistant 消息
      if (msg.role === 'assistant') {
        // 如果有 reasoning items（带 id），逐个回传
        if (msg.reasoningItems) {
          for (const ri of msg.reasoningItems) {
            input.push({
              type: 'reasoning',
              id: ri.id,
              summary: [{ type: 'summary_text', text: ri.summary }],
            } as ResponseInputItem);
          }
        }

        // 如果有 tool_calls，转换为 function_call items
        // id = item 自身 ID，call_id = 关联 ID
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            input.push({
              type: 'function_call',
              name: tc.function.name,
              arguments: JSON.stringify(tc.function.arguments),
              call_id: tc.callId,
              id: tc.id,
              status: 'completed',
            } as ResponseInputItem);
          }
        }

        // 如果有文本内容，添加 assistant message item
        if (msg.content) {
          input.push({
            role: 'assistant',
            content: msg.content as string,
          });
        }

        continue;
      }

      // tool result 消息：转换为 function_call_output item
      if (msg.role === 'tool') {
        input.push({
          type: 'function_call_output',
          call_id: msg.callId as string,
          output: msg.content as string,
        } as ResponseInputItem);
      }
    }

    return { instructions, input };
  }

  /**
   * 将 Tool 对象转换为 Responses API 的 FunctionTool 格式
   */
  _convertTools(tools: Tool[]): FunctionTool[] {
    return tools.map((tool) => tool.toResponsesSchema() as FunctionTool);
  }

  /**
   * 执行 API 请求
   */
  async _makeApiRequest(params: {
    instructions: string | null;
    input: ResponseInput;
    tools?: FunctionTool[];
  }): Promise<Response> {
    const requestParams: OpenAI.Responses.ResponseCreateParamsNonStreaming = {
      model: this.model,
      input: params.input,
      max_output_tokens: this.maxOutputTokens,
    };

    // 设置 instructions（system prompt）
    if (params.instructions) {
      requestParams.instructions = params.instructions;
    }

    // 设置工具
    if (params.tools && params.tools.length > 0) {
      requestParams.tools = params.tools;
    }

    // 设置推理配置
    if (this.reasoning) {
      requestParams.reasoning = this.reasoning;
    }

    // 设置存储选项
    if (this.store !== undefined) {
      requestParams.store = this.store;
    }

    const response = await this.client.responses.create(requestParams);

    return response;
  }

  /**
   * 解析 Responses API 响应为内部 LLMResponse 格式
   *
   * 遍历 response.output 数组，按 item type 分别提取：
   * - message → content（拼接所有文本）
   * - function_call → toolCalls（arguments 需 JSON.parse）
   * - reasoning → thinking（拼接所有 summary 文本）
   */
  _parseResponse(response: Response): LLMResponse {
    let textContent = '';
    let thinkingContent = '';
    const reasoningItems: ReasoningItem[] = [];
    const toolCalls: ToolCall[] = [];

    for (const item of response.output) {
      // 提取文本内容（从 message item 的 content 中）
      if (item.type === 'message') {
        const messageItem = item as ResponseOutputMessage;
        for (const contentBlock of messageItem.content) {
          if (contentBlock.type === 'output_text') {
            textContent += contentBlock.text;
          }
        }
        continue;
      }

      // 提取 tool calls（从 function_call item 中）
      // id = item 自身 ID，call_id = 关联 ID（用于匹配 function_call_output）
      if (item.type === 'function_call') {
        const fcItem = item as ResponseFunctionToolCall;
        const args = JSON.parse(fcItem.arguments);
        toolCalls.push({
          id: fcItem.id || '',
          callId: fcItem.call_id,
          type: 'function',
          function: {
            name: fcItem.name,
            arguments: args,
          },
        });
        continue;
      }

      // 提取 thinking 内容（从 reasoning item 的 summary 中）
      // 保留原始 id，用于回传
      if (item.type === 'reasoning') {
        const reasoningItem = item as ResponseReasoningItem;
        let summaryText = '';
        if (reasoningItem.summary) {
          for (const summary of reasoningItem.summary) {
            summaryText += summary.text;
          }
        }
        thinkingContent += summaryText;
        reasoningItems.push({
          id: reasoningItem.id,
          summary: summaryText,
        });
      }
    }

    // 映射 status → finishReason
    // completed → stop, incomplete → length
    let finishReason = 'stop';
    if (response.status === 'incomplete') {
      finishReason = 'length';
    } else if (response.status === 'failed') {
      finishReason = 'error';
    } else if (response.status === 'cancelled') {
      finishReason = 'cancelled';
    }

    // 提取 token usage
    let usage: TokenUsage | null = null;
    if (response.usage) {
      usage = {
        promptTokens: response.usage.input_tokens ?? 0,
        completionTokens: response.usage.output_tokens ?? 0,
        totalTokens: response.usage.total_tokens ?? 0,
      };
    }

    return {
      content: textContent,
      thinking: thinkingContent || null,
      reasoningItems: reasoningItems.length > 0 ? reasoningItems : null,
      toolCalls: toolCalls.length > 0 ? toolCalls : null,
      finishReason,
      usage,
      responseId: response.id,
    };
  }

  /**
   * 生成 LLM 响应
   */
  async generate(messages: Message[], tools?: Tool[]): Promise<LLMResponse> {
    // 转换消息格式
    const { instructions, input } = this._convertMessages(messages);

    // 转换工具格式
    const responsesTools = tools ? this._convertTools(tools) : undefined;

    // 调用 API（带重试）
    const response = await asyncRetry(
      () => this._makeApiRequest({ instructions, input, tools: responsesTools }),
      this.retryConfig,
      this.retryCallback ?? undefined
    );

    // 解析并返回响应
    return this._parseResponse(response);
  }
}
