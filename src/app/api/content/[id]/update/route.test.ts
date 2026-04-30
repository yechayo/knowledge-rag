import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  indexContent: vi.fn(),
  prisma: {
    content: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    chunk: {
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/content-indexer", () => ({
  indexContent: mocks.indexContent,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: mocks.prisma,
}));

import { PATCH } from "./route";

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

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/content/content-1/update", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: "content-1" }) };

describe("PATCH /api/content/[id]/update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({ user: { isAdmin: true } });
    mocks.indexContent.mockResolvedValue({
      totalChunks: 2,
      contentBody: 1,
      contentMeta: 1,
      tocEntry: 0,
      imageDescriptions: 0,
    });
  });

  it("rebuilds embeddings when updating published content", async () => {
    mocks.prisma.content.findUnique.mockResolvedValue(makeContent({ status: "published" }));
    mocks.prisma.content.update.mockResolvedValue(makeContent({
      body: "## 正文\n新版内容",
      status: "published",
    }));

    const response = await PATCH(request({ body: "## 正文\n新版内容" }), params);
    const data = await response.json();

    expect(mocks.indexContent).toHaveBeenCalledWith(expect.objectContaining({
      id: "content-1",
      body: "## 正文\n新版内容",
      status: "published",
    }));
    expect(data).toEqual(expect.objectContaining({
      indexed: true,
      indexStats: expect.objectContaining({ totalChunks: 2 }),
    }));
  });

  it("does not index draft content", async () => {
    mocks.prisma.content.findUnique.mockResolvedValue(makeContent({ status: "draft" }));
    mocks.prisma.content.update.mockResolvedValue(makeContent({
      body: "草稿新版内容",
      status: "draft",
    }));

    const response = await PATCH(request({ body: "草稿新版内容" }), params);
    const data = await response.json();

    expect(mocks.indexContent).not.toHaveBeenCalled();
    expect(mocks.prisma.chunk.deleteMany).not.toHaveBeenCalled();
    expect(data).toEqual(expect.objectContaining({ status: "draft" }));
  });

  it("clears chunks when published content is changed to draft", async () => {
    mocks.prisma.content.findUnique.mockResolvedValue(makeContent({ status: "published" }));
    mocks.prisma.content.update.mockResolvedValue(makeContent({ status: "draft" }));

    const response = await PATCH(request({ status: "draft" }), params);
    const data = await response.json();

    expect(mocks.indexContent).not.toHaveBeenCalled();
    expect(mocks.prisma.chunk.deleteMany).toHaveBeenCalledWith({ where: { contentId: "content-1" } });
    expect(data).toEqual(expect.objectContaining({ status: "draft", indexCleared: true }));
  });

  it("returns 401 for non-admin users", async () => {
    mocks.getServerSession.mockResolvedValue({ user: { isAdmin: false } });

    const response = await PATCH(request({ body: "不会更新" }), params);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data).toEqual({ error: "Unauthorized" });
    expect(mocks.prisma.content.update).not.toHaveBeenCalled();
  });
});
