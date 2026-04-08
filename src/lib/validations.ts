import { z } from "zod";

// POST /api/agent - 运行任务，需要 taskId
export const runTaskSchema = z.object({
  taskId: z.string().min(1, "taskId is required"),
});

// PUT /api/agent - 创建新任务
export const createTaskSchema = z.object({
  name: z.string().min(1, "name is required"),
  description: z.string().optional(),
  agentType: z.enum(["react"]).optional().default("react"),
  triggerType: z.enum(["manual", "cron"]).optional().default("manual"),
  cronExpr: z.string().optional(),
  tools: z.array(z.string()).optional().default([]),
  prompt: z.string().min(1, "prompt is required"),
  isActive: z.boolean().optional().default(true),
});

// PUT /api/agent/[taskId] - 更新任务
export const updateTaskSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  agentType: z.enum(["react"]).optional(),
  triggerType: z.enum(["manual", "cron"]).optional(),
  cronExpr: z.string().optional().nullable(),
  tools: z.array(z.string()).optional(),
  prompt: z.string().optional(),
  isActive: z.boolean().optional(),
});

// DELETE /api/agent/[taskId] - 删除任务 (只需要 taskId 在 URL 中)
export const deleteTaskSchema = z.object({
  taskId: z.string().min(1, "taskId is required"),
});

// Type exports
export type RunTaskInput = z.infer<typeof runTaskSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type DeleteTaskInput = z.infer<typeof deleteTaskSchema>;
