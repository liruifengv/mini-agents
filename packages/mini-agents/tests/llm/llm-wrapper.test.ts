import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnthropicClient } from '../../src/llm/anthropic-client';
import { GeminiClient } from '../../src/llm/gemini-client';
import { LLMClient } from '../../src/llm/llm-wrapper';
import { OpenAIChatClient } from '../../src/llm/openai-chat-client';
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

vi.mock('../../src/llm/openai-chat-client', () => {
  const MockOpenAIChatClient = vi.fn(function (this: any) {
    this.generate = vi.fn().mockResolvedValue({
      content: 'openai-chat response',
      thinking: null,
      toolCalls: null,
      finishReason: 'stop',
    });
    this.retryCallback = null;
  });
  return { OpenAIChatClient: MockOpenAIChatClient };
});

vi.mock('../../src/llm/gemini-client', () => {
  const MockGeminiClient = vi.fn(function (this: any) {
    this.generate = vi.fn().mockResolvedValue({
      content: 'gemini response',
      thinking: null,
      toolCalls: null,
      finishReason: 'STOP',
    });
    this.retryCallback = null;
  });
  return { GeminiClient: MockGeminiClient };
});

describe('LLMClient', () => {
  const baseOptions = {
    apiKey: 'test-key',
    provider: 'anthropic' as const,
    apiBaseURL: 'https://api.example.com',
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
        undefined, // providerOptions
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
        undefined, // providerOptions
        undefined // retryConfig
      );
    });

    it('should pass providerOptions to AnthropicClient', () => {
      const providerOptions = { maxTokens: 8192 };
      new LLMClient({
        ...baseOptions,
        provider: 'anthropic',
        providerOptions,
      });

      expect(AnthropicClient).toHaveBeenCalledWith(
        'test-key',
        'https://api.example.com',
        'test-model',
        providerOptions,
        undefined
      );
    });

    it('should pass providerOptions to OpenAIClient', () => {
      const providerOptions = { maxOutputTokens: 8192 };
      new LLMClient({
        ...baseOptions,
        provider: 'openai',
        providerOptions,
      });

      expect(OpenAIClient).toHaveBeenCalledWith(
        'test-key',
        'https://api.example.com',
        'test-model',
        providerOptions,
        undefined
      );
    });

    it('should create OpenAIChatClient when provider is openai-chat', () => {
      const wrapper = new LLMClient({
        ...baseOptions,
        provider: 'openai-chat',
      });

      expect(wrapper.provider).toBe('openai-chat');
      expect(OpenAIChatClient).toHaveBeenCalledWith(
        'test-key',
        'https://api.example.com',
        'test-model',
        undefined, // providerOptions
        undefined // retryConfig
      );
    });

    it('should pass providerOptions to OpenAIChatClient', () => {
      const providerOptions = { maxTokens: 4096, temperature: 0.5 };
      new LLMClient({
        ...baseOptions,
        provider: 'openai-chat',
        providerOptions,
      });

      expect(OpenAIChatClient).toHaveBeenCalledWith(
        'test-key',
        'https://api.example.com',
        'test-model',
        providerOptions,
        undefined
      );
    });

    it('should create GeminiClient when provider is gemini', () => {
      const wrapper = new LLMClient({
        ...baseOptions,
        provider: 'gemini',
      });

      expect(wrapper.provider).toBe('gemini');
      expect(GeminiClient).toHaveBeenCalledWith(
        'test-key',
        'https://api.example.com',
        'test-model',
        undefined, // providerOptions
        undefined // retryConfig
      );
    });

    it('should pass providerOptions to GeminiClient', () => {
      const providerOptions = { thinkingConfig: { includeThoughts: true, thinkingBudget: 2048 } };
      new LLMClient({
        ...baseOptions,
        provider: 'gemini',
        providerOptions,
      });

      expect(GeminiClient).toHaveBeenCalledWith(
        'test-key',
        'https://api.example.com',
        'test-model',
        providerOptions,
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

    it('should store apiBaseURL and model as readonly properties', () => {
      const wrapper = new LLMClient(baseOptions);

      expect(wrapper.apiBaseURL).toBe('https://api.example.com');
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

    it('should delegate to OpenAIChatClient.generate', async () => {
      const wrapper = new LLMClient({
        ...baseOptions,
        provider: 'openai-chat',
      });

      const messages: Message[] = [{ role: 'user', content: 'Hello' }];
      const response = await wrapper.generate(messages);

      expect(response.content).toBe('openai-chat response');
    });

    it('should delegate to GeminiClient.generate', async () => {
      const wrapper = new LLMClient({
        ...baseOptions,
        provider: 'gemini',
      });

      const messages: Message[] = [{ role: 'user', content: 'Hello' }];
      const response = await wrapper.generate(messages);

      expect(response.content).toBe('gemini response');
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
