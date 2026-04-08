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
 * 使用原生 SQL 原子更新避免 TOCTOU 竞态条件
 */
export async function acquireSessionLock(
  sessionId: string,
  userId: string
): Promise<SessionLock | null> {
  // 使用原生 SQL 原子更新：
  // UPDATE ... WHERE id = $1 AND userId = $2 AND status = 'idle'
  // 检查和更新在同一条 SQL 语句中完成，避免 TOCTOU 竞态条件
  const result = await prisma.$executeRaw`
    UPDATE "AgentSession"
    SET status = 'running', "updatedAt" = NOW()
    WHERE id = ${sessionId} AND "userId" = ${userId} AND status = 'idle'
  `;

  // 如果没有更新任何行，说明 session 不存在、不属于该用户、或已被其他请求锁定
  if (result === 0) {
    return null;
  }

  return {
    release: async () => {
      await releaseSessionLockWithRetry(sessionId);
    },
  };
}

/**
 * 释放 Session 锁 (带重试机制)
 * 最多重试 3 次，间隔递增 (100ms, 200ms, 400ms)
 */
async function releaseSessionLockWithRetry(sessionId: string): Promise<void> {
  const maxRetries = 3;
  const baseDelayMs = 100;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await prisma.$executeRaw`
        UPDATE "AgentSession"
        SET status = 'idle', "updatedAt" = NOW()
        WHERE id = ${sessionId} AND status = 'running'
      `;
      return; // 成功释放，退出重试循环
    } catch (error) {
      if (attempt === maxRetries - 1) {
        // 最后一次重试也失败了
        console.error(`[SessionLock] Failed to release lock for session ${sessionId} after ${maxRetries} attempts:`, error);
        throw error;
      }
      // 递增延迟: 100ms, 200ms, 400ms
      const delay = baseDelayMs * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
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
