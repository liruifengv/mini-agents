import { describe, expect, it, vi } from 'vitest';
import type { AgentMessageEvent } from '../../src/agent';
import { Agent } from '../../src/agent';
import type { ILLMClient, LLMResponse } from '../../src/types/llm';

/**
 * 创建 mock LLM 客户端
 * generateFn 可自定义每次 generate 的行为
 */
function createMockLLMClient(generateFn?: ILLMClient['generate']): ILLMClient {
  const defaultFn: ILLMClient['generate'] = async () => ({
    content: 'Summary of execution.',
    thinking: null,
    toolCalls: null,
    finishReason: 'end_turn',
  });
  return {
    generate: vi.fn(generateFn ?? defaultFn),
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

describe('Agent auto-summarization', () => {
  const systemPrompt = 'You are a test agent.';

  describe('_estimateTokens', () => {
    it('should count tokens for string content messages', () => {
      const client = createMockLLMClient();
      const agent = new Agent(client, systemPrompt, []);
      agent.addUserMessage('Hello world');

      const tokens = agent._estimateTokens();

      // system + user = 2 条消息，每条 +4 元数据
      // 总 token > 0
      expect(tokens).toBeGreaterThan(8);
    });

    it('should count tokens for thinking and toolCalls', () => {
      const client = createMockLLMClient();
      const agent = new Agent(client, systemPrompt, []);

      // 手动添加一条有 thinking 和 toolCalls 的 assistant 消息
      agent.messages.push({
        role: 'assistant',
        content: 'I will help you.',
        thinking: 'Let me think about this carefully...',
        toolCalls: [
          {
            callId: 'c1',
            type: 'function',
            function: { name: 'read', arguments: { path: '/tmp/test.txt' } },
          },
        ],
      });

      const tokens = agent._estimateTokens();

      // 应该包含 content + thinking + toolCalls 的 token
      expect(tokens).toBeGreaterThan(20);
    });

    it('should count tokens for array content', () => {
      const client = createMockLLMClient();
      const agent = new Agent(client, systemPrompt, []);

      agent.messages.push({
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello' }],
      });

      const tokens = agent._estimateTokens();
      expect(tokens).toBeGreaterThan(8);
    });
  });

  describe('_summarizeMessages', () => {
    it('should not summarize when tokens are below threshold', async () => {
      const client = createMockLLMClient();
      // 设置很高的阈值
      const agent = new Agent(client, systemPrompt, [], { tokenLimit: 1000000 });
      agent.addUserMessage('Hello');

      const event = await agent._summarizeMessages();

      expect(event).toBeNull();
    });

    it('should summarize when tokens exceed threshold', async () => {
      // 使用摘要用的 LLM 返回
      const client = createMockLLMClient(async (messages) => {
        // 如果是摘要请求（system prompt 包含 summarizing）
        const sysMsg = messages[0];
        if (typeof sysMsg.content === 'string' && sysMsg.content.includes('summarizing')) {
          return {
            content: 'Summarized: agent executed tools.',
            thinking: null,
            toolCalls: null,
            finishReason: 'end_turn',
          };
        }
        return {
          content: 'Normal response',
          thinking: null,
          toolCalls: null,
          finishReason: 'end_turn',
        };
      });

      // 设置极低的阈值以触发摘要
      const agent = new Agent(client, systemPrompt, [], { tokenLimit: 10 });

      // 添加一轮完整的对话
      agent.addUserMessage('Please read the file');
      agent.messages.push({
        role: 'assistant',
        content: 'I will read the file for you.',
        toolCalls: [
          {
            callId: 'c1',
            type: 'function',
            function: { name: 'read', arguments: { path: '/tmp/test.txt' } },
          },
        ],
      });
      agent.messages.push({
        role: 'tool',
        content: 'File content here: Hello world!',
        callId: 'c1',
        name: 'read',
      });

      const event = await agent._summarizeMessages();

      // 应该触发摘要
      expect(event).not.toBeNull();
      expect(event!.type).toBe('summarized');
      expect((event as any).beforeTokens).toBeGreaterThan(0);
      expect((event as any).afterTokens).toBeGreaterThan(0);
      expect((event as any).afterTokens).toBeLessThan((event as any).beforeTokens);
    });

    it('should preserve user messages after summarization', async () => {
      const client = createMockLLMClient(async () => ({
        content: 'Summary text.',
        thinking: null,
        toolCalls: null,
        finishReason: 'end_turn',
      }));

      const agent = new Agent(client, systemPrompt, [], { tokenLimit: 10 });

      // 两轮对话
      agent.addUserMessage('First question');
      agent.messages.push({
        role: 'assistant',
        content: 'First answer with lots of detail.',
        toolCalls: null,
      });

      agent.addUserMessage('Second question');
      agent.messages.push({
        role: 'assistant',
        content: 'Second answer with lots of detail.',
        toolCalls: null,
      });

      await agent._summarizeMessages();

      // 检查消息结构：system + (user1 + summary1) + (user2 + summary2)
      expect(agent.messages[0].role).toBe('system');
      expect(agent.messages[1].role).toBe('user');
      expect(agent.messages[1].content).toBe('First question');
      expect(agent.messages[2].role).toBe('user');
      expect(agent.messages[2].content).toContain('[Assistant Execution Summary]');
      expect(agent.messages[3].role).toBe('user');
      expect(agent.messages[3].content).toBe('Second question');
      expect(agent.messages[4].role).toBe('user');
      expect(agent.messages[4].content).toContain('[Assistant Execution Summary]');
    });

    it('should skip summarization with debounce flag', async () => {
      const client = createMockLLMClient(async () => ({
        content: 'Summary.',
        thinking: null,
        toolCalls: null,
        finishReason: 'end_turn',
      }));

      const agent = new Agent(client, systemPrompt, [], { tokenLimit: 10 });
      agent.addUserMessage('Hello');
      agent.messages.push({
        role: 'assistant',
        content: 'Response.',
        toolCalls: null,
      });

      // 第一次：应该触发摘要
      const event1 = await agent._summarizeMessages();
      expect(event1).not.toBeNull();

      // 第二次：应该跳过（防抖）
      const event2 = await agent._summarizeMessages();
      expect(event2).toBeNull();

      // 第三次：防抖已重置，但如果 token 仍超限则会触发
      // 由于摘要后 token 可能低于阈值，所以不一定触发
    });

    it('should not summarize when there are no user messages', async () => {
      const client = createMockLLMClient();
      const agent = new Agent(client, systemPrompt, [], { tokenLimit: 1 });

      // 只有 system 消息，没有 user 消息
      const event = await agent._summarizeMessages();
      expect(event).toBeNull();
    });

    it('should trigger summarization based on apiTotalTokens', async () => {
      const client = createMockLLMClient(async () => ({
        content: 'Summary.',
        thinking: null,
        toolCalls: null,
        finishReason: 'end_turn',
      }));

      // 设置较高的本地阈值，但通过 apiTotalTokens 触发
      const agent = new Agent(client, systemPrompt, [], { tokenLimit: 100000 });
      agent.addUserMessage('Hello');
      agent.messages.push({
        role: 'assistant',
        content: 'Response.',
        toolCalls: null,
      });

      // 手动设置 apiTotalTokens 超过阈值
      (agent as any)._apiTotalTokens = 200000;

      const event = await agent._summarizeMessages();
      expect(event).not.toBeNull();
      expect(event!.type).toBe('summarized');
    });
  });

  describe('_createSummary fallback', () => {
    it('should fallback to simple text when LLM fails', async () => {
      // LLM 调用会失败
      const client = createMockLLMClient(async () => {
        throw new Error('LLM unavailable');
      });

      const agent = new Agent(client, systemPrompt, [], { tokenLimit: 10 });
      agent.addUserMessage('Hello');
      agent.messages.push({
        role: 'assistant',
        content: 'I used a tool.',
        toolCalls: [
          {
            callId: 'c1',
            type: 'function',
            function: { name: 'read', arguments: {} },
          },
        ],
      });
      agent.messages.push({
        role: 'tool',
        content: 'tool output',
        callId: 'c1',
        name: 'read',
      });

      // 应该降级但不抛错
      const event = await agent._summarizeMessages();
      expect(event).not.toBeNull();

      // 检查摘要内容包含降级的文本
      const summaryMsg = agent.messages.find(
        (m) => typeof m.content === 'string' && m.content.includes('[Assistant Execution Summary]')
      );
      expect(summaryMsg).toBeDefined();
      // 降级文本应包含工具名称
      expect(summaryMsg!.content).toContain('read');
    });
  });

  describe('integration with run()', () => {
    it('should yield summarized event during run when tokens exceed limit', async () => {
      let generateCallCount = 0;

      const client: ILLMClient = {
        generate: vi.fn(async (messages) => {
          generateCallCount++;
          // 摘要请求
          const sysMsg = messages[0];
          if (typeof sysMsg.content === 'string' && sysMsg.content.includes('summarizing')) {
            return {
              content: 'Summarized execution.',
              thinking: null,
              toolCalls: null,
              finishReason: 'end_turn',
            };
          }
          // 第一次：工具调用
          if (generateCallCount === 1) {
            return {
              content: '',
              thinking: null,
              toolCalls: [
                {
                  callId: 'c1',
                  type: 'function',
                  function: { name: 'mock_tool', arguments: {} },
                },
              ],
              finishReason: 'tool_use',
              usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
            } as LLMResponse;
          }
          // 后续：结束
          return {
            content: 'Done.',
            thinking: null,
            toolCalls: null,
            finishReason: 'end_turn',
            usage: { promptTokens: 30, completionTokens: 10, totalTokens: 40 },
          } as LLMResponse;
        }),
      };

      const mockTool = {
        name: 'mock_tool',
        description: 'Mock tool',
        parameters: { type: 'object' as const, properties: {} },
        execute: vi.fn(async () => ({
          success: true as const,
          content: 'x'.repeat(1000), // 较长的输出以增加 token
        })),
      };

      // 极低阈值，第二步开始时会触发摘要
      const agent = new Agent(client, systemPrompt, [mockTool], { tokenLimit: 10 });
      agent.addUserMessage('Do something');

      const { events } = await collectEvents(agent.run());

      // 应该包含 summarized 事件
      const summarizedEvent = events.find((e) => e.type === 'summarized');
      expect(summarizedEvent).toBeDefined();
    });
  });
});
