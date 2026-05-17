import { describe, expect, it, vi } from "vitest";
import type { ToolResultEntry } from "@/lib/agent/stream/agentRunner";
import { extractSourcesFromToolResults } from "./react";

vi.mock("@/lib/agent/tools/registry", () => ({
  createReadOnlyToolRegistry: () => ({ tools: [], rawTools: [] }),
}));

vi.mock("@/lib/agent/stream/agentRunner", () => ({
  runAgentStream: vi.fn(),
}));

vi.mock("./deepseek", () => ({
  createDeepSeekChatModel: vi.fn(),
}));

vi.mock("./retrieve", () => ({
  searchKnowledgeBase: vi.fn(),
}));

describe("rag-chat ReAct helpers", () => {
  it("extracts citation sources returned by searchKnowledgeBase tool results", () => {
    const toolResults: ToolResultEntry[] = [
      {
        toolName: "search_knowledge_base",
        result: JSON.stringify({
          context: "content",
          sources: [
            {
              title: "React Hooks",
              slug: "react-hooks",
              category: "article",
              headingAnchor: "hook-rules",
              headingText: "Hook Rules",
              sectionPath: "React > Hook Rules",
              contentPreview: "Hooks must be called at the top level.",
            },
          ],
        }),
      },
      {
        toolName: "list_content",
        result: JSON.stringify({ sources: [{ title: "Ignored", slug: "ignored", category: "article" }] }),
      },
    ];

    expect(extractSourcesFromToolResults(toolResults)).toEqual([
      {
        title: "React Hooks",
        slug: "react-hooks",
        category: "article",
        headingAnchor: "hook-rules",
        headingText: "Hook Rules",
        sectionPath: "React > Hook Rules",
        contentPreview: "Hooks must be called at the top level.",
      },
    ]);
  });

  it("deduplicates parsed sources and ignores malformed tool output", () => {
    const toolResults: ToolResultEntry[] = [
      { toolName: "search_knowledge_base", result: "not json" },
      {
        toolName: "search_knowledge_base",
        result: JSON.stringify({
          sources: [
            { title: "A", slug: "a", category: "article", contentPreview: "one" },
            { title: "A Again", slug: "a", category: "article", contentPreview: "two" },
            { title: "Missing category", slug: "bad", contentPreview: "bad" },
          ],
        }),
      },
    ];

    expect(extractSourcesFromToolResults(toolResults)).toEqual([
      {
        title: "A",
        slug: "a",
        category: "article",
        headingAnchor: null,
        headingText: null,
        sectionPath: null,
        contentPreview: "one",
      },
    ]);
  });
});
