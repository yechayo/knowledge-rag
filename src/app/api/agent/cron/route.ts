/**
 * Cron API 路由
 *
 * GET /api/agent/cron
 *   - 手动触发一次检查 + 执行到期任务
 *   - 也会自动启动调度器（如果未启动）
 *
 * POST /api/agent/cron
 *   - 手动触发指定任务执行
 *   - body: { taskId: string, forced?: boolean }
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getCronService, startCronService } from "@/lib/agent/cron";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const isAdmin = !!(session?.user as any)?.isAdmin;
  if (!isAdmin) throw new Error("Unauthorized");
}

export async function GET(req: Request) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 启动/获取调度器
    const service = await startCronService();

    // 获取状态
    const status = await service.status();

    return NextResponse.json({
      message: "Cron service is running",
      status,
    });
  } catch (error) {
    console.error("[Cron] GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get cron status" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { taskId, forced } = body;

    if (!taskId) {
      return NextResponse.json({ error: "taskId is required" }, { status: 400 });
    }

    const service = await startCronService();
    const result = await service.run(taskId, forced === true);

    if (!result.ok) {
      return NextResponse.json(
        { error: result.reason || "Failed to run task" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      message: "Task executed successfully",
      taskId,
    });
  } catch (error) {
    console.error("[Cron] POST error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to run task" },
      { status: 500 }
    );
  }
}
