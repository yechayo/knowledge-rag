import { prisma } from "@/lib/prisma";

export interface SessionLock {
  release: () => Promise<void>;
}

export interface SessionMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

/**
 * 获取或创建 Session (原子操作，避免竞态条件)
 */
export async function getOrCreateSession(
  sessionKey: string,
  agentId: string,
  userId: string
) {
  return prisma.agentSession.upsert({
    where: { sessionKey },
    create: {
      sessionKey,
      agentId,
      userId,
      status: "idle",
      messages: [],
      metadata: {},
    },
    update: {},
  });
}

/**
 * 尝试获取 Session 写锁 (只有 idle 状态才能获取)
 * 使用原子更新避免 TOCTOU 竞态条件
 */
export async function acquireSessionLock(
  sessionId: string,
  userId: string
): Promise<SessionLock | null> {
  // 先检查 session 是否存在且属于该用户
  const existing = await prisma.agentSession.findUnique({
    where: { id: sessionId },
  });

  if (!existing || existing.userId !== userId) {
    return null;
  }

  // 原子更新：只在 status 为 idle 时才更新为 running
  // 如果在此期间被其他请求获取锁，update 会失败并返回 null
  const session = await prisma.agentSession.update({
    where: { id: sessionId, status: "idle" },
    data: { status: "running" },
  }).catch(() => null);

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
 * 更新 Session 消息 (使用事务保证原子性)
 */
export async function appendSessionMessage(
  sessionId: string,
  role: "user" | "assistant" | "system",
  content: string,
  userId: string
) {
  return prisma.$transaction(async (tx) => {
    const session = await tx.agentSession.findUnique({
      where: { id: sessionId },
    });

    if (!session || session.userId !== userId) return;

    const messages = (session.messages as SessionMessage[]) || [];
    messages.push({ role, content, timestamp: Date.now() });

    await tx.agentSession.update({
      where: { id: sessionId },
      data: { messages },
    });
  });
}

/**
 * 获取 Session (带用户验证)
 */
export async function getSession(sessionId: string, userId: string) {
  const session = await prisma.agentSession.findUnique({
    where: { id: sessionId },
  });

  if (!session || session.userId !== userId) {
    return null;
  }

  return session;
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
