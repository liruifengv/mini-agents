import { describe, expect, it, vi } from 'vitest';
import type { RetryConfig } from '../../src/types/retry';
import { asyncRetry, calculateDelay, RetryExhaustedError } from '../../src/utils/retry';

// 使用短延迟配置，避免测试过慢
const fastConfig: RetryConfig = {
  enabled: true,
  maxRetries: 3,
  initialDelay: 0.01, // 10ms
  maxDelay: 0.1, // 100ms
  exponentialBase: 2.0,
};

describe('calculateDelay', () => {
  const config: RetryConfig = {
    enabled: true,
    maxRetries: 3,
    initialDelay: 1.0,
    maxDelay: 60.0,
    exponentialBase: 2.0,
  };

  it('should calculate exponential backoff delay', () => {
    // 1 * 2^0 = 1s = 1000ms
    expect(calculateDelay(config, 0)).toBe(1000);
    // 1 * 2^1 = 2s = 2000ms
    expect(calculateDelay(config, 1)).toBe(2000);
    // 1 * 2^2 = 4s = 4000ms
    expect(calculateDelay(config, 2)).toBe(4000);
  });

  it('should cap delay at maxDelay', () => {
    // 1 * 2^10 = 1024s，应被限制为 60s = 60000ms
    expect(calculateDelay(config, 10)).toBe(60000);
  });
});

describe('asyncRetry', () => {
  it('should return result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');

    const result = await asyncRetry(fn, fastConfig);

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('should retry and succeed on later attempt', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('ok');

    const result = await asyncRetry(fn, fastConfig);

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should throw RetryExhaustedError when all retries fail', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fail'));

    await expect(asyncRetry(fn, fastConfig)).rejects.toThrow(RetryExhaustedError);
    // 首次 + 3 次重试 = 4 次
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('should include attempts and lastError in RetryExhaustedError', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('the error'));

    try {
      await asyncRetry(fn, fastConfig);
    } catch (e) {
      expect(e).toBeInstanceOf(RetryExhaustedError);
      const err = e as RetryExhaustedError;
      expect(err.attempts).toBe(4);
      expect(err.lastError.message).toBe('the error');
      expect(err.message).toContain('4 attempts');
    }
  });

  it('should call onRetry callback on each retry', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValue('ok');
    const onRetry = vi.fn();

    await asyncRetry(fn, fastConfig, onRetry);

    expect(onRetry).toHaveBeenCalledTimes(2);
    // 第一次重试：attempt = 1
    expect(onRetry).toHaveBeenNthCalledWith(1, expect.any(Error), 1);
    // 第二次重试：attempt = 2
    expect(onRetry).toHaveBeenNthCalledWith(2, expect.any(Error), 2);
  });

  it('should not retry when enabled is false', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('fail'));
    const disabledConfig: RetryConfig = { ...fastConfig, enabled: false };

    // enabled=false 时直接抛出原始错误，不包装
    await expect(asyncRetry(fn, disabledConfig)).rejects.toThrow('fail');
    expect(fn).toHaveBeenCalledOnce();
  });

  it('should handle non-Error throws', async () => {
    // 模拟抛出非 Error 对象
    const fn = vi.fn().mockRejectedValue('string error');

    await expect(asyncRetry(fn, fastConfig)).rejects.toThrow(RetryExhaustedError);
  });
});
