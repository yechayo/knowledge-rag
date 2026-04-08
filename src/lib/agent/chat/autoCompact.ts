/**
 * AutoCompact 自动摘要压缩
 * 当对话太长时，自动生成摘要压缩历史
 */

import { ChatMessage, AutoCompactConfig } from "./types";
import { estimateTokenCount, calculateMessagesTokenCount } from "./tokenizer";

/**
 * 生成对话摘要
 * 使用 AI 模型生成压缩后的对话摘要
 */
export async function generateSummary(
  messages: ChatMessage[],
  apiKey: string,
  modelName: string = "GLM-4.5-AirX"
): Promise<string> {
  if (messages.length === 0) {
    return "";
  }

  const conversationText = messages
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n\n");

  const summaryPrompt = `请简要总结以下对话的要点，保留关键信息和用户需求：

${conversationText.slice(0, 4000)}

要求：
1. 总结字数控制在 300 字以内
2. 保留关键的用户需求、问题、结论
3. 删除重复和无效信息
4. 用简洁的中文表述`;

  const response = await fetch(
    "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
      },
      body: JSON.stringify({
        model: modelName,
        messages: [{ role: "user", content: summaryPrompt }],
        temperature: 0.3,
        max_tokens: 500,
        stream: false,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Summary generation failed: ${response.statusText}`);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

/**
 * 执行 AutoCompact
 * 将旧消息压缩为摘要，保留最近的消息
 */
export async function performAutoCompact(
  messages: ChatMessage[],
  config: AutoCompactConfig,
  apiKey: string
): Promise<{
  compactedMessages: ChatMessage[];
  summary: string;
  collapsedMessageCount: number;
}> {
  // 保留最近 N 轮对话（每轮 = user + assistant）
  const maxMessages = config.maxHistoryRounds * 2;
  const recentMessages = messages.slice(-maxMessages);
  const olderMessages = messages.slice(0, -maxMessages);

  if (olderMessages.length === 0) {
    return {
      compactedMessages: messages,
      summary: "",
      collapsedMessageCount: 0,
    };
  }

  // 生成摘要
  const summary = await generateSummary(olderMessages, apiKey);

  // 构建压缩后的消息列表
  const compactedMessages: ChatMessage[] = [
    {
      role: "system",
      content: `[对话历史摘要 - 之前 ${olderMessages.length} 条消息的要点]: ${summary}`,
      timestamp: Date.now(),
      tokenCount: estimateTokenCount(summary),
    },
    ...recentMessages,
  ];

  return {
    compactedMessages,
    summary,
    collapsedMessageCount: olderMessages.length,
  };
}

/**
 * 检查是否需要执行 AutoCompact
 * @param totalTokens 当前总 token 数
 * @param compressionThreshold 触发压缩的 token 阈值
 */
export function shouldAutoCompact(
  totalTokens: number,
  compressionThreshold: number
): boolean {
  return totalTokens >= compressionThreshold;
}

/**
 * 简单的压缩（不调用 AI）
 * 直接保留最近 N 轮，删除旧消息
 */
export function simpleCompact(
  messages: ChatMessage[],
  maxHistoryRounds: number
): {
  compactedMessages: ChatMessage[];
  collapsedMessageCount: number;
} {
  const maxMessages = maxHistoryRounds * 2;
  if (messages.length <= maxMessages) {
    return {
      compactedMessages: messages,
      collapsedMessageCount: 0,
    };
  }

  const recentMessages = messages.slice(-maxMessages);
  const olderMessages = messages.slice(0, -maxMessages);

  // 生成简单的摘要说明
  const summary = `[${olderMessages.length} 条早期对话已省略]`;

  const compactedMessages: ChatMessage[] = [
    {
      role: "system",
      content: summary,
      timestamp: olderMessages[olderMessages.length - 1]?.timestamp || Date.now(),
    },
    ...recentMessages,
  ];

  return {
    compactedMessages,
    collapsedMessageCount: olderMessages.length,
  };
}

/**
 * 计算压缩效果
 */
export function calculateCompressionEffect(
  beforeMessages: ChatMessage[],
  afterMessages: ChatMessage[],
  systemPrompt: string
): {
  beforeTokens: number;
  afterTokens: number;
  savedTokens: number;
  savedPercent: number;
} {
  const beforeTokens = calculateMessagesTokenCount(
    beforeMessages.map((m) => ({ content: m.content, role: m.role }))
  );
  const afterTokens = calculateMessagesTokenCount(
    afterMessages.map((m) => ({ content: m.content, role: m.role }))
  );

  const savedTokens = beforeTokens - afterTokens;
  const savedPercent = beforeTokens > 0 ? (savedTokens / beforeTokens) * 100 : 0;

  return {
    beforeTokens,
    afterTokens,
    savedTokens,
    savedPercent,
  };
}
