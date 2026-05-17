import { beforeEach, describe, expect, it, vi } from "vitest";

import { classifyChatIntent } from "./intent";

describe("classifyChatIntent", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("routes greetings directly without calling DeepSeek", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await classifyChatIntent("你好");

    expect(result).toEqual(expect.objectContaining({
      route: "direct",
      needsKnowledge: false,
      source: "rules",
      localReply: expect.any(String),
    }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("routes specific ordinary questions directly without calling DeepSeek", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await classifyChatIntent("什么是 TypeScript 闭包？");

    expect(result).toEqual(expect.objectContaining({
      route: "direct",
      needsKnowledge: false,
      source: "rules",
    }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("routes explicit knowledge-base questions to single retrieval", async () => {
    const result = await classifyChatIntent("知识库里有哪些 React Hooks 文章？");

    expect(result).toEqual(expect.objectContaining({
      route: "retrieve_once",
      needsKnowledge: true,
      source: "rules",
    }));
  });

  it("routes multi-hop comparison questions to ReAct retrieval", async () => {
    const result = await classifyChatIntent("对比知识库里 React Hooks 和 Agent 防死循环两篇文章，总结共同点");

    expect(result).toEqual(expect.objectContaining({
      route: "react_retrieve",
      needsKnowledge: true,
      source: "rules",
    }));
  });

  it("uses DeepSeek JSON classification when local rules are uncertain", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            route: "retrieve_once",
            confidence: 0.71,
            needsKnowledge: true,
            normalizedQuery: "项目经验",
            reason: "需要查询站内项目内容",
          }),
        },
      }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await classifyChatIntent("这个方向怎么说");

    expect(result).toEqual({
      route: "retrieve_once",
      confidence: 0.71,
      needsKnowledge: true,
      normalizedQuery: "项目经验",
      reason: "需要查询站内项目内容",
      source: "deepseek",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.deepseek.com/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
      })
    );
  });

  it("times out uncertain DeepSeek classification and falls back to retrieve_once", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubEnv("RAG_CLASSIFIER_TIMEOUT_MS", "10");
    vi.stubGlobal("fetch", vi.fn((_url, init) => new Promise((_resolve, reject) => {
      const signal = (init as RequestInit).signal;
      signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    })));

    const result = await classifyChatIntent("这个方向怎么说");

    expect(result).toEqual(expect.objectContaining({
      route: "retrieve_once",
      needsKnowledge: true,
      source: "fallback",
    }));
  }, 1000);

  it("falls back to retrieve_once when DeepSeek classification fails", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad gateway", { status: 502 })));

    const result = await classifyChatIntent("这个怎么处理");

    expect(result).toEqual(expect.objectContaining({
      route: "retrieve_once",
      needsKnowledge: true,
      source: "fallback",
    }));
  });
});
