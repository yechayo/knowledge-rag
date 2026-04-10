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
    // baseUrl 可能是完整 URL（如 http://example.com/api/retrieve）或相对路径（如 /api/retrieve）
    let retrieveUrl = config.baseUrl;
    if (retrieveUrl.endsWith('/api/retrieve')) {
      retrieveUrl = retrieveUrl + '/retrieve';
    } else if (retrieveUrl.endsWith('/retrieve')) {
      // 已经是正确格式
    } else if (!retrieveUrl.includes('/retrieve')) {
      retrieveUrl = retrieveUrl + '/api/retrieve';
    }

    const response = await fetch(retrieveUrl, {
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
