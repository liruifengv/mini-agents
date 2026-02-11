import { describe, expect, it } from 'vitest';
import { countTokens, truncateTextByTokens } from '../../src/utils/token';

describe('countTokens', () => {
  it('应正确计算英文 token 数', () => {
    const text = 'Hello, World!';
    const count = countTokens(text);
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(10); // 简单英文句子不会超过 10 个 token
  });

  it('应正确计算中文 token 数', () => {
    const text = '你好，世界！';
    const count = countTokens(text);
    expect(count).toBeGreaterThan(0);
  });

  it('空字符串返回 0', () => {
    expect(countTokens('')).toBe(0);
  });

  it('null/undefined 返回 0', () => {
    expect(countTokens(null as unknown as string)).toBe(0);
    expect(countTokens(undefined as unknown as string)).toBe(0);
  });
});

describe('truncateTextByTokens', () => {
  it('未超限时返回原文', () => {
    const text = 'Hello, World!';
    const result = truncateTextByTokens(text, 1000);
    expect(result).toBe(text);
  });

  it('超限时保留头尾，截断中间', () => {
    // 创建一个足够长的文本
    const lines: string[] = [];
    for (let i = 0; i < 1000; i++) {
      lines.push(`Line ${i}: This is a test line with some content.`);
    }
    const text = lines.join('\n');

    const result = truncateTextByTokens(text, 100);

    // 应该包含截断提示
    expect(result).toContain('[Content truncated:');
    expect(result).toContain('tokens limit]');

    // 应该保留头部内容
    expect(result).toContain('Line 0:');

    // 应该保留尾部内容
    expect(result).toContain('Line 999:');

    // 结果应该比原文短
    expect(result.length).toBeLessThan(text.length);
  });

  it('空字符串返回原值', () => {
    expect(truncateTextByTokens('', 100)).toBe('');
  });

  it('maxTokens <= 0 返回原值', () => {
    const text = 'Hello';
    expect(truncateTextByTokens(text, 0)).toBe(text);
    expect(truncateTextByTokens(text, -1)).toBe(text);
  });
});
