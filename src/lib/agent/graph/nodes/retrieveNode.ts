/**
 * retrieveNode - RAG 检索节点
 * 仅在 graph 首次执行时调用一次，获取知识库内容
 */

import { isHumanMessage } from "@langchain/core/messages";
import type { ReActChatState, RetrievedContext } from "../state";

export interface RetrieveNodeConfig {
  baseUrl: string;
}

/**
 * 检索节点 - 从知识库获取相关内容
 */
export async function retrieveNode(
  state: ReActChatState,
  config: RetrieveNodeConfig
): Promise<Partial<ReActChatState>> {
  // 获取最后一条用户消息
  const lastUserMessage = state.messages.filter(isHumanMessage).at(-1);
  if (!lastUserMessage) {
    return { retrievedContext: null };
  }

  const query = typeof lastUserMessage.content === "string"
    ? lastUserMessage.content
    : "";

  if (!query) {
    return { retrievedContext: null };
  }

  try {
    const response = await fetch(`${config.baseUrl}/api/retrieve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, grouped: true, topK: 10 }),
    });

    if (!response.ok) {
      console.error("[retrieveNode] retrieve failed:", response.status);
      return { retrievedContext: null };
    }

    const data = await response.json();
    const grouped = data.grouped as RetrievedContext || {
      nav_structure: [],
      content_meta: [],
      toc_entry: [],
      content_body: [],
    };

    return { retrievedContext: grouped };
  } catch (error) {
    console.error("[retrieveNode] error:", error);
    return { retrievedContext: null };
  }
}
