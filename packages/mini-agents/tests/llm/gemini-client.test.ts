import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerateContentResponse } from '@google/genai';
import { GeminiClient } from '../../src/llm/gemini-client';
import type { Message } from '../../src/types/llm';
import type { Tool } from '../../src/tools/core/base';

// 使用 vi.hoisted 提升变量，确保 vi.mock 工厂能访问到
const { mockGenerateContent, MockGoogleGenAI } = vi.hoisted(() => {
  const mockGenerateContent = vi.fn();
  const MockGoogleGenAI = vi.fn(function (this: any) {
    this.models = {
      generateContent: mockGenerateContent,
    };
  });
  return { mockGenerateContent, MockGoogleGenAI };
});

// Mock @google/genai SDK
vi.mock('@google/genai', () => {
  return { GoogleGenAI: MockGoogleGenAI };
});

// Mock retry 工具（直接执行函数，不做实际重试）
vi.mock('../../src/utils/retry', () => ({
  asyncRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));

describe('GeminiClient', () => {
  let client: GeminiClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new GeminiClient(
      'test-api-key',
      '',
      'gemini-2.5-flash'
    );
  });

  describe('constructor', () => {
    it('should create client without httpOptions when apiBaseURL is empty', () => {
      vi.clearAllMocks();

      new GeminiClient('test-key', '', 'gemini-2.5-flash');

      // 应该不传 httpOptions
      expect(MockGoogleGenAI).toHaveBeenCalledWith({ apiKey: 'test-key' });
    });

    it('should create client with httpOptions when apiBaseURL is provided', () => {
      vi.clearAllMocks();

      new GeminiClient('test-key', 'https://custom.api.com', 'gemini-2.5-flash');

      // 应该传入 httpOptions.baseUrl
      expect(MockGoogleGenAI).toHaveBeenCalledWith({
        apiKey: 'test-key',
        httpOptions: { baseUrl: 'https://custom.api.com' },
      });
    });
  });

  describe('_convertMessages', () => {
    it('should extract system message as systemInstruction', () => {
      const messages: Message[] = [
        { role: 'system', content: 'You are a helpful assistant.' },
      ];
      const result = client._convertMessages(messages);

      expect(result.systemInstruction).toBe('You are a helpful assistant.');
      expect(result.contents).toHaveLength(0);
    });

    it('should convert user message', () => {
      const messages: Message[] = [
        { role: 'user', content: 'Hello!' },
      ];
      const result = client._convertMessages(messages);

      expect(result.systemInstruction).toBeNull();
      expect(result.contents).toEqual([
        { role: 'user', parts: [{ text: 'Hello!' }] },
      ]);
    });

    it('should convert assistant message (text only) to model role', () => {
      const messages: Message[] = [
        { role: 'assistant', content: 'Hi there!' },
      ];
      const result = client._convertMessages(messages);

      expect(result.contents).toEqual([
        { role: 'model', parts: [{ text: 'Hi there!' }] },
      ]);
    });

    it('should convert assistant message with tool calls', () => {
      const messages: Message[] = [
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
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

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].role).toBe('model');
      // 应包含 functionCall part（空 content 不生成 text part）
      expect(result.contents[0].parts).toEqual([
        {
          functionCall: {
            name: 'get_weather',
            args: { city: 'Beijing' },
            id: 'call_123',
          },
        },
      ]);
    });

    it('should convert assistant message with thinking', () => {
      const messages: Message[] = [
        {
          role: 'assistant',
          content: 'The answer is 42.',
          thinking: 'Let me think about this...',
        },
      ];
      const result = client._convertMessages(messages);

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].role).toBe('model');
      expect(result.contents[0].parts).toEqual([
        { text: 'Let me think about this...', thought: true },
        { text: 'The answer is 42.' },
      ]);
    });

    it('should convert tool result message to user role with functionResponse', () => {
      const messages: Message[] = [
        {
          role: 'tool',
          content: 'Sunny, 25C',
          callId: 'call_123',
          name: 'get_weather',
        },
      ];
      const result = client._convertMessages(messages);

      expect(result.contents).toEqual([
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: 'get_weather',
                id: 'call_123',
                response: { output: 'Sunny, 25C' },
              },
            },
          ],
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
              callId: 'call_1',
              type: 'function',
              function: { name: 'get_weather', arguments: { city: 'Beijing' } },
            },
          ],
        },
        { role: 'tool', content: 'Sunny, 25C', callId: 'call_1', name: 'get_weather' },
        { role: 'assistant', content: 'The weather is sunny, 25C.' },
      ];

      const result = client._convertMessages(messages);

      expect(result.systemInstruction).toBe('You are helpful.');
      expect(result.contents).toHaveLength(4);
      // user 消息
      expect(result.contents[0]).toEqual({ role: 'user', parts: [{ text: 'What is the weather?' }] });
      // model 消息（含 functionCall）
      expect(result.contents[1].role).toBe('model');
      expect(result.contents[1].parts).toEqual([
        { functionCall: { name: 'get_weather', args: { city: 'Beijing' }, id: 'call_1' } },
      ]);
      // tool 结果（user 角色）
      expect(result.contents[2]).toEqual({
        role: 'user',
        parts: [{ functionResponse: { name: 'get_weather', id: 'call_1', response: { output: 'Sunny, 25C' } } }],
      });
      // model 最终回复
      expect(result.contents[3]).toEqual({ role: 'model', parts: [{ text: 'The weather is sunny, 25C.' }] });
    });

    it('should handle empty content in assistant message', () => {
      // assistant 消息无内容也无 toolCalls 时，应添加空 text part
      const messages: Message[] = [
        { role: 'assistant', content: '' },
      ];
      const result = client._convertMessages(messages);

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].role).toBe('model');
      // 空 content 情况下应有一个空 text part（避免空 parts 数组）
      expect(result.contents[0].parts).toEqual([{ text: '' }]);
    });
  });

  describe('_convertTools', () => {
    it('should convert tools to Gemini functionDeclarations format', () => {
      // 创建 mock tool
      const mockTool = {
        toGeminiSchema: () => ({
          name: 'test_tool',
          description: 'A test tool',
          parametersJsonSchema: { type: 'object', properties: { input: { type: 'string' } } },
        }),
      } as unknown as Tool;

      const result = client._convertTools([mockTool]);

      expect(result).toEqual([
        {
          functionDeclarations: [
            {
              name: 'test_tool',
              description: 'A test tool',
              parametersJsonSchema: { type: 'object', properties: { input: { type: 'string' } } },
            },
          ],
        },
      ]);
    });

    it('should convert multiple tools', () => {
      const mockTool1 = {
        toGeminiSchema: () => ({ name: 'tool_a', description: 'Tool A', parametersJsonSchema: {} }),
      } as unknown as Tool;
      const mockTool2 = {
        toGeminiSchema: () => ({ name: 'tool_b', description: 'Tool B', parametersJsonSchema: {} }),
      } as unknown as Tool;

      const result = client._convertTools([mockTool1, mockTool2]);

      expect(result[0].functionDeclarations).toHaveLength(2);
      expect(result[0].functionDeclarations[0].name).toBe('tool_a');
      expect(result[0].functionDeclarations[1].name).toBe('tool_b');
    });
  });

  describe('_parseResponse', () => {
    it('should parse text-only response', () => {
      const response = {
        candidates: [
          {
            content: {
              parts: [{ text: 'Hello! How can I help?' }],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
        responseId: 'resp-123',
      } as unknown as GenerateContentResponse;

      const result = client._parseResponse(response);

      expect(result.content).toBe('Hello! How can I help?');
      expect(result.thinking).toBeNull();
      expect(result.toolCalls).toBeNull();
      expect(result.finishReason).toBe('STOP');
      expect(result.usage).toEqual({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      });
      expect(result.responseId).toBe('resp-123');
    });

    it('should parse response with function calls', () => {
      const response = {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: 'get_weather',
                    args: { city: 'Beijing' },
                    id: 'fc_001',
                  },
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 20,
          candidatesTokenCount: 10,
          totalTokenCount: 30,
        },
      } as unknown as GenerateContentResponse;

      const result = client._parseResponse(response);

      expect(result.content).toBe('');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0]).toEqual({
        callId: 'fc_001',
        type: 'function',
        function: {
          name: 'get_weather',
          arguments: { city: 'Beijing' },
        },
      });
    });

    it('should generate fallback ID when FunctionCall.id is absent', () => {
      // Gemini 可能不返回 FunctionCall.id，需要生成回退 ID
      const response = {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: 'read_file',
                    args: { path: '/tmp/test.txt' },
                    // 无 id 字段
                  },
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      } as unknown as GenerateContentResponse;

      const result = client._parseResponse(response);

      expect(result.toolCalls).toHaveLength(1);
      // 回退 ID 应以 'gemini_call_' 开头
      expect(result.toolCalls![0].callId).toMatch(/^gemini_call_\d+_\d+$/);
      expect(result.toolCalls![0].function.name).toBe('read_file');
    });

    it('should parse response with thinking parts', () => {
      const response = {
        candidates: [
          {
            content: {
              parts: [
                { text: 'Let me think...', thought: true },
                { text: 'The answer is 42.' },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      } as unknown as GenerateContentResponse;

      const result = client._parseResponse(response);

      expect(result.thinking).toBe('Let me think...');
      expect(result.content).toBe('The answer is 42.');
    });

    it('should parse response with mixed thinking + text + function calls', () => {
      const response = {
        candidates: [
          {
            content: {
              parts: [
                { text: 'Thinking step 1...', thought: true },
                { text: 'Thinking step 2...', thought: true },
                { text: 'I will call a tool.' },
                {
                  functionCall: {
                    name: 'search',
                    args: { query: 'test' },
                    id: 'fc_mixed',
                  },
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 50,
          candidatesTokenCount: 100,
          totalTokenCount: 150,
        },
      } as unknown as GenerateContentResponse;

      const result = client._parseResponse(response);

      // thinking 应拼接所有 thought parts
      expect(result.thinking).toBe('Thinking step 1...Thinking step 2...');
      expect(result.content).toBe('I will call a tool.');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0].function.name).toBe('search');
      expect(result.usage).toEqual({
        promptTokens: 50,
        completionTokens: 100,
        totalTokens: 150,
      });
    });

    it('should handle missing usage metadata', () => {
      // 无 usageMetadata 字段时
      const response = {
        candidates: [
          {
            content: {
              parts: [{ text: 'ok' }],
            },
            finishReason: 'STOP',
          },
        ],
      } as unknown as GenerateContentResponse;

      const result = client._parseResponse(response);

      expect(result.usage).toBeNull();
    });

    it('should handle various finish reasons', () => {
      const testCases = ['STOP', 'MAX_TOKENS', 'SAFETY', 'RECITATION'];

      for (const reason of testCases) {
        const response = {
          candidates: [
            {
              content: { parts: [{ text: 'test' }] },
              finishReason: reason,
            },
          ],
        } as unknown as GenerateContentResponse;

        const result = client._parseResponse(response);
        expect(result.finishReason).toBe(reason);
      }
    });

    it('should handle empty candidates', () => {
      const response = {
        candidates: [],
      } as unknown as GenerateContentResponse;

      const result = client._parseResponse(response);

      expect(result.content).toBe('');
      expect(result.thinking).toBeNull();
      expect(result.toolCalls).toBeNull();
      expect(result.finishReason).toBe('STOP');
    });
  });

  describe('generate', () => {
    it('should convert messages, call API, and parse response', async () => {
      // 模拟 API 响应
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: 'Generated response' }],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 20,
          candidatesTokenCount: 10,
          totalTokenCount: 30,
        },
        responseId: 'resp-gen',
      };
      mockGenerateContent.mockResolvedValue(mockResponse);

      const messages: Message[] = [
        { role: 'system', content: 'Be helpful.' },
        { role: 'user', content: 'Hello' },
      ];

      const result = await client.generate(messages);

      // 验证 API 调用参数
      expect(mockGenerateContent).toHaveBeenCalledWith({
        model: 'gemini-2.5-flash',
        contents: [
          { role: 'user', parts: [{ text: 'Hello' }] },
        ],
        config: {
          systemInstruction: 'Be helpful.',
        },
      });

      // 验证返回结果
      expect(result.content).toBe('Generated response');
      expect(result.finishReason).toBe('STOP');
      expect(result.responseId).toBe('resp-gen');
    });

    it('should pass tools when provided', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: 'ok' }],
            },
            finishReason: 'STOP',
          },
        ],
      };
      mockGenerateContent.mockResolvedValue(mockResponse);

      // 创建 mock tool
      const mockTool = {
        toGeminiSchema: () => ({
          name: 'test_tool',
          description: 'A test tool',
          parametersJsonSchema: { type: 'object', properties: {} },
        }),
      } as unknown as Tool;

      const messages: Message[] = [{ role: 'user', content: 'test' }];
      await client.generate(messages, [mockTool]);

      // 验证工具被传递
      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            tools: [
              {
                functionDeclarations: [
                  {
                    name: 'test_tool',
                    description: 'A test tool',
                    parametersJsonSchema: { type: 'object', properties: {} },
                  },
                ],
              },
            ],
          }),
        })
      );
    });

    it('should pass thinkingConfig when configured', async () => {
      // 创建带 thinkingConfig 的客户端
      const clientWithThinking = new GeminiClient(
        'test-key',
        '',
        'gemini-2.5-flash',
        { thinkingConfig: { includeThoughts: true, thinkingBudget: 2048 } }
      );

      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: 'ok' }],
            },
            finishReason: 'STOP',
          },
        ],
      };
      mockGenerateContent.mockResolvedValue(mockResponse);

      await clientWithThinking.generate([{ role: 'user', content: 'test' }]);

      // 验证 thinkingConfig 被传递
      expect(mockGenerateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            thinkingConfig: { includeThoughts: true, thinkingBudget: 2048 },
          }),
        })
      );
    });
  });
});
