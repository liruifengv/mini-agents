import type { Tool } from '../tools/core/base';
import type { ILLMClient, LLMResponse, Message } from '../types/llm';

/**
 * 检查是否已被取消
 */
export function checkCancelled(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

/**
 * 清理不完整的 assistant 消息及其后续 tool 消息
 * 返回清理后的 messages 数组（截断到最后一条完整 assistant 之前）
 */
export function cleanupIncompleteMessages(messages: Message[]): Message[] {
  // 找到最后一条 assistant 消息的位置
  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      lastAssistantIdx = i;
      break;
    }
  }

  if (lastAssistantIdx === -1) {
    return messages;
  }

  // 移除最后一条 assistant 消息及其后面所有 tool 消息
  return messages.slice(0, lastAssistantIdx);
}

/**
 * 将 LLM generate 调用与 AbortSignal 关联
 * 当 signal 触发时立即 reject，不必等待 API 响应返回
 */
export function generateWithSignal(
  llmClient: ILLMClient,
  messages: Message[],
  tools: Tool[],
  signal?: AbortSignal
): Promise<LLMResponse> {
  const generatePromise = llmClient.generate(messages, tools);

  if (!signal) return generatePromise;

  // 已经取消，直接拒绝
  if (signal.aborted) {
    // 避免悬挂的 Promise 导致 unhandled rejection
    generatePromise.catch(() => {});
    return Promise.reject(signal.reason);
  }

  return new Promise<LLMResponse>((resolve, reject) => {
    const onAbort = () => {
      reject(signal.reason);
    };

    signal.addEventListener('abort', onAbort, { once: true });

    generatePromise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}
