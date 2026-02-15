import { describe, expect, it, vi } from 'vitest';
import type { AgentMessageEvent } from '../../src/agent';
import { Agent } from '../../src/agent';
import type { ILLMClient, LLMResponse, Message } from '../../src/types/llm';

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

/**
 * 辅助函数：向 Agent 添加一轮完整对话（user + assistant + tool）
 */
function addRound(
  agent: Agent,
  userMsg: string,
  assistantMsg: string,
  toolName?: string,
  toolOutput?: string,
) {
  agent.addUserMessage(userMsg);
  if (toolName && toolOutput) {
    const callId = `c_${Math.random().toString(36).slice(2, 8)}`;
    agent.messages.push({
      role: 'assistant',
      content: assistantMsg,
      toolCalls: [
        {
          callId,
          type: 'function',
          function: { name: toolName, arguments: {} },
        },
      ],
    });
    agent.messages.push({
      role: 'tool',
      content: toolOutput,
      callId,
      name: toolName,
    });
  } else {
    agent.messages.push({
      role: 'assistant',
      content: assistantMsg,
      toolCalls: null,
    });
  }
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

    it('should correctly count tokens for messages with user summary', () => {
      // 验证 estimateTokens 能正确处理包含 user 摘要消息的消息列表
      const client = createMockLLMClient();
      const agent = new Agent(client, systemPrompt, []);

      agent.messages.push({
        role: 'user',
        content: '[Context Summary]\n\nThe following is a summary of our previous conversation, not a new user request.\n\nUser worked on file editing tasks.',
      });
      agent.addUserMessage('Next question');

      const tokens = agent._estimateTokens();
      // system_prompt + summary_user + user = 3 条消息
      expect(tokens).toBeGreaterThan(12);
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

    it('should summarize when tokens exceed threshold with more than 3 rounds', async () => {
      // 使用摘要用的 LLM 返回
      const client = createMockLLMClient(async (messages) => {
        // 如果是摘要请求（system prompt 包含 summarizes）
        const sysMsg = messages[0];
        if (typeof sysMsg.content === 'string' && sysMsg.content.includes('summarizes')) {
          return {
            content: 'Summarized: user worked on file tasks and read files.',
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

      // 添加 5 轮完整对话（超过 RETAINED_ROUNDS = 3）
      addRound(agent, 'Round 1 question', 'Round 1 answer', 'read', 'File content 1');
      addRound(agent, 'Round 2 question', 'Round 2 answer', 'write', 'File written');
      addRound(agent, 'Round 3 question', 'Round 3 answer', 'read', 'File content 3');
      addRound(agent, 'Round 4 question', 'Round 4 answer', 'read', 'File content 4');
      addRound(agent, 'Round 5 question', 'Round 5 answer');

      const event = await agent._summarizeMessages();

      // 应该触发摘要
      expect(event).not.toBeNull();
      expect(event!.type).toBe('summarized');
      expect((event as any).beforeTokens).toBeGreaterThan(0);
      expect((event as any).afterTokens).toBeGreaterThan(0);
      expect((event as any).afterTokens).toBeLessThan((event as any).beforeTokens);
    });

    it('should retain last 3 rounds and compress earlier rounds', async () => {
      // 分级压缩基本场景：5 轮对话
      const client = createMockLLMClient(async () => ({
        content: 'Summary of rounds 1 and 2.',
        thinking: null,
        toolCalls: null,
        finishReason: 'end_turn',
      }));

      const agent = new Agent(client, systemPrompt, [], { tokenLimit: 10 });

      // 5 轮对话
      addRound(agent, 'Round 1 question', 'Round 1 answer', 'tool_a', 'Result A');
      addRound(agent, 'Round 2 question', 'Round 2 answer', 'tool_b', 'Result B');
      addRound(agent, 'Round 3 question', 'Round 3 answer', 'tool_c', 'Result C');
      addRound(agent, 'Round 4 question', 'Round 4 answer', 'tool_d', 'Result D');
      addRound(agent, 'Round 5 question', 'Round 5 answer');

      await agent._summarizeMessages();

      // 验证消息结构：system + summary(system) + 保留的最近 3 轮
      // messages[0] = system prompt
      expect(agent.messages[0].role).toBe('system');
      expect(agent.messages[0].content).toBe(systemPrompt);

      // messages[1] = 摘要 (user 角色)
      expect(agent.messages[1].role).toBe('user');
      expect(typeof agent.messages[1].content === 'string').toBe(true);
      expect((agent.messages[1].content as string).startsWith('[Context Summary]')).toBe(true);
      expect((agent.messages[1].content as string)).toContain('Summary of rounds 1 and 2.');

      // messages[2] 起 = 保留的最近 3 轮（轮 3、4、5）
      // 轮 3：user + assistant + tool
      expect(agent.messages[2].role).toBe('user');
      expect(agent.messages[2].content).toBe('Round 3 question');
      expect(agent.messages[3].role).toBe('assistant');
      expect(agent.messages[3].content).toBe('Round 3 answer');
      expect(agent.messages[4].role).toBe('tool');

      // 轮 4
      expect(agent.messages[5].role).toBe('user');
      expect(agent.messages[5].content).toBe('Round 4 question');

      // 轮 5
      const lastUserIdx = agent.messages.findIndex(
        (m) => m.role === 'user' && m.content === 'Round 5 question'
      );
      expect(lastUserIdx).toBeGreaterThan(0);
    });

    it('should not compress when rounds <= RETAINED_ROUNDS', async () => {
      // 轮次不足不压缩：3 轮对话
      const client = createMockLLMClient();
      const agent = new Agent(client, systemPrompt, [], { tokenLimit: 10 });

      // 只有 3 轮，不超过 RETAINED_ROUNDS = 3
      addRound(agent, 'Round 1', 'Answer 1', 'read', 'content');
      addRound(agent, 'Round 2', 'Answer 2', 'read', 'content');
      addRound(agent, 'Round 3', 'Answer 3', 'read', 'content');

      const event = await agent._summarizeMessages();

      // 即使 token 超限，也不应压缩（轮次不够）
      expect(event).toBeNull();
      // 消息未被修改
      expect(agent.messages[1].role).toBe('user');
      expect(agent.messages[1].content).toBe('Round 1');
    });

    it('should not compress when rounds are fewer than RETAINED_ROUNDS (2 rounds)', async () => {
      // 轮次不足不压缩：2 轮对话
      const client = createMockLLMClient();
      const agent = new Agent(client, systemPrompt, [], { tokenLimit: 10 });

      addRound(agent, 'Round 1', 'Answer 1');
      addRound(agent, 'Round 2', 'Answer 2');

      const event = await agent._summarizeMessages();
      expect(event).toBeNull();
    });

    it('should make only 1 LLM call for batch summarization', async () => {
      // 验证只有 1 次 LLM 摘要调用
      const generateFn = vi.fn(async () => ({
        content: 'Batch summary result.',
        thinking: null,
        toolCalls: null,
        finishReason: 'end_turn',
      }));
      const client: ILLMClient = { generate: generateFn };

      const agent = new Agent(client, systemPrompt, [], { tokenLimit: 10 });

      // 5 轮对话，前 2 轮需要压缩
      addRound(agent, 'Q1', 'A1', 'tool1', 'R1');
      addRound(agent, 'Q2', 'A2', 'tool2', 'R2');
      addRound(agent, 'Q3', 'A3', 'tool3', 'R3');
      addRound(agent, 'Q4', 'A4', 'tool4', 'R4');
      addRound(agent, 'Q5', 'A5');

      await agent._summarizeMessages();

      // 只有 1 次 LLM 调用（批量摘要）
      expect(generateFn).toHaveBeenCalledTimes(1);
    });

    it('should use user role for summary messages', async () => {
      // 验证摘要消息的 role 为 'user'
      const client = createMockLLMClient(async () => ({
        content: 'Context summary.',
        thinking: null,
        toolCalls: null,
        finishReason: 'end_turn',
      }));

      const agent = new Agent(client, systemPrompt, [], { tokenLimit: 10 });

      addRound(agent, 'Q1', 'A1');
      addRound(agent, 'Q2', 'A2');
      addRound(agent, 'Q3', 'A3');
      addRound(agent, 'Q4', 'A4');

      await agent._summarizeMessages();

      // 摘要消息应在 index 1，角色为 user
      const summaryMsg = agent.messages[1];
      expect(summaryMsg.role).toBe('user');
      expect(typeof summaryMsg.content === 'string').toBe(true);
      expect((summaryMsg.content as string).startsWith('[Context Summary]')).toBe(true);
    });

    it('should skip summarization with debounce flag', async () => {
      const client = createMockLLMClient(async () => ({
        content: 'Summary.',
        thinking: null,
        toolCalls: null,
        finishReason: 'end_turn',
      }));

      const agent = new Agent(client, systemPrompt, [], { tokenLimit: 10 });

      // 添加超过 3 轮以触发压缩
      addRound(agent, 'Q1', 'A1', 'read', 'content');
      addRound(agent, 'Q2', 'A2', 'read', 'content');
      addRound(agent, 'Q3', 'A3', 'read', 'content');
      addRound(agent, 'Q4', 'A4', 'read', 'content');

      // 第一次：应该触发摘要
      const event1 = await agent._summarizeMessages();
      expect(event1).not.toBeNull();

      // 第二次：应该跳过（防抖）
      const event2 = await agent._summarizeMessages();
      expect(event2).toBeNull();

      // 第三次：防抖已重置
      // 由于摘要后消息结构变了（可能轮次不足了），不一定触发
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

      // 需要超过 3 轮
      addRound(agent, 'Q1', 'A1', 'tool1', 'R1');
      addRound(agent, 'Q2', 'A2', 'tool2', 'R2');
      addRound(agent, 'Q3', 'A3', 'tool3', 'R3');
      addRound(agent, 'Q4', 'A4', 'tool4', 'R4');

      // 手动设置 apiTotalTokens 超过阈值
      (agent as any)._apiTotalTokens = 200000;

      const event = await agent._summarizeMessages();
      expect(event).not.toBeNull();
      expect(event!.type).toBe('summarized');
    });

    it('should merge old summary into new summary on subsequent compression', async () => {
      // 合并更新场景：两次触发压缩
      let callCount = 0;
      const client = createMockLLMClient(async (messages) => {
        callCount++;
        // 第二次调用时，应包含旧摘要作为 Previous Context Summary
        const userMsg = messages.find((m) => m.role === 'user');
        if (callCount === 2 && userMsg && typeof userMsg.content === 'string') {
          expect(userMsg.content).toContain('Previous Context Summary');
          expect(userMsg.content).toContain('First batch summary');
        }
        return {
          content: callCount === 1 ? 'First batch summary.' : 'Merged summary with old context.',
          thinking: null,
          toolCalls: null,
          finishReason: 'end_turn',
        };
      });

      const agent = new Agent(client, systemPrompt, [], { tokenLimit: 10 });

      // 第一轮：5 轮对话，触发第一次压缩
      addRound(agent, 'Q1', 'A1', 'tool1', 'R1');
      addRound(agent, 'Q2', 'A2', 'tool2', 'R2');
      addRound(agent, 'Q3', 'A3', 'tool3', 'R3');
      addRound(agent, 'Q4', 'A4', 'tool4', 'R4');
      addRound(agent, 'Q5', 'A5');

      const event1 = await agent._summarizeMessages();
      expect(event1).not.toBeNull();

      // 验证第一次压缩后只有一条摘要消息
      const summaryCount1 = agent.messages.filter(
        (m) =>
          m.role === 'user' &&
          typeof m.content === 'string' &&
          m.content.startsWith('[Context Summary]')
      ).length;
      expect(summaryCount1).toBe(1);

      // 重置防抖
      await agent._summarizeMessages(); // 跳过（防抖）

      // 对话继续增长，添加更多轮次
      addRound(agent, 'Q6', 'A6', 'tool6', 'R6');
      addRound(agent, 'Q7', 'A7', 'tool7', 'R7');
      addRound(agent, 'Q8', 'A8');

      // 第二次压缩
      const event2 = await agent._summarizeMessages();
      expect(event2).not.toBeNull();

      // 验证仍然只有一条摘要消息
      const summaryCount2 = agent.messages.filter(
        (m) =>
          m.role === 'user' &&
          typeof m.content === 'string' &&
          m.content.startsWith('[Context Summary]')
      ).length;
      expect(summaryCount2).toBe(1);

      // 验证新摘要包含合并后的内容
      const summaryMsg = agent.messages.find(
        (m) =>
          m.role === 'user' &&
          typeof m.content === 'string' &&
          m.content.startsWith('[Context Summary]')
      );
      expect(summaryMsg).toBeDefined();
      expect((summaryMsg!.content as string)).toContain('Merged summary with old context.');
    });

    it('should detect existing summary message in messages', async () => {
      // 旧摘要检测：消息列表中存在旧 [Context Summary] system 消息时能被正确识别
      const client = createMockLLMClient(async (messages) => {
        // 检查传给 LLM 的内容中包含旧摘要
        const userMsg = messages.find((m) => m.role === 'user');
        if (userMsg && typeof userMsg.content === 'string') {
          expect(userMsg.content).toContain('Previous Context Summary');
          expect(userMsg.content).toContain('Old summary content here');
        }
        return {
          content: 'New merged summary.',
          thinking: null,
          toolCalls: null,
          finishReason: 'end_turn',
        };
      });

      const agent = new Agent(client, systemPrompt, [], { tokenLimit: 10 });

      // 手动构建包含旧摘要的消息结构（模拟第一次压缩后的状态）
      agent.messages.push({
        role: 'user',
        content: '[Context Summary]\n\nThe following is a summary of our previous conversation, not a new user request.\n\nOld summary content here.',
      });

      // 添加已保留的轮次 + 新轮次（共 > 3 轮 user 消息）
      addRound(agent, 'Q3', 'A3', 'tool3', 'R3');
      addRound(agent, 'Q4', 'A4', 'tool4', 'R4');
      addRound(agent, 'Q5', 'A5', 'tool5', 'R5');
      addRound(agent, 'Q6', 'A6');

      const event = await agent._summarizeMessages();
      expect(event).not.toBeNull();

      // 验证只有一条摘要消息
      const summaries = agent.messages.filter(
        (m) =>
          m.role === 'user' &&
          typeof m.content === 'string' &&
          m.content.startsWith('[Context Summary]')
      );
      expect(summaries.length).toBe(1);
      expect((summaries[0].content as string)).toContain('New merged summary.');
    });
  });

  describe('_createBatchSummary fallback', () => {
    it('should preserve original messages when LLM fails', async () => {
      // LLM 调用会失败
      const client = createMockLLMClient(async () => {
        throw new Error('LLM unavailable');
      });

      const agent = new Agent(client, systemPrompt, [], { tokenLimit: 10 });

      // 需要超过 3 轮
      addRound(agent, 'Q1', 'A1', 'read', 'content');
      addRound(agent, 'Q2', 'A2', 'write', 'content');
      addRound(agent, 'Q3', 'A3', 'read', 'content');
      addRound(agent, 'Q4', 'A4', 'read', 'content');

      // 保存原始消息长度
      const originalLength = agent.messages.length;
      const originalMessages = [...agent.messages];

      // 应该降级但不抛错
      const event = await agent._summarizeMessages();

      // 降级：event 为 null，原始消息保留不变
      expect(event).toBeNull();
      expect(agent.messages.length).toBe(originalLength);
      // 验证消息内容未被修改
      for (let i = 0; i < originalLength; i++) {
        expect(agent.messages[i].content).toBe(originalMessages[i].content);
        expect(agent.messages[i].role).toBe(originalMessages[i].role);
      }
    });

    it('should treat empty LLM response as failure', async () => {
      // LLM 返回空字符串
      const client = createMockLLMClient(async () => ({
        content: '',
        thinking: null,
        toolCalls: null,
        finishReason: 'end_turn',
      }));

      const agent = new Agent(client, systemPrompt, [], { tokenLimit: 10 });

      addRound(agent, 'Q1', 'A1', 'read', 'content');
      addRound(agent, 'Q2', 'A2', 'write', 'content');
      addRound(agent, 'Q3', 'A3', 'read', 'content');
      addRound(agent, 'Q4', 'A4', 'read', 'content');

      const originalLength = agent.messages.length;

      const event = await agent._summarizeMessages();

      // 空摘要走降级路径：event 为 null，原始消息保留
      expect(event).toBeNull();
      expect(agent.messages.length).toBe(originalLength);
    });

    it('should treat whitespace-only LLM response as failure', async () => {
      // LLM 返回仅包含空白字符
      const client = createMockLLMClient(async () => ({
        content: '   \n\t  ',
        thinking: null,
        toolCalls: null,
        finishReason: 'end_turn',
      }));

      const agent = new Agent(client, systemPrompt, [], { tokenLimit: 10 });

      addRound(agent, 'Q1', 'A1');
      addRound(agent, 'Q2', 'A2');
      addRound(agent, 'Q3', 'A3');
      addRound(agent, 'Q4', 'A4');

      const originalLength = agent.messages.length;
      const event = await agent._summarizeMessages();

      expect(event).toBeNull();
      expect(agent.messages.length).toBe(originalLength);
    });
  });

  describe('thinking content filtering', () => {
    it('should not include thinking content in summary input', async () => {
      // 验证 thinking 内容不出现在传给摘要 LLM 的输入中
      let capturedInput = '';
      const client = createMockLLMClient(async (messages) => {
        const userMsg = messages.find((m) => m.role === 'user');
        if (userMsg && typeof userMsg.content === 'string') {
          capturedInput = userMsg.content;
        }
        return {
          content: 'Summary without thinking.',
          thinking: null,
          toolCalls: null,
          finishReason: 'end_turn',
        };
      });

      const agent = new Agent(client, systemPrompt, [], { tokenLimit: 10 });

      // 第 1 轮有 thinking 内容
      agent.addUserMessage('Q1');
      agent.messages.push({
        role: 'assistant',
        content: 'A1 visible text',
        thinking: 'This is secret thinking that should NOT be in summary input',
        toolCalls: null,
      });

      // 其他轮次
      addRound(agent, 'Q2', 'A2');
      addRound(agent, 'Q3', 'A3');
      addRound(agent, 'Q4', 'A4');

      await agent._summarizeMessages();

      // 验证传给 LLM 的摘要输入不包含 thinking 内容
      expect(capturedInput).not.toContain('secret thinking');
      // 但应包含可见的 assistant 内容
      expect(capturedInput).toContain('A1 visible text');
    });
  });

  describe('token count verification', () => {
    it('should have afterTokens < beforeTokens after compression', async () => {
      // 验证压缩前后 estimateTokens 返回的 token 数变化
      const client = createMockLLMClient(async () => ({
        content: 'Brief summary.',
        thinking: null,
        toolCalls: null,
        finishReason: 'end_turn',
      }));

      const agent = new Agent(client, systemPrompt, [], { tokenLimit: 10 });

      // 添加 5 轮有内容的对话
      addRound(agent, 'Question about file A with long description', 'Answer with details about file A', 'read', 'Long file content '.repeat(50));
      addRound(agent, 'Question about file B with long description', 'Answer with details about file B', 'write', 'Written content '.repeat(50));
      addRound(agent, 'Q3 short', 'A3 short');
      addRound(agent, 'Q4 short', 'A4 short');
      addRound(agent, 'Q5 short', 'A5 short');

      const event = await agent._summarizeMessages();

      expect(event).not.toBeNull();
      expect((event as any).afterTokens).toBeLessThan((event as any).beforeTokens);
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
          if (typeof sysMsg.content === 'string' && sysMsg.content.includes('summarizes')) {
            return {
              content: 'Summarized execution.',
              thinking: null,
              toolCalls: null,
              finishReason: 'end_turn',
            };
          }
          // 前 4 次：工具调用（构建 4 轮对话）
          if (generateCallCount <= 4) {
            return {
              content: '',
              thinking: null,
              toolCalls: [
                {
                  callId: `c${generateCallCount}`,
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

      // 极低阈值
      const agent = new Agent(client, systemPrompt, [mockTool], { tokenLimit: 10 });
      // 预填充 3 轮对话历史以确保超过 RETAINED_ROUNDS
      addRound(agent, 'Pre Q1', 'Pre A1', 'mock_tool', 'Pre R1');
      addRound(agent, 'Pre Q2', 'Pre A2', 'mock_tool', 'Pre R2');
      addRound(agent, 'Pre Q3', 'Pre A3', 'mock_tool', 'Pre R3');
      agent.addUserMessage('Do something');

      const { events } = await collectEvents(agent.run());

      // 应该包含 summarized 事件
      const summarizedEvent = events.find((e) => e.type === 'summarized');
      expect(summarizedEvent).toBeDefined();
    });
  });
});
