import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

interface RouteParams {
  params: Promise<{ taskId: string }>;
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

// PUT /api/agent/[taskId] - 更新任务
export async function PUT(req: Request, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  const isAdmin = !!(session?.user as any)?.isAdmin;
  if (!isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { taskId } = await params;
  const body = await req.json();

  const task = await prisma.task.update({
    where: { id: taskId },
    data: body,
  });

  return NextResponse.json({ task });
}

// DELETE /api/agent/[taskId] - 删除任务
export async function DELETE(req: Request, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  const isAdmin = !!(session?.user as any)?.isAdmin;
  if (!isAdmin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { taskId } = await params;

  await prisma.task.delete({ where: { id: taskId } });

  return NextResponse.json({ success: true });
}
