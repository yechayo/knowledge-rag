import { beforeEach, describe, expect, it, vi } from "vitest";

import { createContent, updateContent } from "../content";
import { generateContentChunks } from "@/lib/chunkGenerator";
import { generateEmbeddings } from "@/lib/embedding";
import { prisma } from "@/lib/prisma";

const tx = {
  chunk: {
    deleteMany: vi.fn(),
  },
  $queryRaw: vi.fn(),
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    content: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    image: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(async (callback: (txArg: typeof tx) => Promise<unknown>) => callback(tx)),
  },
}));

vi.mock("@/lib/chunkGenerator", () => ({
  generateContentChunks: vi.fn(() => [{
    content: "正文 chunk",
    chunkType: "content_body",
    sourceTitle: "Agent 新文章",
    sourceSlug: "agent-new-post",
    sourceCategory: "article",
    sourceTags: [],
  }]),
  generateContentHash: vi.fn(() => "hash-1"),
}));

vi.mock("@/lib/embedding", () => ({
  generateEmbeddings: vi.fn(async () => [[0.1, 0.2, 0.3]]),
  vectorToPostgresFormat: vi.fn(() => "[0.1,0.2,0.3]"),
}));

vi.mock("@/lib/vision", () => ({
  describeImage: vi.fn(),
}));

vi.mock("@/lib/oss", () => ({
  buildImageDataUrl: vi.fn(),
}));

function makeContent(overrides: Record<string, unknown> = {}) {
  return {
    id: "content-1",
    title: "Agent 文章",
    slug: "agent-post",
    body: "## 正文\n这是一篇文章。",
    category: "article",
    metadata: {},
    status: "published",
    viewCount: 0,
    createdAt: new Date("2026-04-28T00:00:00.000Z"),
    updatedAt: new Date("2026-04-28T00:00:00.000Z"),
    ...overrides,
  };
}

describe("createContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("indexes embeddings when creating published content", async () => {
    vi.mocked(prisma.content.upsert).mockResolvedValue(makeContent({
      title: "Agent 新文章",
      slug: "agent-new-post",
      body: "## 正文\n这是一篇由 Agent 创建的新文章。",
    }) as never);

    await createContent.invoke({
      title: "Agent 新文章",
      body: "## 正文\n这是一篇由 Agent 创建的新文章。",
      category: "article",
    });

    expect(generateContentChunks).toHaveBeenCalledWith(
      "## 正文\n这是一篇由 Agent 创建的新文章。",
      expect.objectContaining({
        id: "content-1",
        title: "Agent 新文章",
        slug: "agent-new-post",
        category: "article",
      })
    );
    expect(generateEmbeddings).toHaveBeenCalledWith(["正文 chunk"]);
    expect(tx.chunk.deleteMany).toHaveBeenCalledWith({ where: { contentId: "content-1" } });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });
});

describe("updateContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rebuilds embeddings when updating published content", async () => {
    vi.mocked(prisma.content.findUnique).mockResolvedValueOnce(makeContent() as never);
    vi.mocked(prisma.content.update).mockResolvedValue(makeContent({
      body: "## 正文\n这是整理后的新版内容。",
    }) as never);

    const result = await updateContent.invoke({
      id: "content-1",
      body: "## 正文\n这是整理后的新版内容。",
    });

    expect(prisma.content.update).toHaveBeenCalledWith({
      where: { id: "content-1" },
      data: { body: "## 正文\n这是整理后的新版内容。" },
    });
    expect(generateContentChunks).toHaveBeenCalledWith(
      "## 正文\n这是整理后的新版内容。",
      expect.objectContaining({ id: "content-1", slug: "agent-post" })
    );
    expect(generateEmbeddings).toHaveBeenCalledWith(["正文 chunk"]);
    expect(tx.chunk.deleteMany).toHaveBeenCalledWith({ where: { contentId: "content-1" } });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({ indexed: true }));
  });

  it("does not build embeddings when updating draft content", async () => {
    vi.mocked(prisma.content.findUnique).mockResolvedValueOnce(makeContent({ status: "draft" }) as never);
    vi.mocked(prisma.content.update).mockResolvedValue(makeContent({
      status: "draft",
      body: "草稿新版内容",
    }) as never);

    const result = await updateContent.invoke({
      id: "content-1",
      body: "草稿新版内容",
    });

    expect(generateEmbeddings).not.toHaveBeenCalled();
    expect(tx.chunk.deleteMany).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ status: "draft" }));
  });

  it("clears existing chunks when published content is changed to draft", async () => {
    vi.mocked(prisma.content.findUnique).mockResolvedValueOnce(makeContent({ status: "published" }) as never);
    vi.mocked(prisma.content.update).mockResolvedValue(makeContent({ status: "draft" }) as never);

    const result = await updateContent.invoke({
      id: "content-1",
      status: "draft",
    });

    expect(generateEmbeddings).not.toHaveBeenCalled();
    expect(tx.chunk.deleteMany).toHaveBeenCalledWith({ where: { contentId: "content-1" } });
    expect(result).toEqual(expect.objectContaining({ status: "draft", indexCleared: true }));
  });

  it("returns an error without updating content when slug is already used", async () => {
    vi.mocked(prisma.content.findUnique)
      .mockResolvedValueOnce(makeContent({ slug: "agent-post" }) as never)
      .mockResolvedValueOnce(makeContent({ id: "other-content", slug: "used-slug" }) as never);

    const result = await updateContent.invoke({
      id: "content-1",
      slug: "used-slug",
    });

    expect(prisma.content.update).not.toHaveBeenCalled();
    expect(generateEmbeddings).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ error: "Slug 已被占用", slug: "used-slug" }));
  });
});
