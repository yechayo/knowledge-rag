import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { extractSources, retrieveGrouped } from "./retrieve";
import { prisma } from "@/lib/prisma";
import type { GroupedChunk } from "./types";

vi.mock("@/lib/embedding", () => ({
  generateEmbedding: vi.fn(async () => [0.1, 0.2, 0.3]),
  vectorToPostgresFormat: vi.fn(() => "[0.1,0.2,0.3]"),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "chunk-1",
    contentId: "content-1",
    title: "React Hooks",
    slug: "react-hooks",
    category: "article",
    content: "Hooks 必须在组件顶层调用。",
    score: 0.91,
    chunkType: "content_body",
    headingLevel: 2,
    headingAnchor: "rules",
    headingText: "Hook 规则",
    sectionPath: "React > Hook 规则",
    sourceTitle: "React Hooks",
    sourceSlug: "react-hooks",
    sourceCategory: "article",
    sourceTags: ["react"],
    ...overrides,
  };
}

function makeChunk(overrides: Record<string, unknown> = {}): GroupedChunk {
  const row = makeRow(overrides);
  return {
    chunkId: row.id,
    contentId: row.contentId,
    title: row.title,
    slug: row.slug,
    category: row.category,
    content: row.content,
    score: row.score,
    chunkType: row.chunkType,
    headingLevel: row.headingLevel,
    headingAnchor: row.headingAnchor,
    headingText: row.headingText,
    sectionPath: row.sectionPath,
    sourceTitle: row.sourceTitle,
    sourceTags: Array.isArray(row.sourceTags) ? row.sourceTags : [],
  };
}

describe("rag-chat retrieve helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retrieves grouped chunks without internal HTTP fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const queryRawMock = prisma.$queryRaw as unknown as Mock;
    queryRawMock.mockImplementation(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      const requestedType = values.find((value) =>
        ["nav_structure", "content_meta", "toc_entry", "content_body"].includes(String(value))
      );
      return [makeRow({ id: `${requestedType}-1`, chunkType: String(requestedType) })];
    });

    const grouped = await retrieveGrouped("React Hooks 规则");

    expect(grouped.content_body[0]).toEqual(expect.objectContaining({
      chunkId: "content_body-1",
      title: "React Hooks",
      headingAnchor: "rules",
    }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("combines vector and keyword matches for each chunk group", async () => {
    const queryRawMock = prisma.$queryRaw as unknown as Mock;
    let callIndex = 0;
    queryRawMock.mockImplementation(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      callIndex += 1;
      const requestedType = values.find((value) =>
        ["nav_structure", "content_meta", "toc_entry", "content_body"].includes(String(value))
      );
      const source = callIndex % 2 === 1 ? "vector" : "keyword";
      return [makeRow({
        id: `${requestedType}-${source}`,
        chunkType: String(requestedType),
        content: source === "keyword" ? "React Hooks 关键词命中。" : "Hooks 必须在组件顶层调用。",
        score: source === "keyword" ? 0.72 : 0.91,
      })];
    });

    const grouped = await retrieveGrouped("React Hooks 规则");

    expect(queryRawMock).toHaveBeenCalledTimes(8);
    expect(grouped.content_body.map((chunk) => chunk.chunkId)).toEqual([
      "content_body-vector",
      "content_body-keyword",
    ]);
  });

  it("extracts deduplicated citation sources without inventing links", () => {
    const sources = extractSources({
      nav_structure: [],
      toc_entry: [],
      content_meta: [makeChunk({
        id: "meta-1",
        chunkType: "content_meta",
        headingAnchor: null,
        headingText: null,
      })],
      content_body: [
        makeChunk({ id: "body-1" }),
        makeChunk({ id: "body-2", content: "重复来源" }),
      ],
    });

    expect(sources).toEqual([{
      title: "React Hooks",
      slug: "react-hooks",
      category: "article",
      headingAnchor: "hook-规则",
      headingText: "Hook 规则",
      sectionPath: "React > Hook 规则",
      contentPreview: "Hooks 必须在组件顶层调用。",
    }]);
  });
});
