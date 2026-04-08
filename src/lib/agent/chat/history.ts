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
  const session = await prisma.agentSession.findUnique({
    where: { id: sessionId },
    select: { messages: true },
  });

  if (!session) {
    return [];
  }

  const messages = session.messages as unknown as ChatMessage[];
  return Array.isArray(messages) ? messages : [];
}

/**
 * 保存完整对话历史到 AgentSession
 */
export async function saveChatHistory(
  sessionId: string,
  messages: ChatMessage[]
): Promise<void> {
  await prisma.agentSession.update({
    where: { id: sessionId },
    data: {
      messages: messages as unknown as Prisma.InputJsonValue,
      updatedAt: new Date(),
    },
  });
}

/**
 * 追加单条消息到对话历史
 * 使用事务保证原子性
 */
export async function appendChatMessage(
  sessionId: string,
  message: ChatMessage
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const session = await tx.agentSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) return;

    const messages = (session.messages as unknown as ChatMessage[]) || [];
    messages.push(message);

    await tx.agentSession.update({
      where: { id: sessionId },
      data: {
        messages: messages as unknown as Prisma.InputJsonValue,
        updatedAt: new Date(),
      },
    });
  });
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
  const updateData: Record<string, unknown> = {};

  if (stats.tokenUsage !== undefined) {
    updateData.tokenUsage = stats.tokenUsage;
  }
  if (stats.messageCount !== undefined) {
    updateData.messageCount = stats.messageCount;
  }
  if (stats.compactCount !== undefined) {
    updateData.compactCount = stats.compactCount;
  }

  if (Object.keys(updateData).length === 0) return;

  await prisma.agentSession.update({
    where: { id: sessionId },
    data: updateData as unknown as Prisma.InputJsonValue,
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
