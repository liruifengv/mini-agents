import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessageEvent } from '../../src/agent';
import { Agent } from '../../src/agent';
import type { Tool, ToolResult } from '../../src/tools';
import type { ILLMClient, LLMResponse, Message } from '../../src/types/llm';

/**
 * 创建 mock LLM 客户端
 * 可以通过 responses 数组指定每次 generate 的返回值
 */
function createMockLLMClient(responses: LLMResponse[]): ILLMClient {
  let callIndex = 0;
  return {
    generate: vi.fn(async () => {
      const response = responses[callIndex] ?? responses[responses.length - 1];
      callIndex++;
      return response;
    }),
  };
}

/**
 * 创建 mock 工具
 */
function createMockTool(name: string, result: string, delay = 0): Tool {
  return {
    name,
    description: `Mock tool: ${name}`,
    parameters: { type: 'object', properties: {} },
    execute: vi.fn(async () => {
      if (delay > 0) {
        await new Promise((r) => setTimeout(r, delay));
      }
      return { success: true, content: result } as ToolResult;
    }),
  };
}

/**
 * 收集所有 AgentMessageEvent
 */
async function collectEvents(
  gen: AsyncGenerator<AgentMessageEvent, string, void>
): Promise<{ events: AgentMessageEvent[]; returnValue: string }> {
  const events: AgentMessageEvent[] = [];
  let result = await gen.next();
  while (!result.done) {
    events.push(result.value);
    result = await gen.next();
  }
  return { events, returnValue: result.value };
}

