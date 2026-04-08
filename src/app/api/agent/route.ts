import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runNewsAgent } from "@/lib/agent/executor";
import { getOrCreateSession, acquireSessionLock, appendSessionMessage } from "@/lib/agent/session";

export async function POST(req: Request) {
  // 管理员验证
  const session = await getServerSession(authOptions);
  const isAdmin = !!(session?.user as any)?.isAdmin;
  if (!isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { taskId } = await req.json();

    // 获取任务配置
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // 创建或获取 Session
    const agentSession = await getOrCreateSession(
      `agent:main:manual:${taskId}`,
      task.agentType,
      "admin" // userId - for admin operations use "admin"
    );

    // 尝试获取锁
    const lock = await acquireSessionLock(agentSession.id, "admin");
    if (!lock) {
      return NextResponse.json({ error: "Agent is busy" }, { status: 409 });
    }

    try {
      // 根据任务类型执行
      if (task.agentType === "react") {
        const result = await runNewsAgent();

        await appendSessionMessage(agentSession.id, "assistant", JSON.stringify(result), "admin");

        return NextResponse.json({
          success: true,
          sessionId: agentSession.id,
          result,
        });
      }

      return NextResponse.json({ error: "Unsupported agent type" }, { status: 400 });
    } finally {
      await lock.release();
    }
  } catch (error) {
    console.error("Agent execution failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Agent execution failed" },
      { status: 500 }
    );
  }
}

// GET /api/agent - 列出所有任务
export async function GET() {
  const tasks = await prisma.task.findMany({
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ tasks });
}

// PUT /api/agent/tasks - 创建新任务
export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  const isAdmin = !!(session?.user as any)?.isAdmin;
  if (!isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();

  const task = await prisma.task.create({
    data: {
      name: body.name,
      description: body.description,
      agentType: body.agentType || "react",
      triggerType: body.triggerType || "manual",
      cronExpr: body.cronExpr,
      tools: body.tools || [],
      prompt: body.prompt,
      isActive: body.isActive ?? true,
    },
  });

  return NextResponse.json({ task }, { status: 201 });
}
