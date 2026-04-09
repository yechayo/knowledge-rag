/**
 * Cron 调度器状态检查接口
 *
 * GET /api/agent/schedule
 *   - 返回调度器状态
 *   - 无需认证（仅供监控使用）
 */
import { NextResponse } from "next/server";
import { getCronService } from "@/lib/agent/cron";

export async function GET() {
  try {
    const service = getCronService();
    const status = await service.status();

    return NextResponse.json({
      enabled: status.enabled,
      jobs: status.jobs,
      nextWakeAtMs: status.nextWakeAtMs,
      running: status.running,
      started: service.isStarted(),
    });
  } catch (error) {
    console.error("[Schedule] error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to get schedule status" },
      { status: 500 }
    );
  }
}
