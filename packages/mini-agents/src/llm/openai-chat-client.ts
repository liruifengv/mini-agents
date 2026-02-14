/**
 * OpenAI Chat Completions API 客户端实现
 *
 * 使用 OpenAI SDK 的 Chat Completions API（client.chat.completions.create），支持：
 * - 标准 Chat Completions 消息格式（messages 数组）
 * - Tool calling（tool_calls）
 * - Token usage 统计
 *
 * 兼容所有支持 OpenAI Chat Completions 格式的服务：
 * Ollama、vLLM、LiteLLM、OpenRouter、Together、Groq、DeepSeek 等
 */

import OpenAI from 'openai';
import type {
  ChatCompletion,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import type { Tool } from '../tools/base';
import type { LLMResponse, Message, TokenUsage, ToolCall } from '../types';
import type { RetryConfig } from '../types/retry';
import { asyncRetry } from '../utils/retry';
import { LLMClientBase } from './base';

/**
 * OpenAI Chat 客户端配置选项
 */
export interface OpenAIChatClientOptions {
  /** 最大输出 token 数（默认 16384） */
  maxTokens?: number;
  /** 温度参数（可选，由服务端决定默认值） */
  temperature?: number;
}

export class OpenAIChatClient extends LLMClientBase {
  private client: OpenAI;
  private maxTokens: number;
  private temperature: number | undefined;

  constructor(
    apiKey: string,
    apiBaseURL: string,
    model: string,
    options?: OpenAIChatClientOptions,
    retryConfig?: RetryConfig
  ) {
    super(apiKey, apiBaseURL, model, retryConfig);

    this.maxTokens = options?.maxTokens ?? 16384;
    this.temperature = options?.temperature;

    this.client = new OpenAI({
      apiKey,
      baseURL: apiBaseURL,
    });
  }

  /**
   * 将内部消息格式转换为 Chat Completions 的 messages 数组
   *
   * 转换映射：
   * - system 消息 → { role: 'system', content }
   * - user 消息 → { role: 'user', content }
   * - assistant 消息（纯文本）→ { role: 'assistant', content }
   * - assistant 消息（含 toolCalls）→ { role: 'assistant', content, tool_calls }
   * - tool 消息 → { role: 'tool', content, tool_call_id }
   */
  _convertMessages(messages: Message[]): ChatCompletionMessageParam[] {
    const result: ChatCompletionMessageParam[] = [];

    for (const msg of messages) {
      // system 消息
      if (msg.role === 'system') {
        result.push({
          role: 'system',
          content: msg.content as string,
        });
        continue;
      }

      // user 消息
      if (msg.role === 'user') {
        result.push({
          role: 'user',
          content: msg.content as string,
        });
        continue;
      }

      // assistant 消息
      if (msg.role === 'assistant') {
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          // 含 tool_calls 的 assistant 消息
          result.push({
            role: 'assistant',
            content: (msg.content as string) || null,
            tool_calls: msg.toolCalls.map((tc) => ({
              id: tc.callId,
              type: 'function' as const,
              function: {
                name: tc.function.name,
                arguments: JSON.stringify(tc.function.arguments),
              },
            })),
          });
        } else {
          // 纯文本 assistant 消息
          result.push({
            role: 'assistant',
            content: (msg.content as string) || '',
          });
        }
        continue;
      }

      // tool 结果消息
      if (msg.role === 'tool') {
        result.push({
          role: 'tool',
          content: msg.content as string,
          tool_call_id: msg.callId as string,
        });
      }
    }

    return result;
  }

  /**
   * 将 Tool 对象转换为 Chat Completions 的工具格式
   */
  _convertTools(tools: Tool[]): ChatCompletionTool[] {
    return tools.map((tool) => tool.toOpenAISchema() as ChatCompletionTool);
  }

  /**
   * 执行 API 请求
   */
  async _makeApiRequest(params: {
    messages: ChatCompletionMessageParam[];
    tools?: ChatCompletionTool[];
  }): Promise<ChatCompletion> {
    const requestParams: OpenAI.ChatCompletionCreateParamsNonStreaming = {
      model: this.model,
      messages: params.messages,
      max_tokens: this.maxTokens,
    };

    // 设置工具
    if (params.tools && params.tools.length > 0) {
      requestParams.tools = params.tools;
    }

    // 设置温度
    if (this.temperature !== undefined) {
      requestParams.temperature = this.temperature;
    }

    const response = await this.client.chat.completions.create(requestParams);

    return response;
  }

  /**
   * 解析 Chat Completions 响应为内部 LLMResponse 格式
   *
   * 从 response.choices[0].message 中提取：
   * - content → 文本内容
   * - tool_calls → toolCalls（arguments 需 JSON.parse）
   * - finish_reason → finishReason
   */
  _parseResponse(response: ChatCompletion): LLMResponse {
    const choice = response.choices[0];
    const message = choice?.message;

    // 提取文本内容
    const textContent = message?.content || '';

    // 提取 tool calls
    // Chat Completions 只有一个 id，同时作为 item ID 和关联 ID
    // 只处理 type: 'function' 的 tool call，忽略 custom 类型
    const toolCalls: ToolCall[] = [];
    if (message?.tool_calls) {
      for (const tc of message.tool_calls) {
        if (tc.type !== 'function') continue;
        const args = JSON.parse(tc.function.arguments);
        toolCalls.push({
          id: tc.id,
          callId: tc.id,
          type: 'function',
          function: {
            name: tc.function.name,
            arguments: args,
          },
        });
      }
    }

    // finish_reason 直接透传
    const finishReason = choice?.finish_reason || 'stop';

    // 提取 token usage
    let usage: TokenUsage | null = null;
    if (response.usage) {
      usage = {
        promptTokens: response.usage.prompt_tokens ?? 0,
        completionTokens: response.usage.completion_tokens ?? 0,
        totalTokens: response.usage.total_tokens ?? 0,
      };
    }

    return {
      content: textContent,
      thinking: null,
      reasoningItems: null,
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
    const chatMessages = this._convertMessages(messages);

    // 转换工具格式
    const chatTools = tools ? this._convertTools(tools) : undefined;

    // 调用 API（带重试）
    const response = await asyncRetry(
      () => this._makeApiRequest({ messages: chatMessages, tools: chatTools }),
      this.retryConfig,
      this.retryCallback ?? undefined
    );

    // 解析并返回响应
    return this._parseResponse(response);
  }
}
