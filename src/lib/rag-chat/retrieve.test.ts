import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { extractSources, retrieveGrouped } from "./retrieve";
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

  it("extracts deduplicated citation sources without inventing links", () => {
    const sources = extractSources({
      nav_structure: [],
      toc_entry: [],
      content_meta: [makeRow({
        id: "meta-1",
        chunkType: "content_meta",
        headingAnchor: null,
        headingText: null,
      }) as any],
      content_body: [
        makeRow({ id: "body-1" }) as any,
        makeRow({ id: "body-2", content: "重复来源" }) as any,
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
