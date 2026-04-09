import { tool } from "@langchain/core/tools";
import { z } from "zod";

/**
 * search_skill - 搜索 Skill 市场
 */
export const searchSkill = tool(
  async ({
    query,
    category,
    page = 1,
    pageSize = 10,
  }: {
    query: string;
    category?: string;
    page?: number;
    pageSize?: number;
  }) => {
    const params = new URLSearchParams({
      search: query,
      page: String(page),
      pageSize: String(pageSize),
    });
    if (category) params.set("category", category);

    const res = await fetch(`/api/agent/skills/market?${params}`);
    if (!res.ok) {
      return JSON.stringify({ error: "搜索失败", details: await res.text() });
    }
    const data = await res.json();
    return JSON.stringify(data);
  },
  {
    name: "search_skill",
    description: "搜索 Skill 市场中可用的 skills。根据关键词搜索，返回匹配的市场 skills 列表，包括名称、描述、作者、安装数量等信息。当你需要找到某个特定能力的 skill 时使用。",
    schema: z.object({
      query: z.string().describe("搜索关键词，可以是 skill 名称或描述中的关键词"),
      category: z.string().optional().describe("分类过滤，如 'productivity', 'coding', 'writing'"),
      page: z.number().optional().describe("页码，默认 1"),
      pageSize: z.number().optional().describe("每页数量，默认 10"),
    }),
  }
);

/**
 * request_install_skill - 申请安装 Skill
 */
export const requestInstallSkill = tool(
  async ({
    skillName,
    version,
    reason,
  }: {
    skillName: string;
    version?: string;
    reason?: string;
  }) => {
    const res = await fetch("/api/agent/skills/installed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillName, version, reason }),
    });
    const data = await res.json();
    return JSON.stringify(data);
  },
  {
    name: "request_install_skill",
    description: "向用户申请安装指定的 skill。安装需要用户审批，skill 会在批准后生效。当你发现市场中有需要的 skill 时，使用此工具申请安装。",
    schema: z.object({
      skillName: z.string().describe("要安装的 skill 名称"),
      version: z.string().optional().describe("指定版本号"),
      reason: z.string().optional().describe("安装理由，用于说服用户批准"),
    }),
  }
);

/**
 * list_installed_skills - 列出已安装的 Skills
 */
export const listInstalledSkills = tool(
  async ({
    status,
  }: {
    status?: "active" | "pending_approval" | "disabled";
  }) => {
    const params = status ? `?status=${status}` : "";
    const res = await fetch(`/api/agent/skills/installed${params}`);
    if (!res.ok) {
      return JSON.stringify({ error: "获取失败", details: await res.text() });
    }
    const data = await res.json();
    return JSON.stringify(data);
  },
  {
    name: "list_installed_skills",
    description: "列出当前用户已安装的所有 skills 及其状态。",
    schema: z.object({
      status: z
        .enum(["active", "pending_approval", "disabled"])
        .optional()
        .describe("按状态过滤: active=已激活, pending_approval=待审批, disabled=已禁用"),
    }),
  }
);

/**
 * uninstall_skill - 卸载已安装的 Skill
 */
export const uninstallSkill = tool(
  async ({
    skillName,
  }: {
    skillName: string;
  }) => {
    const params = new URLSearchParams({ name: skillName });
    const res = await fetch(`/api/agent/skills/installed?${params}`, {
      method: "DELETE",
    });
    const data = await res.json();
    return JSON.stringify(data);
  },
  {
    name: "uninstall_skill",
    description: "卸载已安装的 skill。卸载后会从系统中移除该 skill。",
    schema: z.object({
      skillName: z.string().describe("要卸载的 skill 名称"),
    }),
  }
);

/**
 * check_skill_status - 检查 Skill 状态
 */
export const checkSkillStatus = tool(
  async ({
    skillName,
  }: {
    skillName: string;
  }) => {
    const params = new URLSearchParams({ status: "all" });
    const res = await fetch(`/api/agent/skills/installed${params ? "?" + params : ""}`);
    if (!res.ok) {
      return JSON.stringify({ error: "获取失败" });
    }
    const data = await res.json();
    const skill = (data.skills || []).find(
      (s: any) => s.skillName === skillName
    );
    if (!skill) {
      return JSON.stringify({ installed: false, skillName });
    }
    return JSON.stringify({ installed: true, ...skill });
  },
  {
    name: "check_skill_status",
    description: "检查指定 skill 的状态，包括是否已安装、是否在审批中、是否可用等。",
    schema: z.object({
      skillName: z.string().describe("要检查的 skill 名称"),
    }),
  }
);
