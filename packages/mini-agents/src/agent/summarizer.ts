import type { ILLMClient, Message } from '../types/llm';
import { countTokens } from '../utils/token';
import type { AgentMessageEvent } from './types';

/**
 * 估算消息列表的总 token 数
 */
export function estimateTokens(messages: Message[]): number {
  let total = 0;
  for (const msg of messages) {
    // 文本内容
    if (typeof msg.content === 'string') {
      total += countTokens(msg.content);
    } else if (Array.isArray(msg.content)) {
      total += countTokens(JSON.stringify(msg.content));
    }
    // thinking 内容
    if (msg.thinking) {
      total += countTokens(msg.thinking);
    }
    // 工具调用
    if (msg.toolCalls) {
      total += countTokens(JSON.stringify(msg.toolCalls));
    }
    // 每条消息的元数据开销
    total += 4;
  }
  return total;
}

/**
 * 检查是否需要摘要，如果需要则执行消息压缩
 *
 * @param params.messages - 当前消息列表
 * @param params.tokenLimit - token 阈值
 * @param params.apiTotalTokens - API 报告的 token 总数
 * @param params.skipNextTokenCheck - 防抖标志
 * @param params.llmClient - LLM 客户端（用于生成摘要）
 * @returns { event, messages, skipNextTokenCheck }
 *   - event 为 null 表示未执行摘要（防抖跳过或 token 未超限）
 *   - event 非 null 表示执行了摘要
 *   - 始终返回对象，调用者无需判空
 */
export async function summarizeMessages(params: {
  messages: Message[];
  tokenLimit: number;
  apiTotalTokens: number;
  skipNextTokenCheck: boolean;
  llmClient: ILLMClient;
}): Promise<{
  event: AgentMessageEvent | null;
  messages: Message[];
  skipNextTokenCheck: boolean;
}> {
  const { messages, tokenLimit, apiTotalTokens, skipNextTokenCheck, llmClient } = params;

  // 防抖：上一轮刚摘要过，跳过本次检查
  if (skipNextTokenCheck) {
    return { event: null, messages, skipNextTokenCheck: false };
  }

  const estimatedTokens = estimateTokens(messages);
  const shouldSummarize = estimatedTokens > tokenLimit || apiTotalTokens > tokenLimit;

  if (!shouldSummarize) {
    return { event: null, messages, skipNextTokenCheck };
  }

  const beforeTokens = estimatedTokens;

  // 找到所有 user 消息的索引（跳过 system 消息）
  const userIndices: number[] = [];
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].role === 'user') {
      userIndices.push(i);
    }
  }

  if (userIndices.length === 0) {
    return { event: null, messages, skipNextTokenCheck };
  }

  // 重组消息：保留 system + 每个 user 消息 + 对应执行过程的摘要
  const newMessages: Message[] = [messages[0]]; // system 消息

  for (let u = 0; u < userIndices.length; u++) {
    const userIdx = userIndices[u];
    const nextUserIdx = u + 1 < userIndices.length ? userIndices[u + 1] : messages.length;

    // 保留 user 消息
    newMessages.push(messages[userIdx]);

    // 提取该轮的 assistant + tool 消息
    const executionMessages = messages.slice(userIdx + 1, nextUserIdx);
    if (executionMessages.length === 0) {
      continue;
    }

    // 生成摘要
    const summary = await createSummary(llmClient, executionMessages, u + 1);
    newMessages.push({
      role: 'user',
      content: `[Assistant Execution Summary]\n\n${summary}`,
    });
  }

  const afterTokens = estimateTokens(newMessages);
  return {
    event: { type: 'summarized', beforeTokens, afterTokens },
    messages: newMessages,
    skipNextTokenCheck: true,
  };
}

/**
 * 调用 LLM 生成单轮执行过程的摘要（模块私有）
 * 失败时降级为简单文本拼接
 */
async function createSummary(
  llmClient: ILLMClient,
  executionMessages: Message[],
  roundNum: number
): Promise<string> {
  // 构建执行过程描述
  let summaryContent = `Round ${roundNum} execution process:\n\n`;
  for (const msg of executionMessages) {
    if (msg.role === 'assistant') {
      if (typeof msg.content === 'string' && msg.content) {
        summaryContent += `Assistant: ${msg.content}\n`;
      }
      if (msg.toolCalls) {
        const toolNames = msg.toolCalls.map((tc) => tc.function.name).join(', ');
        summaryContent += `Tools called: ${toolNames}\n`;
      }
    } else if (msg.role === 'tool') {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      // 截断过长的工具结果
      const truncated = content.length > 500 ? `${content.slice(0, 500)}...` : content;
      summaryContent += `Tool result (${msg.name || 'unknown'}): ${truncated}\n`;
    }
  }

  // 摘要提示词
  const summarizePrompt =
    `Please provide a concise summary of the following Agent execution process:\n\n` +
    `${summaryContent}\n\n` +
    `Requirements:\n` +
    `1. Focus on what tasks were completed and which tools were called\n` +
    `2. Keep key execution results and important findings\n` +
    `3. Be concise and clear, within 1000 words\n` +
    `4. Use English\n` +
    `5. Do not include "user" related content, only summarize the Agent's execution process`;

  try {
    const response = await llmClient.generate([
      {
        role: 'system',
        content: 'You are an assistant skilled at summarizing Agent execution processes.',
      },
      { role: 'user', content: summarizePrompt },
    ]);
    return response.content || summaryContent;
  } catch {
    // 降级：直接返回执行过程文本
    return summaryContent;
  }
}
