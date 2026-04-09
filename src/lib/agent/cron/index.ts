/**
 * Cron 定时任务调度模块
 *
 * 使用方式：
 * import { getCronService, startCronService } from "@/lib/agent/cron";
 *
 * // 在 API route 中
 * const service = await startCronService();
 * const status = await service.status();
 */

// 类型导出
export type {
  CronJob,
  CronSchedule,
  CronJobState,
  CronServiceDeps,
  CronServiceStatus,
  CronRunResult,
  ScheduleKind,
} from "./types";

// 服务导出
export { CronService, getCronService, startCronService } from "./service";

// 工具函数导出
export { computeNextRunAtMs, isJobDue, isValidCronExpr, isValidEveryMs } from "./jobs";
