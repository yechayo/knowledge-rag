import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { POST } from "./route";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/embedding", () => ({
  generateEmbedding: vi.fn(async () => [0.1, 0.2, 0.3]),
  vectorToPostgresFormat: vi.fn(() => "[0.1,0.2,0.3]"),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $queryRaw: vi.fn(),
  },
}));

function makeChunk(overrides: Partial<{
  id: string;
  contentId: string;
  title: string;
  slug: string;
  category: string;
  content: string;
  score: number;
  chunkType: string;
}> = {}) {
  return {
    id: overrides.id ?? "chunk-1",
    contentId: overrides.contentId ?? "content-1",
    title: overrides.title ?? "防抖 debounce",
    slug: overrides.slug ?? "debounce",
    category: overrides.category ?? "article",
    content: overrides.content ?? "function debounce(fn, delay) { clearTimeout(timer); }",
    score: overrides.score ?? 0.9,
    chunkType: overrides.chunkType ?? "content_body",
    headingLevel: null,
    headingAnchor: null,
    headingText: null,
    sectionPath: null,
    sourceTitle: overrides.title ?? "防抖 debounce",
    sourceSlug: overrides.slug ?? "debounce",
    sourceCategory: overrides.category ?? "article",
    sourceTags: ["js"],
  };
}

describe("POST /api/retrieve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("retrieves grouped results independently for each chunk type", async () => {
    const queryRawMock = prisma.$queryRaw as unknown as Mock;
    queryRawMock.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const requestedType = values.find((value) =>
        ["nav_structure", "content_meta", "toc_entry", "content_body"].includes(String(value))
      );

      if (!requestedType) {
        return Array.from({ length: 20 }, (_, i) =>
          makeChunk({
            id: `meta-${i}`,
            chunkType: "content_meta",
            content: `概览 ${i}`,
          })
        );
      }

      return [
        makeChunk({
          id: `${requestedType}-1`,
          chunkType: String(requestedType),
          content: `${requestedType} 防抖 debounce 代码`,
        }),
      ];
    });

    const response = await POST(new Request("http://localhost/api/retrieve", {
      method: "POST",
      body: JSON.stringify({ query: "查看防抖怎么写", grouped: true }),
    }));

    const data = await response.json();

    expect(data.grouped.content_body).toEqual([
      expect.objectContaining({
        chunkId: "content_body-1",
        chunkType: "content_body",
        content: "content_body 防抖 debounce 代码",
      }),
    ]);
    expect(sqlForCalls()).toContain('c."chunkType" =');
  });
});

function sqlForCalls(): string {
  const queryRawMock = prisma.$queryRaw as unknown as Mock;
  return queryRawMock.mock.calls
    .map(([strings]) => Array.from(strings as TemplateStringsArray).join("?"))
    .join("\n");
}
