import { afterEach, describe, expect, it, vi } from "vitest";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { CustomChatModel } from "../llm";

describe("CustomChatModel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("serializes LangChain tool calls as OpenAI function tool calls", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "done" } }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const model = new CustomChatModel({
      modelName: "test-model",
      apiKey: "test-key",
      baseURL: "https://example.test/v1",
    });

    const aiMessage = new AIMessage({
      content: "",
      tool_calls: [{
        id: "call_1",
        name: "search_content",
        args: { query: "langchain tools" },
        type: "tool_call",
      }],
    } as any);

    await (model as any)._generate([
      new HumanMessage("find docs"),
      aiMessage,
      new ToolMessage({
        content: "result text",
        tool_call_id: "call_1",
      } as any),
    ]);

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(requestInit.body as string);

    expect(body.messages[1].tool_calls).toEqual([{
      id: "call_1",
      type: "function",
      function: {
        name: "search_content",
        arguments: JSON.stringify({ query: "langchain tools" }),
      },
    }]);
  });
});
