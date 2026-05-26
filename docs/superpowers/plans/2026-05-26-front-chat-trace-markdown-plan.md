# Front Chat Trace And Markdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add user-friendly step traces and full Markdown rendering to the homepage chat assistant without changing the existing `/api/chat` SSE contract.

**Architecture:** Introduce pure helpers for stream-event reduction and Markdown rendering, then wire the homepage chat panel and shared message bubble to consume those helpers. Reuse the existing agent-style tool block presentation, but convert raw stream events into readable trace steps instead of exposing raw model thinking.

**Tech Stack:** Next.js, React 19, TypeScript, Vitest, marked, DOMPurify

---

### Task 1: Add failing tests for front-chat stream reduction

**Files:**
- Create: `src/components/chat/chatState.test.ts`
- Create: `src/components/chat/chatState.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  createAssistantChatMessage,
  reduceAssistantStreamEvent,
} from "./chatState";

describe("front chat stream reduction", () => {
  it("builds readable trace steps from route/tool/source/delta events", () => {
    let message = createAssistantChatMessage("assistant-1");

    message = reduceAssistantStreamEvent(message, {
      type: "route",
      data: { route: "retrieve_once", reason: "knowledge question" },
    });
    message = reduceAssistantStreamEvent(message, {
      type: "thinking",
      data: { content: "先分析一下问题" },
    });
    message = reduceAssistantStreamEvent(message, {
      type: "tool_start",
      data: { toolName: "search_knowledge_base", arguments: "{\"query\":\"RAG\"}" },
    });
    message = reduceAssistantStreamEvent(message, {
      type: "tool_end",
      data: {
        toolName: "search_knowledge_base",
        success: true,
        result: JSON.stringify({
          sources: [
            { title: "A", slug: "a", category: "article", contentPreview: "..." },
            { title: "B", slug: "b", category: "article", contentPreview: "..." },
          ],
        }),
      },
    });
    message = reduceAssistantStreamEvent(message, {
      type: "sources",
      data: [{ title: "A", slug: "a", category: "article", contentPreview: "..." }],
    });
    message = reduceAssistantStreamEvent(message, {
      type: "delta",
      data: { content: "最终答案" },
    });
    message = reduceAssistantStreamEvent(message, {
      type: "done",
      data: {},
    });

    expect(message.traceSteps?.map((step) => [step.label, step.status, step.detail])).toEqual([
      ["识别问题类型", "done", "知识库单次检索回答"],
      ["分析问题与规划回答", "done", "已完成回答规划"],
      ["检索知识库", "done", "找到 2 条可引用来源"],
      ["整理引用来源", "done", "已附加 1 条来源"],
      ["生成回答", "done", "回答已生成"],
    ]);
    expect(message.content).toBe("最终答案");
    expect(message.isComplete).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/chat/chatState.test.ts`
Expected: FAIL because `./chatState` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/chat/chatState.ts` with typed helpers:

```ts
export function createAssistantChatMessage(id: string) {
  return { id, role: "assistant", content: "", toolCalls: [], traceSteps: [], isComplete: false };
}
```

- [ ] **Step 4: Run test to verify it still fails for behavior**

Run: `pnpm vitest run src/components/chat/chatState.test.ts`
Expected: FAIL on missing `reduceAssistantStreamEvent` behavior expectations.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/chatState.test.ts src/components/chat/chatState.ts
git commit -m "test: add front chat stream reduction coverage"
```

### Task 2: Add failing tests for Markdown + ref rendering helpers

**Files:**
- Create: `src/components/chat/chatMarkdown.test.ts`
- Create: `src/components/chat/chatMarkdown.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildChatJumpHref, renderChatMarkdownToHtml } from "./chatMarkdown";

describe("front chat markdown helpers", () => {
  it("renders markdown structure and preserves ref links", () => {
    const html = renderChatMarkdownToHtml("## 标题\n\n---\n\n- 项目一\n\n[[REF:/article/rag#intro|来源]]");

    expect(html).toContain("<h2>标题</h2>");
    expect(html).toContain("<hr>");
    expect(html).toContain("<li>项目一</li>");
    expect(html).toContain('data-ref-href="/article/rag#intro"');
  });

  it("appends ref query parameter when building jump href", () => {
    expect(
      buildChatJumpHref("/article/rag#intro", "来源", [
        { title: "RAG", slug: "rag", category: "article", headingAnchor: "intro", contentPreview: "RAG 介绍" },
      ])
    ).toBe("/article/rag?ref=RAG%20%E4%BB%8B%E7%BB%8D#intro");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/chat/chatMarkdown.test.ts`
Expected: FAIL because `./chatMarkdown` does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/chat/chatMarkdown.ts` with empty stubs:

```ts
export function renderChatMarkdownToHtml(content: string) {
  return content;
}

