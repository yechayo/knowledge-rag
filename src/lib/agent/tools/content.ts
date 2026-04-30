import { tool } from "@langchain/core/tools";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { indexContent } from "@/lib/content-indexer";
import { prisma } from "@/lib/prisma";

export const createContent = tool(
  async ({
    title,
    body,
    category,
    slug,
    status = "published",
  }: {
    title: string;
    body: string;
    category: string;
    slug?: string;
    status?: string;
  }) => {
    if (!title || !body || !category) {
      return JSON.stringify({ error: "缺少必要参数", provided: { title: !!title, body: !!body, category: !!category } });
    }

    // 生成 slug
    const baseSlug = slug || title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\u4e00-\u9fff-]/g, "");

    if (!baseSlug) {
      return JSON.stringify({ error: "slug 生成为空，请检查标题", title });
    }

    // 使用 upsert 确保原子性，避免竞态条件
    const content = await prisma.content.upsert({
      where: { slug: baseSlug },
      update: {
        title,
        body,
        category,
        status,
      },
      create: {
        title,
        body,
        category,
        slug: baseSlug,
        status,
      },
    });

    if (content.status !== "published") {
      return content;
    }

    const indexStats = await indexContent(content);
    return {
      ...content,
      indexed: true,
      indexStats,
    };
  },
  {
    name: "create_content",
    description: "创建新内容并发布到网站",
    schema: z.object({
      title: z.string().describe("内容标题"),
      body: z.string().describe("内容正文（Markdown 格式）"),
      category: z.string().describe("分类：news, article, note, page 等"),
      slug: z.string().optional().describe("URL slug，可选"),
      status: z.string().optional().describe("状态：draft 或 published"),
    }),
  }
);

