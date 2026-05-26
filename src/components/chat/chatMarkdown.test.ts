import { describe, expect, it } from "vitest";
import { buildChatJumpHref, renderChatMarkdownToHtml } from "./chatMarkdown";

describe("front chat markdown helpers", () => {
  it("renders markdown structure and preserves ref links", () => {
    const html = renderChatMarkdownToHtml(
      "## 标题\n\n---\n\n- 项目一\n\n[[REF:/article/rag#intro|来源]]"
    );

    expect(html).toContain("<h2>标题</h2>");
    expect(html).toContain("<hr>");
    expect(html).toContain("<li>项目一</li>");
    expect(html).toContain('data-ref-href="/article/rag#intro"');
    expect(html).toContain(">来源</a>");
  });

  it("appends ref query parameter when building jump href", () => {
    expect(
      buildChatJumpHref("/article/rag#intro", "来源", [
        {
          title: "RAG",
          slug: "rag",
          category: "article",
          headingAnchor: "intro",
          contentPreview: "RAG 介绍",
        },
      ])
    ).toBe("/article/rag?ref=RAG%20%E4%BB%8B%E7%BB%8D#intro");
  });
});