describe('Agent cancellation', () => {
  const systemPrompt = 'You are a test agent.';

  // 构造一个包含工具调用的 LLM 响应
  const toolCallResponse: LLMResponse = {
    content: '',
    thinking: null,
    toolCalls: [
      {
        callId: 'call-1',
        type: 'function',
        function: { name: 'mock_tool', arguments: {} },
      },
    ],
    finishReason: 'tool_use',
  };

  // 构造一个纯文本响应（无工具调用）
  const textResponse: LLMResponse = {
    content: 'Task completed.',
    thinking: null,
    toolCalls: null,
    finishReason: 'end_turn',
  };

  describe('checkpoint 1: cancel before step starts', () => {
    it('should cancel immediately when signal is already aborted', async () => {
      const mockClient = createMockLLMClient([toolCallResponse, textResponse]);
      const mockTool = createMockTool('mock_tool', 'done');
      const agent = new Agent(mockClient, systemPrompt, [mockTool]);
      agent.addUserMessage('hello');

      // 立即中止
      const controller = new AbortController();
      controller.abort();

      const { events, returnValue } = await collectEvents(agent.run({ signal: controller.signal }));

      // 应该收到 cancelled 事件
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('cancelled');
      expect(returnValue).toBe('Task cancelled by user.');

      // LLM 不应被调用
      expect(mockClient.generate).not.toHaveBeenCalled();
    });
  });

  describe('checkpoint 2: cancel after LLM response, before tool execution', () => {
    it('should cancel before executing tools', async () => {
      const mockClient = createMockLLMClient([toolCallResponse]);
      const mockTool = createMockTool('mock_tool', 'done');
      const agent = new Agent(mockClient, systemPrompt, [mockTool]);
      agent.addUserMessage('hello');

      const controller = new AbortController();

      // 在 LLM 返回后、工具执行前中止
      // 通过在 generate 返回后触发 abort 实现
      (mockClient.generate as any).mockImplementation(async () => {
        controller.abort();
        return toolCallResponse;
      });

      const { events, returnValue } = await collectEvents(agent.run({ signal: controller.signal }));

      // 应该有 cancelled 事件，可能还有 thinking 事件
      const cancelledEvent = events.find((e) => e.type === 'cancelled');
      expect(cancelledEvent).toBeDefined();
      expect(returnValue).toBe('Task cancelled by user.');

      // 工具不应被执行
      expect(mockTool.execute).not.toHaveBeenCalled();
    });
  });

  describe('checkpoint 3: cancel after tool execution', () => {
    it('should cancel after completing current tool', async () => {
      // 两个工具调用的响应
      const multiToolResponse: LLMResponse = {
        content: '',
        thinking: null,
        toolCalls: [
          {
            callId: 'call-1',
            type: 'function',
            function: { name: 'tool_a', arguments: {} },
          },
          {
            callId: 'call-2',
            type: 'function',
            function: { name: 'tool_b', arguments: {} },
          },
        ],
        finishReason: 'tool_use',
      };

      const mockClient = createMockLLMClient([multiToolResponse]);
      const controller = new AbortController();

      // tool_a 执行后触发取消
      const toolA: Tool = {
        name: 'tool_a',
        description: 'Tool A',
        parameters: { type: 'object', properties: {} },
        execute: vi.fn(async () => {
          controller.abort();
          return { success: true, content: 'a done' } as ToolResult;
        }),
      };

      const toolB: Tool = {
        name: 'tool_b',
        description: 'Tool B',
        parameters: { type: 'object', properties: {} },
        execute: vi.fn(async () => {
          return { success: true, content: 'b done' } as ToolResult;
        }),
      };

      const agent = new Agent(mockClient, systemPrompt, [toolA, toolB]);
      agent.addUserMessage('hello');

      const { events, returnValue } = await collectEvents(agent.run({ signal: controller.signal }));

      // tool_a 应该被执行
      expect(toolA.execute).toHaveBeenCalled();

      // tool_b 不应该被执行
      expect(toolB.execute).not.toHaveBeenCalled();

      // 应该有 cancelled 事件
      const cancelledEvent = events.find((e) => e.type === 'cancelled');
      expect(cancelledEvent).toBeDefined();
      expect(returnValue).toBe('Task cancelled by user.');
    });
  });

  describe('message cleanup after cancellation', () => {
    it('should remove incomplete assistant message and tool results', async () => {
      const mockClient = createMockLLMClient([toolCallResponse]);
      const mockTool = createMockTool('mock_tool', 'done');
      const agent = new Agent(mockClient, systemPrompt, [mockTool]);
      agent.addUserMessage('hello');

      const controller = new AbortController();

      // LLM 返回后立即中止，此时 assistant 消息已经 push 了
      (mockClient.generate as any).mockImplementation(async () => {
        controller.abort();
        return toolCallResponse;
      });

      await collectEvents(agent.run({ signal: controller.signal }));

      // 消息应该只剩 system + user，不完整的 assistant 应该被清理掉
      expect(agent.messages).toHaveLength(2);
      expect(agent.messages[0].role).toBe('system');
      expect(agent.messages[1].role).toBe('user');
    });

    it('should preserve completed steps when cancelling mid-execution', async () => {
      const controller = new AbortController();
      let callCount = 0;

      // 第一次调用：正常工具调用（完成一个完整步骤）
      // 第二次调用：工具调用，但在 LLM 返回后取消
      const mockClient: ILLMClient = {
        generate: vi.fn(async () => {
          callCount++;
          if (callCount === 2) {
            controller.abort();
          }
          if (callCount <= 2) {
            return toolCallResponse;
          }
          return textResponse;
        }),
      };

      const mockTool = createMockTool('mock_tool', 'result');
      const agent = new Agent(mockClient, systemPrompt, [mockTool]);
      agent.addUserMessage('hello');

      await collectEvents(agent.run({ signal: controller.signal }));

      // 应该保留：system + user + 第一步的 assistant + tool = 4 条
      // 第二步的 assistant 应该被清理
      expect(agent.messages).toHaveLength(4);
      expect(agent.messages[0].role).toBe('system');
      expect(agent.messages[1].role).toBe('user');
      expect(agent.messages[2].role).toBe('assistant');
      expect(agent.messages[3].role).toBe('tool');
    });

    it('should not crash when cancelling with no assistant messages', async () => {
      const mockClient = createMockLLMClient([textResponse]);
      const agent = new Agent(mockClient, systemPrompt, []);
      agent.addUserMessage('hello');

      // 在 LLM 调用前就取消
      const controller = new AbortController();
      controller.abort();

      const { events, returnValue } = await collectEvents(agent.run({ signal: controller.signal }));

      // 不应该崩溃，应该正常取消
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('cancelled');

      // 消息只有 system + user
      expect(agent.messages).toHaveLength(2);
    });
  });

  describe('no cancellation', () => {
    it('should run normally when no signal is provided', async () => {
      const mockClient = createMockLLMClient([toolCallResponse, textResponse]);
      const mockTool = createMockTool('mock_tool', 'done');
      const agent = new Agent(mockClient, systemPrompt, [mockTool]);
      agent.addUserMessage('hello');

      const { events, returnValue } = await collectEvents(agent.run());

      // 不应该有 cancelled 事件
      const cancelledEvent = events.find((e) => e.type === 'cancelled');
      expect(cancelledEvent).toBeUndefined();
      expect(returnValue).toBe('Task completed.');
    });

    it('should run normally when signal is not aborted', async () => {
      const mockClient = createMockLLMClient([textResponse]);
      const agent = new Agent(mockClient, systemPrompt, []);
      agent.addUserMessage('hello');

      const controller = new AbortController();
      // 不调用 abort()

      const { events, returnValue } = await collectEvents(agent.run({ signal: controller.signal }));

      const cancelledEvent = events.find((e) => e.type === 'cancelled');
      expect(cancelledEvent).toBeUndefined();
      expect(returnValue).toBe('Task completed.');
    });
  });

  describe('cancel during LLM call (AbortError)', () => {
    it('should cancel immediately when abort fires during generate()', async () => {
      const controller = new AbortController();

      // 模拟一个长时间的 LLM 调用，在等待期间被 abort
      const mockClient: ILLMClient = {
        generate: vi.fn(() => {
          return new Promise<LLMResponse>((resolve) => {
            // 模拟 API 等待中，50ms 后才返回
            const timer = setTimeout(() => resolve(textResponse), 50);
            // 但 10ms 后就会被 abort
            setTimeout(() => {
              controller.abort();
              clearTimeout(timer);
            }, 10);
          });
        }),
      };

      const agent = new Agent(mockClient, systemPrompt, []);
      agent.addUserMessage('hello');

      const { events, returnValue } = await collectEvents(agent.run({ signal: controller.signal }));

      // 应该立即取消，不必等 generate 返回
      const cancelledEvent = events.find((e) => e.type === 'cancelled');
      expect(cancelledEvent).toBeDefined();
      expect(returnValue).toBe('Task cancelled by user.');

      // 消息只有 system + user（没有 assistant 被 push）
      expect(agent.messages).toHaveLength(2);
    });
  });
});