export const listContent = tool(
  async ({
    category,
    status,
    limit = 100,
  }: {
    category?: string;
    status?: string;
    limit?: number;
  }) => {
    const where: { category?: string; status?: string } = {};
    // 只有当 category 有值时才添加 category 过滤
    if (category && category.trim() !== "") {
      where.category = category;
    }
    if (status) {
      where.status = status;
    }

    const contents = await prisma.content.findMany({
      where,
      select: {
        id: true,
        title: true,
        slug: true,
        category: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    // 为每条内容添加 link 字段，方便模型生成引用标记
    const result = contents.map((c) => ({
      ...c,
      link: `/${c.category}/${c.slug}`,
    }));

    return JSON.stringify(result);
  },
  {
    name: "list_content",
    description: "查询内容列表。如果不传 category，则返回所有分类的内容。",
    schema: z.object({
      category: z.string().optional().describe("内容分类，不传则返回所有分类"),
      status: z.string().optional().describe("状态过滤"),
      limit: z.coerce.number().optional().describe("返回数量，默认 100"),
    }),
  }
);

export const listCategories = tool(
  async () => {
    // 获取所有不重复的分类
    const results = await prisma.content.findMany({
      select: { category: true },
      distinct: ["category"],
      where: { status: "published" },
    });
    const categories = results.map((r) => r.category).filter(Boolean);
    return JSON.stringify(categories);
  },
  {
    name: "list_categories",
    description: "获取所有已使用的分类列表",
    schema: z.object({}),
  }
);

export const deleteContent = tool(
  async ({ id }: { id: string }) => {
    // 使用事务确保原子性删除
    const result = await prisma.$transaction([
      prisma.chunk.deleteMany({ where: { contentId: id } }),
      prisma.content.delete({ where: { id } }),
    ]);
    return result;
  },
  {
    name: "delete_content",
    description: "删除内容及其关联向量块",
    schema: z.object({
      id: z.string().describe("内容 ID"),
    }),
  }
);

export const updateContent = tool(
  async ({
    id,
    title,
    body,
    category,
    slug,
    metadata,
    status,
  }: {
    id: string;
    title?: string;
    body?: string;
    category?: string;
    slug?: string;
    metadata?: Prisma.InputJsonValue;
    status?: string;
  }) => {
    const existing = await prisma.content.findUnique({ where: { id } });
    if (!existing) {
      return { error: "内容不存在", id };
    }

    const updateData: {
      title?: string;
      body?: string;
      category?: string;
      status?: string;
      metadata?: Prisma.InputJsonValue;
      slug?: string;
    } = {};
    if (title !== undefined) updateData.title = title;
    if (body !== undefined) updateData.body = body;
    if (category !== undefined) updateData.category = category;
    if (status !== undefined) updateData.status = status;
    if (metadata !== undefined) updateData.metadata = metadata;

    // 如果要更新 slug，检查是否与其他内容冲突
    if (slug !== undefined && slug !== existing.slug) {
      const slugConflict = await prisma.content.findUnique({ where: { slug } });
      if (slugConflict) {
        return { error: "Slug 已被占用", slug };
      }
      updateData.slug = slug;
    }

    if (Object.keys(updateData).length === 0) {
      return { error: "No fields to update", id };
    }

    const updated = await prisma.content.update({
      where: { id },
      data: updateData,
    });

    if (existing.status === "published" && updated.status !== "published") {
      await prisma.$transaction(async (tx) => {
        await tx.chunk.deleteMany({ where: { contentId: id } });
      });
      return {
        ...updated,
        indexCleared: true,
      };
    }

    const changesAffectIndex =
      title !== undefined ||
      body !== undefined ||
      category !== undefined ||
      slug !== undefined ||
      metadata !== undefined ||
      status === "published";

    if (updated.status !== "published" || !changesAffectIndex) {
      return updated;
    }

    const indexStats = await indexContent(updated);
    return {
      ...updated,
      indexed: true,
      indexStats,
    };
  },
  {
    name: "update_content",
    description: "更新已有内容。仅更新传入的字段，未传入的字段保持不变。已发布内容更新后会自动重建知识库 embedding；改为草稿会清理旧向量块。",
    schema: z.object({
      id: z.string().describe("要更新的内容 ID"),
      title: z.string().optional().describe("新标题"),
      body: z.string().optional().describe("新正文（Markdown）"),
      category: z.string().optional().describe("新分类"),
      slug: z.string().optional().describe("新 URL slug"),
      metadata: z.record(z.string(), z.unknown()).optional().describe("新元数据"),
      status: z.string().optional().describe("新状态：draft 或 published"),
    }),
  }
);

export const renameCategory = tool(
  async ({
    oldCategory,
    newCategory,
  }: {
    oldCategory: string;
    newCategory: string;
  }) => {
    // 获取旧分类下的内容数量
    const count = await prisma.content.count({
      where: { category: oldCategory },
    });

    if (count === 0) {
      return { message: "该分类下没有内容，无需重命名", oldCategory, newCategory, count: 0 };
    }

    // 批量更新所有内容到新分类
    const result = await prisma.content.updateMany({
      where: { category: oldCategory },
      data: { category: newCategory },
    });

    return {
      message: `已将 ${count} 条内容从「${oldCategory}」重命名为「${newCategory}」`,
      oldCategory,
      newCategory,
      count: result.count,
    };
  },
  {
    name: "rename_category",
    description: "重命名内容分类。将旧分类名称改为新名称，该分类下所有内容都会更新。",
    schema: z.object({
      oldCategory: z.string().describe("原分类名称"),
      newCategory: z.string().describe("新分类名称"),
    }),
  }
);

export const deleteCategory = tool(
  async ({ category }: { category: string }) => {
    // 获取该分类下的内容
    const contents = await prisma.content.findMany({
      where: { category },
      select: { id: true, title: true },
    });

    if (contents.length === 0) {
      return { message: "该分类下没有内容", category, count: 0 };
    }

    // 收集所有关联的 chunk IDs
    const chunkCounts: Record<string, number> = {};
    for (const content of contents) {
      const chunkCount = await prisma.chunk.count({ where: { contentId: content.id } });
      chunkCounts[content.id] = chunkCount;
    }

    const totalChunks = Object.values(chunkCounts).reduce((a, b) => a + b, 0);

    // 事务删除：先删 chunks，再删 content
    for (const content of contents) {
      await prisma.$transaction([
        prisma.chunk.deleteMany({ where: { contentId: content.id } }),
        prisma.content.delete({ where: { id: content.id } }),
      ]);
    }

    return {
      message: `已删除分类「${category}」及其下的 ${contents.length} 条内容，共 ${totalChunks} 个向量块`,
      category,
      contentCount: contents.length,
      chunkCount: totalChunks,
      deletedContent: contents.map((c) => ({ id: c.id, title: c.title })),
    };
  },
  {
    name: "delete_category",
    description: "删除整个分类及其下的所有内容（包括关联的向量块）。这是不可恢复的操作。",
    schema: z.object({
      category: z.string().describe("要删除的分类名称"),
    }),
  }
);

export const getCategoryStats = tool(
  async () => {
    const results = await prisma.content.groupBy({
      by: ["category"],
      _count: { id: true },
      _sum: { viewCount: true },
      orderBy: { _count: { id: "desc" } },
    });

    const stats = results.map((r) => ({
      category: r.category,
      contentCount: r._count.id,
      totalViews: r._sum.viewCount || 0,
    }));

    return JSON.stringify(stats);
  },
  {
    name: "get_category_stats",
    description: "获取所有分类的统计信息，包括每个分类的内容数量和总浏览量。",
    schema: z.object({}),
  }
);

export const brainstorm = tool(
  async ({
    topic,
    goal,
    constraints,
  }: {
    topic: string;
    goal?: string;
    constraints?: string[];
  }) => {
    // 获取已有内容作为上下文参考
    const existingContent = await prisma.content.findMany({
      select: { title: true, category: true },
      orderBy: { updatedAt: "desc" },
      take: 20,
    });

    const context = existingContent.length > 0
      ? `现有内容参考：\n${existingContent.map((c) => `- [${c.category}] ${c.title}`).join("\n")}`
      : "（暂无现有内容）";

    const constraintsText = constraints && constraints.length > 0
      ? `约束条件：\n${constraints.map((c, i) => `${i + 1}. ${c}`).join("\n")}`
      : "";

    const prompt = `## 角色
你是一个创意头脑风暴专家，帮助用户围绕特定主题产生创意想法。

## 任务
围绕「${topic}」进行创意头脑风暴。

${goal ? `## 目标\n${goal}` : ""}

${constraintsText ? `${constraintsText}\n` : ""}
## 现有内容参考
${context}

## 输出要求
请生成 5-8 个创意方向/想法，每个包括：
1. **创意标题**：简洁有力的名称
2. **核心思路**：用 1-2 句话描述要点
3. **实施建议**：具体的行动步骤或注意事项

请用中文回复，格式清晰易读。`;

    return {
      topic,
      goal: goal || null,
      constraints: constraints || [],
      prompt,
      note: "此工具返回 brainstorming prompt，实际调用 LLM 生成创意内容需要通过 chat 接口",
    };
  },
  {
    name: "brainstorm",
    description: "围绕特定主题进行创意头脑风暴。返回包含创意方向、核心思路和实施建议的结构化提示，可用于后续 LLM 调用生成具体创意。",
    schema: z.object({
      topic: z.string().describe("要头脑风暴的主题或领域"),
      goal: z.string().optional().describe("希望达成的目标或效果"),
      constraints: z.array(z.string()).optional().describe("需要考虑的约束条件或限制"),
    }),
  }
);

export const suggestContentIdeas = tool(
  async ({ category }: { category?: string }) => {
    // 获取该分类下已有的标题作为参考
    const where: { category?: string } = {};
    if (category) where.category = category;

    const existingTitles = await prisma.content.findMany({
      where,
      select: { title: true, category: true },
      orderBy: { updatedAt: "desc" },
      take: 30,
    });

    const categoryContext = category
      ? `现有「${category}」分类的内容：\n${existingTitles.map((c) => `- ${c.title}`).join("\n")}`
      : `全站现有内容：\n${existingTitles.map((c) => `- [${c.category}] ${c.title}`).join("\n")}`;

    const prompt = `## 任务
基于现有内容，为${category ? `「${category}」分类` : "全站"}推荐新的内容选题。

${categoryContext}

## 要求
请推荐 5-8 个新的内容选题，要求：
1. 与现有内容不重复
2. 具有实际价值和创新性
3. 考虑搜索引擎优化（包含常见搜索关键词）

请为每个选题提供：
1. **标题**：吸引点击的标题
2. **类别**：建议的分类
3. **核心关键词**：用于 SEO
4. **简要说明**：为什么这个选题有价值

请用中文回复。`;

    return {
      category: category || "全站",
      existingCount: existingTitles.length,
      prompt,
    };
  },
  {
    name: "suggest_content_ideas",
    description: "基于现有内容，推荐新的内容选题创意。帮助发现内容空白点，提供 SEO 友好的选题建议。",
    schema: z.object({
      category: z.string().optional().describe("指定分类，不指定则基于全站内容推荐"),
    }),
  }
);
