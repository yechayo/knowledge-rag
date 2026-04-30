/**
 * 工具注册表 — 组装工具列表并应用 Guard 包装
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  duckduckgoSearch, fetchUrl, createContent, listContent, listCategories, updateContent, deleteContent,
  searchSkill, requestInstallSkill, listInstalledSkills, uninstallSkill, checkSkillStatus,
} from "@/lib/agent/tools";
import { LoopGuard, LoopGuardError, truncateToolResult } from "@/lib/agent/guard";
import type { ResourceLimits } from "@/lib/agent/guard";

export interface ToolRegistryConfig {
  userId: string;
  guard: LoopGuard;
  limits: ResourceLimits;
}

export interface ToolRegistryResult {
  /** 已包装 Guard 的工具列表（供 LangGraph agent 使用） */
  tools: unknown[];
  /** 原始工具列表（供 detectTextToolCall 使用） */
  rawTools: unknown[];
}

/**
 * 创建 remember 工具
 */
function createRememberTool(userId: string) {
  return tool(
    async ({ name, description, content, type }: {
      name: string; content: string;
      type?: "user" | "feedback" | "project" | "reference"; description?: string;
    }) => {
      await prisma.agentMemory.create({
        data: { userId, name, description: description || null, content, type: type || "project", isPrivate: true },
      });
      return `记忆已保存: [${type || "project"}] ${name}`;
    },
    {
      name: "remember",
      description: "保存重要信息到长期记忆。当用户分享了个人偏好、确认了正确的做法、给出了反馈、或者需要记住项目相关信息时使用。",
      schema: z.object({
        name: z.string().describe("记忆名称，简短标识"),
        content: z.string().describe("要保存的具体内容"),
        type: z.enum(["user", "feedback", "project", "reference"]).optional().describe("类型"),
        description: z.string().optional().describe("一句话描述"),
      }),
    }
  );
}

/**
 * 用 Guard 包装工具的 invoke 方法
 */
function wrapToolsWithGuard(tools: unknown[], guard: LoopGuard, limits: ResourceLimits): unknown[] {
  return tools.map((originalTool: any) => {
    const originalInvoke = originalTool.invoke.bind(originalTool);
    const guardedInvoke = async (input: any, options?: any) => {
      const toolName = originalTool.name || originalTool.lc_name || "unknown";
      let args: Record<string, unknown>;
      if (input && typeof input === "object" && input.type === "tool_call") {
        args = input.args || {};
      } else if (typeof input === "string") {
        try { args = JSON.parse(input); } catch { args = { input }; }
      } else {
        args = input;
      }

      try { guard.check(toolName, args); } catch (err) {
        if (err instanceof LoopGuardError) return err.message;
        throw err;
      }

      let result: any;
      try { result = await originalInvoke(input, options); } catch (err) {
        result = err instanceof Error ? err.message : String(err);
      }
      const resultStr = typeof result === "string" ? result : JSON.stringify(result);
      return truncateToolResult(resultStr, limits.maxResultChars);
    };

    return Object.create(Object.getPrototypeOf(originalTool), {
      ...Object.getOwnPropertyDescriptors(originalTool),
      invoke: { value: guardedInvoke, writable: true, configurable: true },
    });
  });
}

/**
 * 创建只读工具注册表（用于 chat/v2）
 * 只包含查询类工具，不包含写操作工具
 */
export function createReadOnlyToolRegistry(config: ToolRegistryConfig): ToolRegistryResult {
  const { userId, guard, limits } = config;

  // 只读工具集：仅内容查询，不含网络搜索
  const readOnlyTools = [
    listContent,
    listCategories,
  ];

  const guardedTools = wrapToolsWithGuard(readOnlyTools, guard, limits);

  return {
    tools: guardedTools,
    rawTools: readOnlyTools,
  };
}

/**
 * 创建工具注册表 — 组装所有工具并包装 Guard
 */
export function createToolRegistry(config: ToolRegistryConfig): ToolRegistryResult {
  const { userId, guard, limits } = config;

  const remember = createRememberTool(userId);
  const baseTools = [duckduckgoSearch, fetchUrl, createContent, listContent, listCategories, updateContent, deleteContent];
  const skillMarketTools = [searchSkill, requestInstallSkill, listInstalledSkills, uninstallSkill, checkSkillStatus];
  const allTools = [...baseTools, remember, ...skillMarketTools];

  const guardedTools = wrapToolsWithGuard(allTools, guard, limits);

  return {
    tools: guardedTools,
    rawTools: allTools,
  };
}
