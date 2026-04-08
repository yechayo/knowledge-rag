import { tool } from "@langchain/core/tools";
import { z } from "zod";
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
    // 生成 slug
    const baseSlug = slug || title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\u4e00-\u9fff-]/g, "");

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

    return content;
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
    category: string;
    status?: string;
    limit?: number;
  }) => {
    const contents = await prisma.content.findMany({
      where: {
        category,
        ...(status ? { status } : {}),
      },
      select: {
        id: true,
        title: true,
        slug: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return JSON.stringify(contents);
  },
  {
    name: "list_content",
    description: "查询内容列表",
    schema: z.object({
      category: z.string().describe("内容分类"),
      status: z.string().optional().describe("状态过滤"),
      limit: z.number().optional().describe("返回数量，默认 100"),
    }),
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
