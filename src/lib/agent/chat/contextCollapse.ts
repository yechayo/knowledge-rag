/**
 * Context Collapse 轻量折叠
 * 与 AutoCompact 不同，Context Collapse 不调用 AI 生成摘要
 * 而是直接保留消息的只读投影
 */

import { ChatMessage, CollapsedContext } from "./types";
import { estimateTokenCount } from "./tokenizer";

/**
 * 创建轻量级折叠上下文
 * 不调用 AI，直接根据 token 限制折叠旧消息
 */
export function createCollapsedContext(
  messages: ChatMessage[],
  targetTokenCount: number
): {
  collapsedContext: CollapsedContext;
  visibleMessages: ChatMessage[];
} {
  if (messages.length <= 2) {
    return {
      collapsedContext: {
        summary: "",
        messageCount: 0,
        startIndex: 0,
        endIndex: 0,
        tokenCount: 0,
      },
      visibleMessages: messages,
    };
  }

  // 计算需要折叠哪些消息
  let tokenSum = 0;
  let collapseStartIndex = 0;

  // 从最旧的消息开始，计算需要折叠的范围
  for (let i = 0; i < messages.length - 2; i++) {
    tokenSum += estimateTokenCount(messages[i].content);
    if (tokenSum >= targetTokenCount) {
      collapseStartIndex = i;
      break;
    }
    collapseStartIndex = i + 1;
  }

  // 被折叠的消息
  const collapsedMessages = messages.slice(0, collapseStartIndex);

  // 可见的消息（从 collapseStartIndex 开始，保留最后 2 条）
  const visibleMessages = messages.slice(collapseStartIndex);

  // 生成轻量级摘要（只是简单的计数信息）
  const summary = `[${collapsedMessages.length} 条早期对话已折叠，保留最近 ${visibleMessages.length} 条对话]`;

  return {
    collapsedContext: {
      summary,
      messageCount: collapsedMessages.length,
      startIndex: collapseStartIndex,
      endIndex: messages.length - visibleMessages.length,
      tokenCount: estimateTokenCount(summary),
    },
    visibleMessages,
  };
}

/**
 * 展开折叠的上下文
 * 将被折叠的消息恢复到可见列表
 */
export function expandCollapsedContext(
  _originalMessages: ChatMessage[],
  collapsedContext: CollapsedContext,
  fullMessages: ChatMessage[]
): ChatMessage[] {
  // 返回原始消息的完整列表
  // collapsedContext 只用于显示摘要信息，实际消息仍然保留
  return fullMessages;
}

/**
 * 快速检查是否需要折叠
 * @param messages 消息列表
 * @param maxTokens 最大 token 数
 * @param threshold 折叠阈值，默认 0.5
 */
export function shouldCollapse(
  messages: ChatMessage[],
  maxTokens: number,
  threshold: number = 0.5
): boolean {
  const totalTokens = messages.reduce(
    (sum, m) => sum + estimateTokenCount(m.content),
    0
  );
  return totalTokens >= maxTokens * threshold;
}

/**
 * 获取折叠状态信息
 */
export function getCollapseInfo(
  messages: ChatMessage[],
  maxTokens: number
): {
  isCollapsed: boolean;
  totalMessages: number;
  totalTokens: number;
  usagePercent: number;
} {
  const totalTokens = messages.reduce(
    (sum, m) => sum + estimateTokenCount(m.content),
    0
  );
  const usagePercent = totalTokens / maxTokens;

  return {
    isCollapsed: usagePercent >= 0.5,
    totalMessages: messages.length,
    totalTokens,
    usagePercent,
  };
}
