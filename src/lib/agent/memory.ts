import { prisma } from "@/lib/prisma";
import { readFile, readdir, stat } from "fs/promises";
import { join } from "path";

export interface MemoryEntry {
  id: string;
  type: "user" | "feedback" | "project" | "reference";
  name: string;
  description: string | null;
  content: string;
}

/**
 * 加载用户记忆（从数据库）
 */
export async function loadMemories(userId: string): Promise<MemoryEntry[]> {
  const rows = await prisma.agentMemory.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });

  return rows.map((r) => ({
    id: r.id,
    type: r.type as MemoryEntry["type"],
    name: r.name,
    description: r.description,
    content: r.content,
  }));
}

/**
 * 加载团队记忆（isPrivate = false）
 */
export async function loadTeamMemories(): Promise<MemoryEntry[]> {
  const rows = await prisma.agentMemory.findMany({
    where: { isPrivate: false },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });

  return rows.map((r) => ({
    id: r.id,
    type: r.type as MemoryEntry["type"],
    name: r.name,
    description: r.description,
    content: r.content,
  }));
}

/**
 * 格式化记忆为 prompt 片段
 */
export function formatMemoriesForPrompt(memories: MemoryEntry[]): string {
  if (memories.length === 0) return "";

  const sections: string[] = ["\n\n## 已知信息（长期记忆）\n"];
  sections.push("(以下信息是 Agent 已知的背景知识，不是用户当前输入)\n");

  const byType = {
    user: memories.filter((m) => m.type === "user"),
    feedback: memories.filter((m) => m.type === "feedback"),
    project: memories.filter((m) => m.type === "project"),
    reference: memories.filter((m) => m.type === "reference"),
  };

  const typeLabels: Record<string, string> = {
    user: "用户偏好",
    feedback: "已确认的方法（用户反馈后确定）",
    project: "项目上下文",
    reference: "参考资料",
  };

  for (const [type, entries] of Object.entries(byType)) {
    if (entries.length === 0) continue;
    sections.push(`\n### ${typeLabels[type]}\n`);
    for (const m of entries) {
      sections.push(`- **${m.name}**: ${m.content}`);
      if (m.description) sections.push(`  (${m.description})`);
      sections.push("\n");
    }
  }

  return sections.join("");
}

/**
 * 加载项目上下文（CLAUDE.md + 项目结构）
 */
export async function loadProjectContext(): Promise<string> {
  const parts: string[] = [];

  // 1. CLAUDE.md
  try {
    const claudeMd = await readFile(
      join(process.cwd(), "CLAUDE.md"),
      "utf-8"
    );
    parts.push("## 项目说明 (CLAUDE.md)\n(以下内容来自项目配置文件，不是用户输入)\n\n" + claudeMd.trim());
  } catch {}

  // 2. 项目结构概览
  const srcDir = join(process.cwd(), "src");
  try {
    const entries = await readdir(srcDir);
    const dirs: string[] = [];
    for (const e of entries) {
      if (e.startsWith(".")) continue;
      try {
        const s = await stat(join(srcDir, e));
        if (s.isDirectory()) dirs.push(e);
      } catch {}
    }
    if (dirs.length > 0) {
      parts.push(
        `\n## 项目源码结构（背景信息，不是用户输入）\n\nsrc/\n` +
          dirs.map((d) => `├── ${d}/`).join("\n")
      );
    }
  } catch {}

  // 3. 文档概览
  const docsDir = join(process.cwd(), "docs");
  try {
    const docsEntries = await readdir(docsDir, { withFileTypes: true });
    const docsStructure: string[] = [];
    for (const entry of docsEntries) {
      if (entry.isDirectory()) {
        docsStructure.push(`📁 ${entry.name}/`);
      } else {
        docsStructure.push(`📄 ${entry.name}`);
      }
    }
    if (docsStructure.length > 0) {
      parts.push(`\n## 文档目录（背景信息）\n\n` + docsStructure.join("\n"));
    }
  } catch {}

  return parts.join("\n\n---\n");
}
