/**
 * Token 计算工具
 * 简单的中英文 token 估算
 * 中文按字符数估算，英文按单词数估算
 */

/**
 * 估算单个文本的 token 数量
 * 中文约每字符 2 tokens，英文约每词 1.3 tokens
 */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;

  // 计算中文字符数
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;

  // 计算英文单词数（排除中文后按空格分割）
  const englishText = text.replace(/[\u4e00-\u9fff]/g, " ");
  const englishWords = englishText
    .split(/\s+/)
    .filter((w) => w.length > 0).length;

  return Math.ceil(chineseChars * 2 + englishWords * 1.3);
}

/**
 * 计算消息数组的总 token 数
 */
export function calculateMessagesTokenCount(
  messages: Array<{ content: string; role: string }>
): number {
  return messages.reduce((total, msg) => {
    // 每条消息有约 4 tokens 的 overhead（role 标记等）
    return total + estimateTokenCount(msg.content) + 4;
  }, 0);
}

/**
 * 计算消息是否接近 token 限制
 * @param messages 消息数组
 * @param maxTokens 最大 token 数
 * @param threshold 阈值，默认 0.8 (80%)
 */
export function isNearTokenLimit(
  messages: Array<{ content: string; role: string }>,
  maxTokens: number,
  threshold: number = 0.8
): boolean {
  const used = calculateMessagesTokenCount(messages);
  return used >= maxTokens * threshold;
}

/**
 * 估算系统提示词的 token 数
 * @param systemPrompt 系统提示词
 */
export function estimateSystemPromptTokenCount(systemPrompt: string): number {
  return estimateTokenCount(systemPrompt) + 10; // system 消息 overhead
}

/**
 * 估算完整对话上下文的 token 数
 */
export function estimateContextTokenCount(
  systemPrompt: string,
  messages: Array<{ content: string; role: string }>
): number {
  return estimateSystemPromptTokenCount(systemPrompt) + calculateMessagesTokenCount(messages);
}

/**
 * 判断是否需要压缩
 * @param totalTokens 当前总 token 数
 * @param maxTokens 最大 token 数
 * @param threshold 触发压缩的阈值，默认 0.85
 */
export function shouldCompress(
  totalTokens: number,
  maxTokens: number,
  threshold: number = 0.85
): boolean {
  return totalTokens >= maxTokens * threshold;
}

/**
 * 估算最大可用对话轮数
 * @param maxTokens 最大 token 数
 * @param avgMessageTokens 平均每条消息的 token 数
 */
export function estimateMaxRounds(
  maxTokens: number,
  avgMessageTokens: number = 200
): number {
  // 预留 40% 给系统提示和响应
  const availableForHistory = maxTokens * 0.6;
  // 每轮 = user + assistant = 2 条消息
  return Math.floor(availableForHistory / (avgMessageTokens * 2));
}
