import Anthropic from '@anthropic-ai/sdk';
import type {
  Message as AnthropicResponseMessage,
  ContentBlock,
  MessageParam,
  TextBlock,
  ThinkingBlock,
  ThinkingConfigParam,
  ToolResultBlockParam,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources';
import type { Tool } from '../tools';
import type { LLMResponse, Message, TokenUsage, ToolCall } from '../types';
import type { RetryConfig } from '../types/retry';
import { asyncRetry } from '../utils/retry';
import { LLMClientBase } from './base';

/**
 * 消息转换结果
 */
interface ConvertMessagesResult {
  /** 系统消息 */
  systemMessage: string | null;
  /** API 消息列表 */
  apiMessages: MessageParam[];
}

// 重新导出 SDK 类型供外部使用
export type { ContentBlock, TextBlock, ThinkingBlock, ThinkingConfigParam, ToolUseBlock };

/**
 * Anthropic 客户端配置选项
 */
export interface AnthropicClientOptions {
  /** 最大输出 token 数（默认 16384） */
  maxTokens?: number;
  /** 扩展思考配置（默认开启，budget_tokens 为 10000） */
  thinking?: ThinkingConfigParam;
}

export class AnthropicClient extends LLMClientBase {
  private client: Anthropic;
  private maxTokens: number;
  private thinking: ThinkingConfigParam;

  constructor(
    apiKey: string,
    apiBaseURL: string,
    model: string,
    options?: AnthropicClientOptions,
    retryConfig?: RetryConfig
  ) {
    super(apiKey, apiBaseURL, model, retryConfig);

    this.maxTokens = options?.maxTokens ?? 16384;
    this.thinking = options?.thinking ?? { type: 'enabled', budget_tokens: 10000 };

    this.client = new Anthropic({
      baseURL: apiBaseURL,
      apiKey: apiKey,
    });
  }

  /**
   * 将内部消息格式转换为 Anthropic API 格式
   *
   * @param messages - 内部 Message 对象列表
   * @returns 包含 systemMessage 和 apiMessages 的对象
   */
  _convertMessages(messages: Message[]): ConvertMessagesResult {
    let systemMessage: string | null = null;
    const apiMessages: MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemMessage = msg.content as string;
        continue;
      }

      // 处理 user 和 assistant 消息
      if (msg.role === 'user' || msg.role === 'assistant') {
        // 处理带有 thinking 或 tool_calls 的 assistant 消息
        if (msg.role === 'assistant' && (msg.thinking || msg.toolCalls)) {
          // 为带有 thinking 和/或 tool_calls 的 assistant 构建内容块
          const contentBlocks: ContentBlock[] = [];

          // 如果存在 thinking 块则添加
          if (msg.thinking) {
            contentBlocks.push({
              type: 'thinking',
              thinking: msg.thinking,
            } as ThinkingBlock);
          }

          // 如果存在文本内容则添加
          if (msg.content) {
            contentBlocks.push({
              type: 'text',
              text: msg.content as string,
            } as TextBlock);
          }

          // 添加 tool_use 块
          if (msg.toolCalls) {
            for (const toolCall of msg.toolCalls) {
              contentBlocks.push({
                type: 'tool_use',
                id: toolCall.callId,
                name: toolCall.function.name,
                input: toolCall.function.arguments as Record<string, unknown>,
              } as ToolUseBlock);
            }
          }

          apiMessages.push({
            role: 'assistant',
            content: contentBlocks,
          });
        } else {
          // 普通消息（无 thinking 或 tool_calls）
          apiMessages.push({
            role: msg.role,
            content: msg.content as string,
          });
        }
      }
      // 处理 tool result 消息
      else if (msg.role === 'tool') {
        // Anthropic 使用 user 角色配合 tool_result 内容块
        const toolResultBlock: ToolResultBlockParam = {
          type: 'tool_result',
          tool_use_id: msg.callId as string,
          content: msg.content as string,
        };
        apiMessages.push({
          role: 'user',
          content: [toolResultBlock],
        });
      }
    }

    return {
      systemMessage,
      apiMessages,
    };
  }

  _prepareRequest(
    messages: Message[],
    tools?: Tool[]
  ): {
    systemMessage: string | null;
    apiMessages: MessageParam[];
    tools?: Tool[];
  } {
    const { systemMessage, apiMessages } = this._convertMessages(messages);

    return {
      systemMessage: systemMessage,
      apiMessages: apiMessages,
      tools: tools,
    };
  }

  async _makeApiRequest({
    systemMessage,
    apiMessages,
    tools,
  }: {
    systemMessage: string | null;
    apiMessages: MessageParam[];
    tools?: Tool[];
  }): Promise<AnthropicResponseMessage> {
    const params = {
      max_tokens: this.maxTokens,
      model: this.model,
      thinking: this.thinking,
      system: systemMessage ?? undefined,
      messages: apiMessages,
      tools: tools?.map((tool) => tool.toAnthropicSchema()) || [],
    };

    const response = await this.client.messages.create(params);

    return response;
  }

  _parseResponse(response: AnthropicResponseMessage): LLMResponse {
    // 提取文本内容、thinking 和工具调用
    let textContent = '';
    let thinkingContent = '';
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        textContent += block.text;
      } else if (block.type === 'thinking') {
        thinkingContent += (block as ThinkingBlock).thinking;
      } else if (block.type === 'tool_use') {
        // 解析 Anthropic tool_use 块
        const toolUseBlock = block as ToolUseBlock;
        toolCalls.push({
          callId: toolUseBlock.id,
          type: 'function',
          function: {
            name: toolUseBlock.name,
            arguments: toolUseBlock.input as Record<string, unknown>,
          },
        });
      }
    }

    // 提取 token usage
    let usage: TokenUsage | null = null;
    if (response.usage) {
      const promptTokens = response.usage.input_tokens ?? 0;
      const completionTokens = response.usage.output_tokens ?? 0;
      usage = {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      };
    }

    return {
      content: textContent,
      thinking: thinkingContent || null,
      toolCalls: toolCalls.length > 0 ? toolCalls : null,
      finishReason: response.stop_reason || 'stop',
      usage,
    };
  }

  async generate(messages: Message[], tools?: Tool[]): Promise<LLMResponse> {
    const requestParams = this._prepareRequest(messages, tools);

    const response = await asyncRetry(
      () => this._makeApiRequest(requestParams),
      this.retryConfig,
      this.retryCallback ?? undefined
    );

    return this._parseResponse(response);
  }
}
