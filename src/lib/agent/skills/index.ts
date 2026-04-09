import { loadAllSkills, type SkillDefinition } from "./skillLoader";
import { prisma } from "@/lib/prisma";
import { join } from "path";
import { readFile } from "fs/promises";

let skillsCache: SkillDefinition[] | null = null;

/**
 * 获取所有已注册 skill（带缓存）
 * 注意：仅返回本地 skills，不包含用户安装的（用户安装的通过 getUserInstalledSkill 获取）
 */
export async function getAllSkills(): Promise<SkillDefinition[]> {
  if (skillsCache) return skillsCache;

  const baseDir = join(process.cwd(), "src/lib/agent/skills");
  skillsCache = await loadAllSkills(baseDir);
  return skillsCache;
}

/**
 * 根据 name 获取单个 skill（仅本地）
 */
export async function getSkill(name: string): Promise<SkillDefinition | null> {
  const skills = await getAllSkills();
  return skills.find((s) => s.name === name) ?? null;
}

/**
 * 获取 skill 对应的系统 prompt（仅本地）
 */
export async function getSkillPrompt(name: string): Promise<string | null> {
  const skill = await getSkill(name);
  return skill?.content ?? null;
}

/**
 * 获取用户安装的 skill 的 prompt
 */
export async function getUserInstalledSkillPrompt(
  userId: string,
  name: string
): Promise<string | null> {
  const installed = await prisma.installedSkill.findFirst({
    where: { userId, skillName: name, status: "active" },
  });

  if (!installed || !installed.localPath) {
    return null;
  }

  try {
    const content = await readFile(installed.localPath, "utf-8");
    const { data, content: skillContent } = parseFrontmatter(content);
    if (!data.name) return null;
    return skillContent.trim();
  } catch {
    return null;
  }
}

/**
 * 获取单个 skill（优先本地，其次用户安装）
 */
export async function getSkillWithUserInstalled(
  name: string,
  userId?: string
): Promise<SkillDefinition | null> {
  // 先检查本地
  const local = await getSkill(name);
  if (local) return local;

  // 再检查用户安装的
  if (!userId) return null;

  const installed = await prisma.installedSkill.findFirst({
    where: { userId, skillName: name, status: "active" },
  });

  if (!installed || !installed.localPath) return null;

  try {
    const content = await readFile(installed.localPath, "utf-8");
    const { data, content: skillContent } = parseFrontmatter(content);
    if (!data.name) return null;
    return {
      name: String(data.name),
      description: data.description ? String(data.description) : "",
      content: skillContent.trim(),
      userInvocable: data["user-invocable"] === true,
      disableModelInvoke: data["disable-model-invocation"] === true,
      filePath: installed.localPath,
    };
  } catch {
    return null;
  }
}

/**
 * 获取 skill prompt（支持用户安装的 skill）
 */
export async function getSkillPromptWithUserInstalled(
  name: string,
  userId?: string
): Promise<string | null> {
  const skill = await getSkillWithUserInstalled(name, userId);
  return skill?.content ?? null;
}

/**
 * 解析 YAML frontmatter（简化版）
 */
function parseFrontmatter(
  raw: string
): { data: Record<string, unknown>; content: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { data: {}, content: raw };
  }

  const yamlBlock = match[1];
  const content = match[2];
  const data: Record<string, unknown> = {};

  const lineRegex = /^(\w+(?:-\w+)*):\s*(.+)$/gm;
  let lineMatch;
  while ((lineMatch = lineRegex.exec(yamlBlock)) !== null) {
    const key = lineMatch[1];
    let value: string | boolean = lineMatch[2].trim();

    if (value === "true") value = true;
    else if (value === "false") value = false;
    else if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    data[key] = value;
  }

  return { data, content };
}

/**
 * 强制刷新缓存（开发环境）
 */
export async function refreshSkills(): Promise<SkillDefinition[]> {
  skillsCache = null;
  return getAllSkills();
}

export type { SkillDefinition };
