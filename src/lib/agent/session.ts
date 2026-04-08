import { prisma } from "@/lib/prisma";

export interface SessionLock {
  release: () => Promise<void>;
}

const LOCK_TIMEOUT = 10000; // 10秒

/**
 * 获取或创建 Session
 */
export async function getOrCreateSession(sessionKey: string, agentId: string) {
  const existing = await prisma.agentSession.findUnique({
    where: { sessionKey },
  });

  if (existing) {
    return existing;
  }

  return prisma.agentSession.create({
    data: {
      sessionKey,
      agentId,
      status: "idle",
      messages: [],
      metadata: {},
    },
  });
}

/**
 * 尝试获取 Session 写锁
 */
export async function acquireSessionLock(sessionId: string): Promise<SessionLock | null> {
  const session = await prisma.agentSession.update({
    where: { id: sessionId },
    data: { status: "running" },
  });

  if (!session) return null;

  return {
    release: async () => {
      await prisma.agentSession.update({
        where: { id: sessionId },
        data: { status: "idle" },
      });
    },
  };
}

/**
 * 更新 Session 消息
 */
export async function appendSessionMessage(
  sessionId: string,
  role: "user" | "assistant" | "system",
  content: string
) {
  const session = await prisma.agentSession.findUnique({
    where: { id: sessionId },
  });

  if (!session) return;

  const messages = (session.messages as any[]) || [];
  messages.push({ role, content, timestamp: Date.now() });

  await prisma.agentSession.update({
    where: { id: sessionId },
    data: { messages },
  });
}

/**
 * 清理过期 Session（超过 1 小时的 running 状态）
 */
export async function cleanupStaleSessions() {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  await prisma.agentSession.updateMany({
    where: {
      status: "running",
      updatedAt: { lt: oneHourAgo },
    },
    data: { status: "idle" },
  });
}
