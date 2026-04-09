import { readFile } from "fs/promises";
import { join } from "path";

export interface SkillDefinition {
  name: string;
  description: string;
  content: string;
  userInvocable: boolean;
  disableModelInvoke: boolean;
  filePath: string;
}

interface ParsedFrontmatter {
  name?: string;
  description?: string;
  "user-invocable"?: boolean;
  "disable-model-invocation"?: boolean;
}

/**
 * 解析 YAML frontmatter
 * 使用简单正则匹配，支持 string 和 boolean 类型
 */
function parseFrontmatter(raw: string): { data: ParsedFrontmatter; content: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { data: {}, content: raw };
  }

  const yamlBlock = match[1];
  const content = match[2];
  const data: Record<string, unknown> = {};

  // 匹配 key: value 行
  const lineRegex = /^(\w+(?:-\w+)*):\s*(.+)$/gm;
  let lineMatch;
  while ((lineMatch = lineRegex.exec(yamlBlock)) !== null) {
    const key = lineMatch[1];
    let value: string | boolean = lineMatch[2].trim();

    // boolean 检测
    if (value === "true") value = true;
    else if (value === "false") value = false;
    // 去除引号
    else if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    data[key] = value;
  }

  return {
    data: data as ParsedFrontmatter,
    content,
  };
}

/**
 * 加载单个 skill 文件
 */
export async function loadSkill(skillPath: string): Promise<SkillDefinition | null> {
  try {
    const raw = await readFile(skillPath, "utf-8");
    const { data, content } = parseFrontmatter(raw);

    if (!data.name) {
      console.warn(`[skillLoader] Skill at ${skillPath} missing required "name" field`);
      return null;
    }

    return {
      name: String(data.name),
      description: data.description ? String(data.description) : "",
      content: content.trim(),
      userInvocable: data["user-invocable"] === true,
      disableModelInvoke: data["disable-model-invocation"] === true,
      filePath: skillPath,
    };
  } catch (err) {
    console.error(`[skillLoader] Failed to load skill from ${skillPath}:`, err);
    return null;
  }
}

/**
 * 扫描 skills 目录，加载所有 skill
 */
export async function loadAllSkills(baseDir: string): Promise<SkillDefinition[]> {
  const { readdir, stat } = await import("fs/promises");

  const skills: SkillDefinition[] = [];

  async function walk(dir: string) {
    const entries = await readdir(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const s = await stat(fullPath);
      if (s.isDirectory()) {
        const skillFile = join(fullPath, "SKILL.md");
        const skill = await loadSkill(skillFile);
        if (skill) skills.push(skill);
      }
    }
  }

  await walk(baseDir);
  return skills;
}
