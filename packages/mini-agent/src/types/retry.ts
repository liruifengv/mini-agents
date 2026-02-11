/**
 * 重试配置接口
 *
 * 定义指数退避重试策略的配置参数。
 * 实际重试逻辑在阶段 3 实现，此处仅定义类型。
 */
export interface RetryConfig {
  /** 是否启用重试 */
  enabled: boolean;
  /** 最大重试次数 */
  maxRetries: number;
  /** 初始延迟时间（秒） */
  initialDelay: number;
  /** 最大延迟时间（秒） */
  maxDelay: number;
  /** 指数退避基数 */
  exponentialBase: number;
}

/**
 * 默认重试配置
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  enabled: true,
  maxRetries: 3,
  initialDelay: 1.0,
  maxDelay: 60.0,
  exponentialBase: 2.0,
};
