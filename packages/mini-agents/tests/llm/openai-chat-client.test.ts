import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatCompletion } from 'openai/resources/chat/completions';
import { OpenAIChatClient } from '../../src/llm/openai-chat-client';
import type { Message } from '../../src/types/llm';

// Mock OpenAI SDK（使用 function 形式，才能被 new 调用）
vi.mock('openai', () => {
  const MockOpenAI = vi.fn(function (this: any) {
    this.chat = {
      completions: {
        create: vi.fn(),
      },
    };
  });
  return { default: MockOpenAI };
});

// Mock retry 工具（直接执行函数，不做实际重试）
vi.mock('../../src/utils/retry', () => ({
  asyncRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));

describe('OpenAIChatClient', () => {
  let client: OpenAIChatClient;
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new OpenAIChatClient(
      'test-api-key',
      'https://api.example.com',
      'gpt-4o',
      { maxTokens: 4096 }
    );
    // 获取 mock 的 create 方法
    // biome-ignore lint/suspicious/noExplicitAny: 测试中需要访问 mock 内部
    mockCreate = (client as any).client.chat.completions.create;
  });

  describe('_convertMessages', () => {
    it('should convert system message', () => {
      const messages: Message[] = [
        { role: 'system', content: 'You are a helpful assistant.' },
      ];
      const result = client._convertMessages(messages);

      expect(result).toEqual([
        { role: 'system', content: 'You are a helpful assistant.' },
      ]);
    });

    it('should convert user message', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Hello!' },
      ];
      const result = client._convertMessages(messages);

      expect(result).toEqual([
        { role: 'user', content: 'Hello!' },
      ]);
    });

    it('should convert assistant message (text only)', () => {
      const messages: Message[] = [
        { role: 'assistant', content: 'Hi there!' },
      ];
      const result = client._convertMessages(messages);

      expect(result).toEqual([
        { role: 'assistant', content: 'Hi there!' },
      ]);
    });

    it('should convert assistant message with tool calls', () => {
      const messages: Message[] = [
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'call_123',
              callId: 'call_123',
              type: 'function',
              function: {
                name: 'get_weather',
                arguments: { city: 'Beijing' },
              },
            },
          ],
        },
      ];
      const result = client._convertMessages(messages);

      expect(result).toEqual([
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_123',
              type: 'function',
              function: {
                name: 'get_weather',
                arguments: '{"city":"Beijing"}',
              },
            },
          ],
        },
      ]);
    });

    it('should convert tool result message', () => {
      const messages: Message[] = [
        {
          role: 'tool',
          content: '晴天，25°C',
          callId: 'call_123',
          name: 'get_weather',
        },
      ];
      const result = client._convertMessages(messages);

      expect(result).toEqual([
        {
          role: 'tool',
          content: '晴天，25°C',
          tool_call_id: 'call_123',
        },
      ]);
    });

    it('should convert a full multi-turn conversation', () => {
      // 完整多轮对话转换
      const messages: Message[] = [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'What is the weather?' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'call_1',
              callId: 'call_1',
              type: 'function',
              function: { name: 'get_weather', arguments: { city: 'Beijing' } },
            },
          ],
        },
        { role: 'tool', content: 'Sunny, 25C', callId: 'call_1' },
        { role: 'assistant', content: 'The weather is sunny, 25°C.' },
      ];

      const result = client._convertMessages(messages);

      expect(result).toHaveLength(5);
      expect(result[0]).toEqual({ role: 'system', content: 'You are helpful.' });
      expect(result[1]).toEqual({ role: 'user', content: 'What is the weather?' });
      expect(result[2]).toMatchObject({ role: 'assistant', tool_calls: expect.any(Array) });
      expect(result[3]).toMatchObject({ role: 'tool', tool_call_id: 'call_1' });
      expect(result[4]).toEqual({ role: 'assistant', content: 'The weather is sunny, 25°C.' });
    });

    it('should handle empty content in assistant message without tool calls', () => {
      // assistant 消息无内容也无 toolCalls 时
      const messages: Message[] = [
        { role: 'assistant', content: '' },
      ];
      const result = client._convertMessages(messages);

      expect(result).toEqual([
        { role: 'assistant', content: '' },
      ]);
    });
  });

  describe('_parseResponse', () => {
    it('should parse text-only response', () => {
      const response: ChatCompletion = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Hello! How can I help?',
              refusal: null,
            },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      };

      const result = client._parseResponse(response);

      expect(result.content).toBe('Hello! How can I help?');
      expect(result.thinking).toBeNull();
      expect(result.reasoningItems).toBeNull();
      expect(result.toolCalls).toBeNull();
      expect(result.finishReason).toBe('stop');
      expect(result.usage).toEqual({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      });
      expect(result.responseId).toBe('chatcmpl-123');
    });

    it('should parse response with tool calls', () => {
      const response: ChatCompletion = {
        id: 'chatcmpl-456',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              refusal: null,
              tool_calls: [
                {
                  id: 'call_abc',
                  type: 'function',
                  function: {
                    name: 'read_file',
                    arguments: '{"path":"/tmp/test.txt"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
            logprobs: null,
          },
        ],
      };

      const result = client._parseResponse(response);

      expect(result.content).toBe('');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0]).toEqual({
        id: 'call_abc',
        callId: 'call_abc',
        type: 'function',
        function: {
          name: 'read_file',
          arguments: { path: '/tmp/test.txt' },
        },
      });
      expect(result.finishReason).toBe('tool_calls');
    });

    it('should parse response with multiple tool calls', () => {
      // 多个 tool_calls 的响应
      const response: ChatCompletion = {
        id: 'chatcmpl-789',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              refusal: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
                },
                {
                  id: 'call_2',
                  type: 'function',
                  function: { name: 'read_file', arguments: '{"path":"b.txt"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
            logprobs: null,
          },
        ],
      };

      const result = client._parseResponse(response);

      expect(result.toolCalls).toHaveLength(2);
      expect(result.toolCalls![0].callId).toBe('call_1');
      expect(result.toolCalls![1].callId).toBe('call_2');
    });

    it('should handle length finish reason', () => {
      const response: ChatCompletion = {
        id: 'chatcmpl-len',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'partial...', refusal: null },
            finish_reason: 'length',
            logprobs: null,
          },
        ],
      };

      const result = client._parseResponse(response);

      expect(result.finishReason).toBe('length');
    });

    it('should handle missing usage', () => {
      // 无 usage 字段时
      const response: ChatCompletion = {
        id: 'chatcmpl-no-usage',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'ok', refusal: null },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
      };

      const result = client._parseResponse(response);

      expect(result.usage).toBeNull();
    });
  });

  describe('generate', () => {
    it('should convert messages, call API, and parse response', async () => {
      // 模拟 API 响应
      const mockResponse: ChatCompletion = {
        id: 'chatcmpl-gen',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Generated response', refusal: null },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      };
      mockCreate.mockResolvedValue(mockResponse);

      const messages: Message[] = [
        { role: 'system', content: 'Be helpful.' },
        { role: 'user', content: 'Hello' },
      ];

      const result = await client.generate(messages);

      // 验证 API 调用参数
      expect(mockCreate).toHaveBeenCalledWith({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'Be helpful.' },
          { role: 'user', content: 'Hello' },
        ],
        max_tokens: 4096,
      });

      // 验证返回结果
      expect(result.content).toBe('Generated response');
      expect(result.finishReason).toBe('stop');
    });

    it('should pass tools when provided', async () => {
      const mockResponse: ChatCompletion = {
        id: 'chatcmpl-tools',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'ok', refusal: null },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
      };
      mockCreate.mockResolvedValue(mockResponse);

      // 创建 mock tool
      const mockTool = {
        toOpenAISchema: () => ({
          type: 'function',
          function: {
            name: 'test_tool',
            description: 'A test tool',
            parameters: { type: 'object', properties: {} },
          },
        }),
      };

      const messages: Message[] = [{ role: 'user', content: 'test' }];
      await client.generate(messages, [mockTool as unknown as Tool]);

      // 验证工具被传递
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [
            {
              type: 'function',
              function: {
                name: 'test_tool',
                description: 'A test tool',
                parameters: { type: 'object', properties: {} },
              },
            },
          ],
        })
      );
    });

    it('should set temperature when configured', async () => {
      // 创建带 temperature 的客户端
      const clientWithTemp = new OpenAIChatClient(
        'test-key',
        'https://api.example.com',
        'gpt-4o',
        { maxTokens: 1024, temperature: 0.7 }
      );

      const mockResponse: ChatCompletion = {
        id: 'chatcmpl-temp',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'ok', refusal: null },
            finish_reason: 'stop',
            logprobs: null,
          },
        ],
      };
      // biome-ignore lint/suspicious/noExplicitAny: 测试中需要访问 mock 内部
      (clientWithTemp as any).client.chat.completions.create.mockResolvedValue(mockResponse);

      await clientWithTemp.generate([{ role: 'user', content: 'test' }]);

      // biome-ignore lint/suspicious/noExplicitAny: 测试中需要访问 mock 内部
      expect((clientWithTemp as any).client.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.7,
          max_tokens: 1024,
        })
      );
    });
  });
});
