/**
 * answerNode - 回答提取节点
 * 从最终 AI 消息提取回答文本和引用来源
 */

import { isAIMessage, isToolMessage, BaseMessage } from "@langchain/core/messages";
import type { ReActChatState, SourceCitation } from "../state";

/**
 * 从消息内容中提取文本
 */
function extractText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.filter((c) => typeof c === "string").join("");
  }
  return "";
}

/**
 * 生成标题锚点
 */
function generateHeadingAnchor(headingText: string): string {
  return headingText
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * 从检索上下文中提取引用来源
 */
function extractSources(context: ReActChatState["retrievedContext"]): SourceCitation[] {
  if (!context) return [];

  const seen = new Map<string, SourceCitation>();

  // 从 content_body 提取
  for (const chunk of context.content_body || []) {
    const key = chunk.slug + "::" + (chunk.headingAnchor || "");
    if (!seen.has(key)) {
      seen.set(key, {
        title: chunk.title,
        slug: chunk.slug,
        category: chunk.category,
        headingAnchor: chunk.headingText
          ? generateHeadingAnchor(chunk.headingText)
          : chunk.headingAnchor || null,
        headingText: chunk.headingText || null,
        sectionPath: chunk.sectionPath || null,
        contentPreview: chunk.content.length > 100
          ? chunk.content.slice(0, 100) + "..."
          : chunk.content,
      });
    }
  }

  // 从 content_meta 提取（不在 content_body 中的）
  const existingSlugs = new Set((context.content_body || []).map((c) => c.slug));
  for (const chunk of context.content_meta || []) {
    if (!existingSlugs.has(chunk.slug)) {
      seen.set(chunk.slug, {
        title: chunk.title,
        slug: chunk.slug,
        category: chunk.category,
        headingAnchor: null,
        headingText: null,
        sectionPath: null,
        contentPreview: chunk.content.length > 100
          ? chunk.content.slice(0, 100) + "..."
          : chunk.content,
      });
    }
  }

  return Array.from(seen.values());
}

/**
 * 回答节点 - 提取最终回答和来源
 */
export async function answerNode(
  state: ReActChatState
): Promise<Partial<ReActChatState>> {
  // 获取最后一条 AI 消息
  const aiMessages = state.messages.filter(isAIMessage);
  const lastAiMsg = aiMessages.at(-1);

  if (!lastAiMsg) {
    return { finalAnswer: "", sources: [] };
  }

  // 提取文本内容
  const textContent = extractText(lastAiMsg.content);

  // 提取引用来源
  const sources = extractSources(state.retrievedContext);

  return {
    finalAnswer: textContent,
    sources,
  };
}

/**
 * 提取所有工具消息的结果
 */
export function extractToolResults(messages: BaseMessage[]): { toolName: string; result: string }[] {
  const toolMessages = messages.filter(isToolMessage);
  return toolMessages.map((msg: any) => ({
    toolName: msg.name || "unknown",
    result: typeof msg.content === "string" ? msg.content : String(msg.content),
  }));
}
