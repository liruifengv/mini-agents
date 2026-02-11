/**
 * 异步重试工具
 *
 * 提供指数退避重试逻辑，用于包装可能失败的异步操作。
 */

import type { RetryConfig } from '../types/retry';
import { DEFAULT_RETRY_CONFIG } from '../types/retry';

/**
 * 重试耗尽异常
 *
 * 当所有重试次数用完后抛出，包含最后一次错误和尝试次数。
 */
export class RetryExhaustedError extends Error {
  /** 最后一次触发重试的错误 */
  lastError: Error;
  /** 总尝试次数 */
  attempts: number;

  constructor(lastError: Error, attempts: number) {
    super(`Retry failed after ${attempts} attempts. Last error: ${lastError.message}`);
    this.name = 'RetryExhaustedError';
    this.lastError = lastError;
    this.attempts = attempts;
  }
}

/**
 * 计算指数退避延迟时间
 *
 * @param config - 重试配置
 * @param attempt - 当前重试次数（从 0 开始）
 * @returns 延迟时间（毫秒）
 */
export function calculateDelay(config: RetryConfig, attempt: number): number {
  const delaySeconds = config.initialDelay * config.exponentialBase ** attempt;
  return Math.min(delaySeconds, config.maxDelay) * 1000;
}

/**
 * 异步重试包装函数
 *
 * @param fn - 要执行的异步函数
 * @param config - 重试配置（可选，使用默认配置）
 * @param onRetry - 重试回调函数（可选）
 * @returns 函数执行结果
 * @throws RetryExhaustedError 重试耗尽时抛出
 *
 * @example
 * ```ts
 * const result = await asyncRetry(
 *   () => fetch('https://api.example.com/data'),
 *   { enabled: true, maxRetries: 3, initialDelay: 1, maxDelay: 60, exponentialBase: 2 },
 *   (error, attempt) => console.log(`Retry ${attempt}: ${error.message}`),
 * );
 * ```
 */
export async function asyncRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  onRetry?: (error: Error, attempt: number) => void
): Promise<T> {
  // 未启用重试，直接执行
  if (!config.enabled) {
    return fn();
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));

      // 最后一次尝试，不再重试
      if (attempt >= config.maxRetries) {
        throw new RetryExhaustedError(lastError, attempt + 1);
      }

      // 调用回调
      if (onRetry) {
        onRetry(lastError, attempt + 1);
      }

      // 等待后重试
      const delay = calculateDelay(config, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // 理论上不会到达
  throw lastError ?? new Error('Unknown error');
}
