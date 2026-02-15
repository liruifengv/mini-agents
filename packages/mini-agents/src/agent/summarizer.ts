import type { ILLMClient, Message } from '../types/llm';
import { countTokens } from '../utils/token';
import type { AgentMessageEvent } from './types';

/** 保留最近 N 轮不压缩 */
const RETAINED_ROUNDS = 3;

/** 摘要消息的标识前缀 */
const SUMMARY_PREFIX = '[Context Summary]';

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
 * 新算法：分级压缩 + 单次批量摘要 + 合并更新
 * - 按 user 消息分轮
 * - 保留最近 RETAINED_ROUNDS 轮原始消息
 * - 将更早轮次（含旧摘要）合并为一次 LLM 调用生成一条 user 角色摘要
 * - 多次触发时，旧摘要参与新摘要生成，始终只保持一条摘要消息
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

  // 按 user 消息分轮（跳过 system 消息）
  // 每轮 = 一个 user 消息 + 其后所有非 user 消息（assistant、tool 等）
  const rounds: { startIndex: number; endIndex: number }[] = [];
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].role === 'user') {
      rounds.push({ startIndex: i, endIndex: -1 });
    }
  }

  // 无 user 消息，跳过压缩
  if (rounds.length === 0) {
    return { event: null, messages, skipNextTokenCheck };
  }

  // 设置每轮的结束索引
  for (let r = 0; r < rounds.length; r++) {
    rounds[r].endIndex = r + 1 < rounds.length ? rounds[r + 1].startIndex : messages.length;
  }

  // 轮次不足 RETAINED_ROUNDS，无需压缩
  if (rounds.length <= RETAINED_ROUNDS) {
    return { event: null, messages, skipNextTokenCheck: false };
  }

  // 分区：需压缩的轮次 和 保留的轮次
  const compressCount = rounds.length - RETAINED_ROUNDS;
  const retainStartIndex = rounds[compressCount].startIndex;

  // 检测旧摘要：扫描 messages 中是否存在 system 角色且以 SUMMARY_PREFIX 开头的消息
  let existingSummary: string | null = null;
  const messagesToCompress: Message[] = [];

  for (let r = 0; r < compressCount; r++) {
    const roundMessages = messages.slice(rounds[r].startIndex, rounds[r].endIndex);
    for (const msg of roundMessages) {
      // 检测旧摘要消息
      if (
        msg.role === 'user' &&
        typeof msg.content === 'string' &&
        msg.content.startsWith(SUMMARY_PREFIX)
      ) {
        // 提取旧摘要内容（去掉前缀和换行）
        existingSummary = msg.content.slice(SUMMARY_PREFIX.length).trim();
        continue; // 不将旧摘要消息加入待压缩消息列表
      }
      messagesToCompress.push(msg);
    }
  }

  // 同时检查 system prompt 之后、第一个 user 之前是否有旧摘要（第二次压缩后摘要在 index 1）
  if (messages.length > 1 && rounds[0].startIndex > 1) {
    for (let i = 1; i < rounds[0].startIndex; i++) {
      const msg = messages[i];
      if (
        msg.role === 'user' &&
        typeof msg.content === 'string' &&
        msg.content.startsWith(SUMMARY_PREFIX)
      ) {
        existingSummary = msg.content.slice(SUMMARY_PREFIX.length).trim();
      }
    }
  }

  // 仅有旧摘要无新轮次消息，跳过压缩
  if (messagesToCompress.length === 0) {
    return { event: null, messages, skipNextTokenCheck: false };
  }

  // 调用 createBatchSummary 生成新摘要
  const summaryText = await createBatchSummary(llmClient, messagesToCompress, existingSummary);

  // 降级处理：LLM 失败或返回空摘要时，保留原始消息
  if (!summaryText) {
    return { event: null, messages, skipNextTokenCheck: true };
  }

  // 组装新消息列表：system_prompt + 摘要(user) + 保留的最近 N 轮原始消息
  const newMessages: Message[] = [
    messages[0], // 原始 system prompt
    {
      role: 'user',
      content: `${SUMMARY_PREFIX}\n\nThe following is a summary of our previous conversation, not a new user request.\n\n${summaryText}`,
    },
    ...messages.slice(retainStartIndex),
  ];

  const afterTokens = estimateTokens(newMessages);
  return {
    event: { type: 'summarized', beforeTokens, afterTokens },
    messages: newMessages,
    skipNextTokenCheck: true,
  };
}

/**
 * 批量生成摘要：将所有需压缩的消息合并为一次 LLM 调用
 *
 * @param llmClient - LLM 客户端
 * @param messagesToCompress - 需要压缩的消息列表
 * @param existingSummary - 旧摘要文本（如有）
 * @returns 摘要文本，失败时返回 null
 */
async function createBatchSummary(
  llmClient: ILLMClient,
  messagesToCompress: Message[],
  existingSummary: string | null
): Promise<string | null> {
  // 构建待压缩内容文本
  let compressContent = '';

  // 如果存在旧摘要，作为上下文附加在前面
  if (existingSummary) {
    compressContent += `## Previous Context Summary\n${existingSummary}\n\n`;
  }

  // 遍历待压缩消息，按角色格式化
  for (const msg of messagesToCompress) {
    if (msg.role === 'user') {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      compressContent += `## User\n${content}\n\n`;
    } else if (msg.role === 'assistant') {
      // 跳过 thinking 内容（参考 kimi-cli 的 ThinkPart 过滤设计）
      if (typeof msg.content === 'string' && msg.content) {
        compressContent += `## Assistant\n${msg.content}\n`;
      }
      if (msg.toolCalls) {
        const toolNames = msg.toolCalls.map((tc) => tc.function.name).join(', ');
        compressContent += `Tools called: ${toolNames}\n`;
      }
      compressContent += '\n';
    } else if (msg.role === 'tool') {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      // 截断过长的工具结果
      const truncated = content.length > 500 ? `${content.slice(0, 500)}...` : content;
      compressContent += `## Tool Result (${msg.name || 'unknown'})\n${truncated}\n\n`;
    }
  }

  // 摘要 system prompt
  const summarizeSystemPrompt =
    'You are an assistant that summarizes conversation context.\n' +
    'Summarize the following conversation history into a concise context summary.\n\n' +
    'Requirements:\n' +
    '1. Focus on what goals the user is working towards\n' +
    '2. Keep key results, important findings, and file paths\n' +
    '3. Note which tools were called and their outcomes\n' +
    '4. Preserve any unfinished tasks or pending issues\n' +
    '5. Be concise but comprehensive, within 2000 words\n' +
    '6. Use English\n' +
    '7. If a previous summary is included, integrate it into the new summary';

  try {
    const response = await llmClient.generate([
      { role: 'system', content: summarizeSystemPrompt },
      { role: 'user', content: compressContent },
    ]);

    // 空摘要视为失败
    if (!response.content || response.content.trim() === '') {
      return null;
    }

    return response.content;
  } catch {
    // LLM 失败时返回 null，由调用方决定降级策略
    return null;
  }
}
