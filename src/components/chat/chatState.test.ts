import { describe, expect, it } from "vitest";
import {
  createAssistantChatMessage,
  reduceAssistantStreamEvent,
} from "./chatState";

describe("front chat stream reduction", () => {
  it("builds a single timeline in the same order as SSE events arrive", () => {
    let message = createAssistantChatMessage("assistant-1");

    message = reduceAssistantStreamEvent(message, {
      type: "route",
      data: { route: "retrieve_once", reason: "knowledge question" },
    });
    message = reduceAssistantStreamEvent(message, {
      type: "delta",
      data: { content: "先给出回答。" },
    });
    message = reduceAssistantStreamEvent(message, {
      type: "sources",
      data: [
        { title: "A", slug: "a", category: "article", contentPreview: "..." },
      ],
    });
    message = reduceAssistantStreamEvent(message, {
      type: "thinking",
      data: { content: "先分析一下问题" },
    });
    message = reduceAssistantStreamEvent(message, {
      type: "tool_start",
      data: {
        toolName: "search_knowledge_base",
        arguments: "{\"query\":\"RAG\"}",
      },
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
      type: "delta",
      data: { content: "继续补充。" },
    });
    message = reduceAssistantStreamEvent(message, {
      type: "done",
      data: {},
    });

    expect(message.timeline.map((step) => step.type)).toEqual([
      "route",
      "delta",
      "sources",
      "thinking",
      "tool_start",
      "tool_end",
      "done",
    ]);
    expect(message.timeline.map((step) => step.defaultOpen)).toEqual([
      false,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(message.timeline.find((step) => step.type === "delta")).toMatchObject({
      title: "最终回答",
      content: "先给出回答。继续补充。",
      status: "done",
    });
    expect(message.toolCalls).toHaveLength(1);
    expect(message.toolCalls?.[0]).toMatchObject({
      name: "search_knowledge_base",
      status: "done",
    });
    expect(message.content).toBe("先给出回答。继续补充。");
    expect(message.sources).toEqual([
      { title: "A", slug: "a", category: "article", contentPreview: "..." },
    ]);
    expect(message.isComplete).toBe(true);
  });

  it("keeps error events in the timeline", () => {
    let message = createAssistantChatMessage("assistant-2");

    message = reduceAssistantStreamEvent(message, {
      type: "route",
      data: { route: "react_retrieve", reason: "complex question" },
    });
    message = reduceAssistantStreamEvent(message, {
      type: "error",
      data: { message: "模型调用失败" },
    });

    expect(message.error).toBe("模型调用失败");
    expect(message.isComplete).toBe(true);
    expect(message.timeline.map((step) => step.type)).toEqual(["route", "error"]);
    expect(message.timeline[1]).toMatchObject({
      title: "发生错误",
      status: "error",
      defaultOpen: false,
      detail: "模型调用失败",
    });
  });
});
