import { encode } from 'gpt-tokenizer';

/**
 * 计算文本的 token 数量
 *
 * 使用 cl100k_base 编码器（GPT-4/Claude 通用）
 *
 * @param text 输入文本
 * @returns token 数量
 */
export function countTokens(text: string): number {
  if (!text) {
    return 0;
  }
  return encode(text).length;
}

/**
 * 智能截断文本，保留头尾，截断中间
 *
 * 当文本超过指定 token 限制时，保留开头和结尾部分，
 * 截断中间内容，并在换行符处截断以保持内容完整性。
 *
 * @param text 输入文本
 * @param maxTokens 最大 token 数
 * @returns 截断后的文本（未超限则返回原文）
 */
export function truncateTextByTokens(text: string, maxTokens: number): string {
  if (!text || maxTokens <= 0) {
    return text;
  }

  const tokenCount = countTokens(text);

  // 未超限直接返回
  if (tokenCount <= maxTokens) {
    return text;
  }

  // 计算 token/字符 比例
  const charCount = text.length;
  const ratio = tokenCount / charCount;

  // 头尾各分配 50%，留 5% 安全边际
  const charsPerHalf = Math.floor((maxTokens / 2 / ratio) * 0.95);

  // 截断头部：在换行符处截断，保持行完整
  let headPart = text.slice(0, charsPerHalf);
  const lastNewlineHead = headPart.lastIndexOf('\n');
  if (lastNewlineHead > 0) {
    headPart = headPart.slice(0, lastNewlineHead);
  }

  // 截断尾部：同样在换行符处
  let tailPart = text.slice(-charsPerHalf);
  const firstNewlineTail = tailPart.indexOf('\n');
  if (firstNewlineTail > 0) {
    tailPart = tailPart.slice(firstNewlineTail + 1);
  }

  // 拼接结果，添加截断提示
  const truncationNote = `\n\n... [Content truncated: ${tokenCount} tokens -> ~${maxTokens} tokens limit] ...\n\n`;
  return headPart + truncationNote + tailPart;
}
