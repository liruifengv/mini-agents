import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnthropicClient } from '../../src/llm/anthropic-client';
import { LLMClient } from '../../src/llm/llm-wrapper';
import { OpenAIClient } from '../../src/llm/openai-client';
import type { LLMResponse, Message } from '../../src/types/llm';

// Mock 底层客户端（使用 class 形式，才能被 new 调用）
vi.mock('../../src/llm/anthropic-client', () => {
  const MockAnthropicClient = vi.fn(function (this: any) {
    this.generate = vi.fn().mockResolvedValue({
      content: 'anthropic response',
      thinking: null,
      toolCalls: null,
      finishReason: 'end_turn',
    });
    this.retryCallback = null;
  });
  return { AnthropicClient: MockAnthropicClient };
});

vi.mock('../../src/llm/openai-client', () => {
  const MockOpenAIClient = vi.fn(function (this: any) {
    this.generate = vi.fn().mockResolvedValue({
      content: 'openai response',
      thinking: null,
      toolCalls: null,
      finishReason: 'stop',
    });
    this.retryCallback = null;
  });
  return { OpenAIClient: MockOpenAIClient };
});

describe('LLMClient', () => {
  const baseOptions = {
    apiKey: 'test-key',
    provider: 'anthropic' as const,
    apiBase: 'https://api.example.com',
    model: 'test-model',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create AnthropicClient when provider is anthropic', () => {
      const wrapper = new LLMClient(baseOptions);

      expect(wrapper.provider).toBe('anthropic');
      expect(AnthropicClient).toHaveBeenCalledWith(
        'test-key',
        'https://api.example.com',
        'test-model',
        undefined, // anthropicOptions
        undefined // retryConfig
      );
    });

    it('should create OpenAIClient when provider is openai', () => {
      const wrapper = new LLMClient({
        ...baseOptions,
        provider: 'openai',
      });

      expect(wrapper.provider).toBe('openai');
      expect(OpenAIClient).toHaveBeenCalledWith(
        'test-key',
        'https://api.example.com',
        'test-model',
        undefined, // openaiOptions
        undefined // retryConfig
      );
    });

    it('should pass anthropicOptions to AnthropicClient', () => {
      const anthropicOptions = { maxTokens: 8192 };
      new LLMClient({
        ...baseOptions,
        provider: 'anthropic',
        anthropicOptions,
      });

      expect(AnthropicClient).toHaveBeenCalledWith(
        'test-key',
        'https://api.example.com',
        'test-model',
        anthropicOptions,
        undefined
      );
    });

    it('should pass openaiOptions to OpenAIClient', () => {
      const openaiOptions = { maxOutputTokens: 8192 };
      new LLMClient({
        ...baseOptions,
        provider: 'openai',
        openaiOptions,
      });

      expect(OpenAIClient).toHaveBeenCalledWith(
        'test-key',
        'https://api.example.com',
        'test-model',
        openaiOptions,
        undefined
      );
    });

    it('should pass retryConfig to underlying client', () => {
      const retryConfig = {
        enabled: true,
        maxRetries: 5,
        initialDelay: 2,
        maxDelay: 120,
        exponentialBase: 3,
      };

      new LLMClient({
        ...baseOptions,
        provider: 'anthropic',
        retryConfig,
      });

      expect(AnthropicClient).toHaveBeenCalledWith(
        'test-key',
        'https://api.example.com',
        'test-model',
        undefined,
        retryConfig
      );
    });

    it('should throw error for unsupported provider', () => {
      expect(() => {
        new LLMClient({
          ...baseOptions,
          provider: 'unsupported' as any,
        });
      }).toThrow('Unsupported LLM provider: unsupported');
    });

    it('should store apiBase and model as readonly properties', () => {
      const wrapper = new LLMClient(baseOptions);

      expect(wrapper.apiBase).toBe('https://api.example.com');
      expect(wrapper.model).toBe('test-model');
    });
  });

  describe('generate', () => {
    it('should delegate to AnthropicClient.generate', async () => {
      const wrapper = new LLMClient({
        ...baseOptions,
        provider: 'anthropic',
      });

      const messages: Message[] = [{ role: 'user', content: 'Hello' }];
      const response = await wrapper.generate(messages);

      expect(response.content).toBe('anthropic response');
    });

    it('should delegate to OpenAIClient.generate', async () => {
      const wrapper = new LLMClient({
        ...baseOptions,
        provider: 'openai',
      });

      const messages: Message[] = [{ role: 'user', content: 'Hello' }];
      const response = await wrapper.generate(messages);

      expect(response.content).toBe('openai response');
    });

    it('should pass tools to underlying client', async () => {
      const wrapper = new LLMClient({
        ...baseOptions,
        provider: 'anthropic',
      });

      const messages: Message[] = [{ role: 'user', content: 'Hello' }];
      const mockTools = [{ name: 'test_tool' }] as any;

      await wrapper.generate(messages, mockTools);

      // 获取 mock 实例的 generate 方法并验证调用参数
      const mockInstance = (AnthropicClient as any).mock.results[0].value;
      expect(mockInstance.generate).toHaveBeenCalledWith(messages, mockTools);
    });
  });

  describe('retryCallback', () => {
    it('should get retryCallback from underlying client', () => {
      const wrapper = new LLMClient(baseOptions);

      // mock 实例的 retryCallback 默认为 null
      expect(wrapper.retryCallback).toBeNull();
    });

    it('should set retryCallback on underlying client', () => {
      const wrapper = new LLMClient(baseOptions);

      const callback = (error: Error, attempt: number) => {
        console.log(`Retry ${attempt}: ${error.message}`);
      };
      wrapper.retryCallback = callback;

      // 验证设置到了 mock 实例上
      const mockInstance = (AnthropicClient as any).mock.results[0].value;
      expect(mockInstance.retryCallback).toBe(callback);
    });
  });
});
