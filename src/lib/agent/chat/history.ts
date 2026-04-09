/**
 * 对话历史管理
 * 复用现有 AgentSession 表的 messages Json 字段
 */

import { prisma } from "@/lib/prisma";
import { ChatMessage, CollapsedContext } from "./types";
import { Prisma } from "@prisma/client";

/**
 * 从 AgentSession 加载对话历史
 */
export async function loadChatHistory(sessionId: string): Promise<ChatMessage[]> {
  try {
    const session = await prisma.agentSession.findUnique({
      where: { id: sessionId },
      select: { messages: true },
    });

    if (!session) {
      return [];
    }

    // 确保 messages 是数组类型，如果不是则返回空数组
    if (!session.messages) {
      return [];
    }

    // 如果是字符串（未解析的 JSON），尝试解析
    if (typeof session.messages === "string") {
      try {
        const parsed = JSON.parse(session.messages);
        return Array.isArray(parsed) ? parsed as ChatMessage[] : [];
      } catch {
        console.error("[loadChatHistory] Failed to parse messages JSON:", session.messages);
        return [];
      }
    }

    // 如果是数组，直接返回（通过 unknown 中转避免 TS 类型检查问题）
    if (Array.isArray(session.messages)) {
      return session.messages as unknown as ChatMessage[];
    }

    return [];
  } catch (err) {
    console.error("[loadChatHistory] Error loading chat history:", err);
    return [];
  }
}

/**
 * 保存完整对话历史到 AgentSession
 */
export async function saveChatHistory(
  sessionId: string,
  messages: ChatMessage[]
): Promise<void> {
  try {
    await prisma.agentSession.update({
      where: { id: sessionId },
      data: {
        messages: messages as unknown as Prisma.InputJsonValue,
        updatedAt: new Date(),
      },
    });
  } catch (err) {
    console.error("[saveChatHistory] Error saving chat history:", err);
  }
}

/**
 * 追加单条消息到对话历史
 * 使用事务保证原子性
 */
export async function appendChatMessage(
  sessionId: string,
  message: ChatMessage
): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      const session = await tx.agentSession.findUnique({
        where: { id: sessionId },
      });

      if (!session) return;

      // 安全地获取并追加消息
      let messages: ChatMessage[] = [];
      if (session.messages) {
        if (typeof session.messages === "string") {
          try {
            messages = JSON.parse(session.messages);
          } catch {
            messages = [];
          }
        } else if (Array.isArray(session.messages)) {
          messages = session.messages as unknown as ChatMessage[];
        }
      }

      messages.push(message);

      await tx.agentSession.update({
        where: { id: sessionId },
        data: {
          messages: messages as unknown as Prisma.InputJsonValue,
          updatedAt: new Date(),
        },
      });
    });
  } catch (err) {
    console.error("[appendChatMessage] Error appending message:", err);
  }
}

/**
 * 获取折叠上下文信息
 */
export async function getCollapsedContext(
  sessionId: string
): Promise<CollapsedContext | null> {
  const session = await prisma.agentSession.findUnique({
    where: { id: sessionId },
    select: { metadata: true },
  });

  if (!session) return null;

  const metadata = session.metadata as unknown as Record<string, unknown>;
  return (metadata.collapsedContext as CollapsedContext) || null;
}

/**
 * 保存折叠上下文信息
 */
export async function saveCollapsedContext(
  sessionId: string,
  context: CollapsedContext
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const session = await tx.agentSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) return;

    const metadata = (session.metadata as unknown as Record<string, unknown>) || {};
    metadata.collapsedContext = context;

    await tx.agentSession.update({
      where: { id: sessionId },
      data: {
        metadata: metadata as unknown as Prisma.InputJsonValue,
        updatedAt: new Date(),
      },
    });
  });
}

/**
 * 更新 Session 的统计信息
 */
export async function updateSessionStats(
  sessionId: string,
  stats: {
    tokenUsage?: number;
    messageCount?: number;
    compactCount?: number;
  }
): Promise<void> {
  // 使用 Prisma 的 update 方法，直接指定要更新的字段，避免类型转换问题
  await prisma.agentSession.update({
    where: { id: sessionId },
    data: {
      ...(stats.tokenUsage !== undefined && { tokenUsage: stats.tokenUsage }),
      ...(stats.messageCount !== undefined && { messageCount: stats.messageCount }),
      ...(stats.compactCount !== undefined && { compactCount: stats.compactCount }),
    },
  });
}

/**
 * 获取 Session 的统计信息
 */
export async function getSessionStats(sessionId: string): Promise<{
  tokenUsage: number;
  messageCount: number;
  compactCount: number;
} | null> {
  const session = await prisma.agentSession.findUnique({
    where: { id: sessionId },
    select: {
      tokenUsage: true,
      messageCount: true,
      compactCount: true,
    },
  });

  if (!session) return null;

  return {
    tokenUsage: (session.tokenUsage as number) || 0,
    messageCount: (session.messageCount as number) || 0,
    compactCount: (session.compactCount as number) || 0,
  };
}

/**
 * 清除对话历史
 */
export async function clearChatHistory(sessionId: string): Promise<void> {
  await prisma.agentSession.update({
    where: { id: sessionId },
    data: {
      messages: [] as unknown as Prisma.InputJsonValue,
      metadata: {} as unknown as Prisma.InputJsonValue,
      tokenUsage: 0,
      messageCount: 0,
    },
  });
}
