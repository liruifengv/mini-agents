/**
 * 统一 LLM 客户端封装
 *
 * 根据 provider 参数自动选择底层客户端（Anthropic / OpenAI），
 * 对外暴露统一的 generate 接口。
 */

import type { Tool } from '../tools';
import type { LLMProvider, LLMResponse, Message } from '../types/llm';
import type { RetryConfig } from '../types/retry';
import type { AnthropicClientOptions } from './anthropic-client';
import { AnthropicClient } from './anthropic-client';
import type { LLMClientBase, RetryCallback } from './base';
import type { OpenAIChatClientOptions } from './openai-chat-client';
import { OpenAIChatClient } from './openai-chat-client';
import type { OpenAIClientOptions } from './openai-client';
import { OpenAIClient } from './openai-client';

/**
 * LLM Wrapper 配置选项
 */
export interface LLMClientOptions {
  /** API 认证密钥 */
  apiKey: string;
  /** LLM 提供商 */
  provider: LLMProvider;
  /** API 基础 URL */
  apiBaseURL: string;
  /** 模型名称 */
  model: string;
  /** 重试配置（可选） */
  retryConfig?: RetryConfig;
  /** Provider 特定选项（可选） */
  providerOptions?: AnthropicClientOptions | OpenAIClientOptions | OpenAIChatClientOptions;
}

/**
 * 统一 LLM 客户端封装类
 *
 * 使用策略模式，根据 provider 自动实例化对应的底层客户端，
 * 对外提供统一的 generate 接口。
 *
 * @example
 * ```ts
 * const client = new LLMClient({
 *   apiKey: 'sk-xxx',
 *   provider: 'anthropic',
 *   apiBaseURL: 'https://api.anthropic.com',
 *   model: 'claude-sonnet-4-20250514',
 * });
 * const response = await client.generate(messages, tools);
 * ```
 */
export class LLMClient {
  /** 当前使用的提供商 */
  readonly provider: LLMProvider;
  /** API 基础 URL */
  readonly apiBaseURL: string;
  /** 模型名称 */
  readonly model: string;

  /** 底层 LLM 客户端实例 */
  private _client: LLMClientBase;

  constructor(options: LLMClientOptions) {
    const { apiKey, provider, apiBaseURL, model, retryConfig, providerOptions } = options;

    this.provider = provider;
    this.apiBaseURL = apiBaseURL;
    this.model = model;

    // 根据 provider 实例化对应的客户端
    switch (provider) {
      case 'anthropic':
        this._client = new AnthropicClient(
          apiKey,
          apiBaseURL,
          model,
          providerOptions as AnthropicClientOptions,
          retryConfig
        );
        break;
      case 'openai':
        this._client = new OpenAIClient(
          apiKey,
          apiBaseURL,
          model,
          providerOptions as OpenAIClientOptions,
          retryConfig
        );
        break;
      case 'openai-chat':
        this._client = new OpenAIChatClient(
          apiKey,
          apiBaseURL,
          model,
          providerOptions as OpenAIChatClientOptions,
          retryConfig
        );
        break;
      default:
        throw new Error(`Unsupported LLM provider: ${provider as string}`);
    }
  }

  /** 获取重试回调 */
  get retryCallback(): RetryCallback | null {
    return this._client.retryCallback;
  }

  /** 设置重试回调 */
  set retryCallback(value: RetryCallback | null) {
    this._client.retryCallback = value;
  }

  /**
   * 生成 LLM 响应
   *
   * @param messages - 对话消息列表
   * @param tools - 可用工具列表（可选）
   * @returns LLM 响应结果
   */
  async generate(messages: Message[], tools?: Tool[]): Promise<LLMResponse> {
    return this._client.generate(messages, tools);
  }
}
