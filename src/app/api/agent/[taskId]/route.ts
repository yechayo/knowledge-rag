import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { updateTaskSchema } from "@/lib/validations";

interface RouteParams {
  params: Promise<{ taskId: string }>;
}

// 管理员认证辅助函数
async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const isAdmin = !!(session?.user as any)?.isAdmin;
  if (!isAdmin) {
    throw new Error("Unauthorized");
  }
  return session;
}

// GET /api/agent/[taskId] - 获取任务详情
export async function GET(req: Request, { params }: RouteParams) {
  const { taskId } = await params;

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  return NextResponse.json({ task });
}

// PUT /api/agent/[taskId] - 更新任务 (需要管理员认证 + Zod 验证)
export async function PUT(req: Request, { params }: RouteParams) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { taskId } = await params;
    const body = await req.json();
    const parsed = updateTaskSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const task = await prisma.task.update({
      where: { id: taskId },
      data: parsed.data,
    });

    return NextResponse.json({ task });
  } catch (error) {
    console.error("Update task failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Update task failed" },
      { status: 500 }
    );
  }
}

// DELETE /api/agent/[taskId] - 删除任务 (需要管理员认证)
export async function DELETE(req: Request, { params }: RouteParams) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { taskId } = await params;

    await prisma.task.delete({ where: { id: taskId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete task failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Delete task failed" },
      { status: 500 }
    );
  }
}
