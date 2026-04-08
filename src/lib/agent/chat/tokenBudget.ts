/**
 * Token 预算监控
 * 持续监控 token 使用量，接近预算时注入 nudge message
 */

import { ChatMessage, TokenBudgetStatus } from "./types";
import {
  calculateMessagesTokenCount,
  estimateSystemPromptTokenCount,
} from "./tokenizer";

/**
 * Nudge 消息配置
 */
const NUDGE_MESSAGES = {
  WARNING:
    "注意：对话历史较长，可能影响响应质量。建议开启新对话以获得更好的体验。",
  CRITICAL:
    "警告：对话已接近 token 限制，将自动压缩历史记录以继续对话。",
};

/**
 * 检查 token 预算状态
 */
export function checkTokenBudget(
  messages: ChatMessage[],
  systemPrompt: string,
  maxTokens: number,
  warningThreshold: number = 0.7,
  criticalThreshold: number = 0.9
): TokenBudgetStatus {
  const systemPromptTokens = estimateSystemPromptTokenCount(systemPrompt);
  const messagesTokens = calculateMessagesTokenCount(
    messages.map((m) => ({ content: m.content, role: m.role }))
  );
  const totalTokens = systemPromptTokens + messagesTokens;
  const remainingTokens = maxTokens - totalTokens;
  const usagePercent = totalTokens / maxTokens;

  let nudgeMessage: string | undefined;
  let compressionNeeded = false;

  if (usagePercent >= criticalThreshold) {
    nudgeMessage = NUDGE_MESSAGES.CRITICAL;
    compressionNeeded = true;
  } else if (usagePercent >= warningThreshold) {
    nudgeMessage = NUDGE_MESSAGES.WARNING;
  }

  return {
    usedTokens: totalTokens,
    budgetTokens: maxTokens,
    remainingTokens: Math.max(0, remainingTokens),
    usagePercent,
    isNearLimit: usagePercent >= warningThreshold,
    compressionNeeded,
    nudgeMessage,
  };
}

/**
 * 注入 nudge message 到对话中
 */
export function injectNudgeMessage(
  messages: ChatMessage[],
  nudgeMessage: string
): ChatMessage[] {
  return [
    ...messages,
    {
      role: "system",
      content: `[系统提示]: ${nudgeMessage}`,
      timestamp: Date.now(),
    },
  ];
}

/**
 * 估算最大可用对话轮数
 */
export function estimateMaxRounds(
  maxTokens: number,
  avgMessageTokens: number = 200
): number {
  const availableForHistory = maxTokens * 0.6; // 预留 40% 给系统提示和响应
  return Math.floor(availableForHistory / (avgMessageTokens * 2)); // 每轮 2 条消息
}

/**
 * 获取预算状态的简要描述
 */
export function getBudgetSummary(status: TokenBudgetStatus): string {
  const percent = Math.round(status.usagePercent * 100);
  const used = status.usedTokens;
  const max = status.budgetTokens;

  if (status.compressionNeeded) {
    return `Token 使用率: ${percent}% (${used}/${max}) - 需要压缩`;
  }

  if (status.isNearLimit) {
    return `Token 使用率: ${percent}% (${used}/${max}) - 接近限制`;
  }

  return `Token 使用率: ${percent}% (${used}/${max})`;
}
