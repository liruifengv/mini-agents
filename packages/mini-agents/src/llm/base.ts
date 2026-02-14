import type { Tool } from '../tools/base';
import type { ILLMClient, LLMResponse, Message } from '../types/llm';
import type { RetryConfig } from '../types/retry';
import { DEFAULT_RETRY_CONFIG } from '../types/retry';

/**
 * 重试回调函数类型
 *
 * @param error - 触发重试的错误
 * @param attempt - 当前重试次数（从 1 开始）
 */
export type RetryCallback = (error: Error, attempt: number) => void;

/**
 * LLM 客户端抽象基类
 *
 * 定义所有 LLM 客户端必须实现的接口，
 * 不论底层使用 Anthropic、OpenAI 还是其他 API 协议。
 */
export abstract class LLMClientBase implements ILLMClient {
  protected apiKey: string;
  protected apiBaseURL: string;
  protected model: string;
  protected retryConfig: RetryConfig;

  /** 重试回调，用于跟踪重试次数 */
  retryCallback: RetryCallback | null = null;

  constructor(apiKey: string, apiBaseURL: string, model: string, retryConfig?: RetryConfig) {
    this.apiKey = apiKey;
    this.apiBaseURL = apiBaseURL;
    this.model = model;
    this.retryConfig = retryConfig ?? DEFAULT_RETRY_CONFIG;
  }

  abstract generate(messages: Message[], tools?: Tool[]): Promise<LLMResponse>;
}