export function buildChatJumpHref(href: string) {
  return href;
}
```

- [ ] **Step 4: Run test to verify it still fails for behavior**

Run: `pnpm vitest run src/components/chat/chatMarkdown.test.ts`
Expected: FAIL on missing Markdown/ref transformations.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/chatMarkdown.test.ts src/components/chat/chatMarkdown.ts
git commit -m "test: add front chat markdown helper coverage"
```

### Task 3: Implement stream reduction helpers

**Files:**
- Modify: `src/components/chat/chatState.ts`
- Test: `src/components/chat/chatState.test.ts`

- [ ] **Step 1: Write minimal implementation for stream reduction**

Implement:
- assistant message factory
- route label/detail mapping
- trace-step upsert helpers
- tool result summary for `search_knowledge_base`
- `reduceAssistantStreamEvent`

- [ ] **Step 2: Run focused tests**

Run: `pnpm vitest run src/components/chat/chatState.test.ts`
Expected: PASS

- [ ] **Step 3: Refactor for clarity**

Extract helpers:
- `summarizeRoute`
- `summarizeToolResult`
- `upsertTraceStep`

- [ ] **Step 4: Re-run tests**

Run: `pnpm vitest run src/components/chat/chatState.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/chatState.ts src/components/chat/chatState.test.ts
git commit -m "feat: add front chat trace state reducer"
```

### Task 4: Implement Markdown rendering helpers

**Files:**
- Modify: `src/components/chat/chatMarkdown.ts`
- Test: `src/components/chat/chatMarkdown.test.ts`

- [ ] **Step 1: Implement Markdown rendering**

Add:
- ref token preprocessing from `[[REF:...]]` to safe anchor HTML
- `marked` parsing with `breaks` and `gfm`
- `DOMPurify.sanitize`
- `buildChatJumpHref`

- [ ] **Step 2: Run focused tests**

Run: `pnpm vitest run src/components/chat/chatMarkdown.test.ts`
Expected: PASS

- [ ] **Step 3: Refactor for readability**

Extract helpers:
- `replaceInlineRefs`
- `resolveRefText`
- `normalizePathname`

- [ ] **Step 4: Re-run tests**

Run: `pnpm vitest run src/components/chat/chatMarkdown.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/chatMarkdown.ts src/components/chat/chatMarkdown.test.ts
git commit -m "feat: add front chat markdown renderer"
```

### Task 5: Wire ChatPanel and MessageBubble to the new helpers

**Files:**
- Modify: `src/components/chat/ChatPanel.tsx`
- Modify: `src/components/chat/MessageBubble.tsx`

- [ ] **Step 1: Update `ChatPanel.tsx`**

Replace the ad-hoc message shape and SSE parsing with:
- assistant message factory from `chatState.ts`
- reducer-based handling for `route` / `thinking` / `tool_start` / `tool_end` / `sources` / `delta` / `done` / `error`
- `MessageBubble` rendering for both user and assistant messages

- [ ] **Step 2: Update `MessageBubble.tsx`**

Extend the props to support:
- `traceSteps`
- `sources`
- Markdown HTML rendering for assistant content
- existing tool call blocks

- [ ] **Step 3: Run targeted tests**

Run: `pnpm vitest run src/components/chat/chatState.test.ts src/components/chat/chatMarkdown.test.ts`
Expected: PASS

- [ ] **Step 4: Manual browser verification**

Run: `pnpm dev`

Verify on `http://localhost:3000`:
- assistant answer renders headings, separators, and lists
- chat shows a readable step trace
- source pills still jump correctly

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/ChatPanel.tsx src/components/chat/MessageBubble.tsx
git commit -m "feat: show front chat trace and markdown"
```

### Task 6: Final regression pass

**Files:**
- Modify: none unless regressions found
- Test: `src/app/api/chat/route.test.ts`

- [ ] **Step 1: Run route + helper tests**

Run: `pnpm vitest run src/app/api/chat/route.test.ts src/components/chat/chatState.test.ts src/components/chat/chatMarkdown.test.ts`
Expected: PASS

- [ ] **Step 2: Sanity-check no admin-agent regressions**

Verify shared `MessageBubble.tsx` still renders existing `thinking` and `toolCalls` props correctly.

- [ ] **Step 3: Capture any follow-up polish separately**

If visual polish is needed, keep it out of this task unless it blocks readability.

- [ ] **Step 4: Re-run all touched tests**

Run: `pnpm vitest run src/app/api/chat/route.test.ts src/components/chat/chatState.test.ts src/components/chat/chatMarkdown.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/chat/route.test.ts src/components/chat
git commit -m "test: verify front chat trace regression coverage"
```
