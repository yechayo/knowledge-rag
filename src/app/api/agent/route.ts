import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runNewsAgent } from "@/lib/agent/executor";
import { getOrCreateSession, acquireSessionLock, appendSessionMessage } from "@/lib/agent/session";
import { runTaskSchema, createTaskSchema } from "@/lib/validations";

// 管理员认证辅助函数
async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const isAdmin = !!(session?.user as any)?.isAdmin;
  if (!isAdmin) {
    throw new Error("Unauthorized");
  }
  return session;
}

// GET /api/agent - 列出所有任务 (需要管理员认证)
export async function GET() {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tasks = await prisma.task.findMany({
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ tasks });
}

// POST /api/agent - 运行任务 (需要管理员认证 + taskId 验证)
export async function POST(req: Request) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const parsed = runTaskSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { taskId } = parsed.data;

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

// PUT /api/agent - 创建新任务 (需要管理员认证 + Zod 验证)
export async function PUT(req: Request) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const parsed = createTaskSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const task = await prisma.task.create({
      data: parsed.data,
    });

    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    console.error("Create task failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Create task failed" },
      { status: 500 }
    );
  }
}
