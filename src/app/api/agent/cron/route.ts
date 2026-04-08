// src/app/api/agent/cron/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runNewsAgent } from "@/lib/agent/executor";
import { getOrCreateSession, acquireSessionLock } from "@/lib/agent/session";

// Vercel Cron 触发此端点
export async function GET(req: Request) {
  // 验证 Cron secret（可选）
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 获取所有 active 的 cron 任务
    const cronTasks = await prisma.task.findMany({
      where: {
        triggerType: "cron",
        isActive: true,
        cronExpr: { not: null },
      },
    });

    const results = [];

    for (const task of cronTasks) {
      // 创建 isolated session
      const sessionKey = `agent:main:cron:${task.name}-${Date.now()}`;
      const agentSession = await getOrCreateSession(sessionKey, task.agentType, "system");

      // 尝试获取锁
      const lock = await acquireSessionLock(agentSession.id, "system");
      if (!lock) {
        results.push({ taskId: task.id, status: "skipped", reason: "Agent is busy" });
        continue;
      }

      try {
        if (task.agentType === "react") {
          await runNewsAgent();
          results.push({ taskId: task.id, status: "success" });
        }
      } catch (error) {
        results.push({
          taskId: task.id,
          status: "error",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      } finally {
        await lock.release();
      }
    }

    return NextResponse.json({
      executed: results.length,
      results,
    });
  } catch (error) {
    console.error("Cron execution failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Cron execution failed" },
      { status: 500 }
    );
  }
}
