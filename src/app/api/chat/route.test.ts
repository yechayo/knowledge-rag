import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  classifyChatIntent: vi.fn(),
  retrieveGrouped: vi.fn(),
  extractSources: vi.fn(),
  streamDirectAnswer: vi.fn(),
  streamRetrievedAnswer: vi.fn(),
  runRagReactAnswer: vi.fn(),
  buildInputMessagesFromHistory: vi.fn(),
  prisma: {
    usageLog: {
      create: vi.fn(),
    },
  },
  getOrCreateSession: vi.fn(),
  createQueryEngine: vi.fn(),
  engine: {
    initialize: vi.fn(),
    addUserMessage: vi.fn(),
    getMessages: vi.fn(),
    addAssistantMessage: vi.fn(),
    release: vi.fn(),
  },
}));

vi.mock("@/lib/rag-chat/intent", () => ({ classifyChatIntent: mocks.classifyChatIntent }));
vi.mock("@/lib/rag-chat/retrieve", () => ({
  retrieveGrouped: mocks.retrieveGrouped,
  extractSources: mocks.extractSources,
}));
vi.mock("@/lib/rag-chat/generate", () => ({
  streamDirectAnswer: mocks.streamDirectAnswer,
  streamRetrievedAnswer: mocks.streamRetrievedAnswer,
}));
vi.mock("@/lib/rag-chat/react", () => ({ runRagReactAnswer: mocks.runRagReactAnswer }));
vi.mock("@/lib/rag-chat/messages", () => ({ buildInputMessagesFromHistory: mocks.buildInputMessagesFromHistory }));
vi.mock("@/lib/agent/session", () => ({ getOrCreateSession: mocks.getOrCreateSession }));
vi.mock("@/lib/agent/chat", () => ({ createQueryEngine: mocks.createQueryEngine }));
vi.mock("@/lib/citation-evaluator", () => ({
  evaluateCitationQuality: vi.fn(() => ({})),
  getQualitySummary: vi.fn(() => "ok"),
}));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));

import { POST } from "./route";

function request(message: string) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    body: JSON.stringify({ message, sessionKey: "chat-1" }),
  });
}

async function readSseTypes(response: Response): Promise<string[]> {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((block) => JSON.parse(block.replace(/^data:\s*/, "")).type);
}

describe("POST /api/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DEEPSEEK_API_KEY", "deepseek-key");
    mocks.engine.initialize.mockResolvedValue([]);
    mocks.engine.addUserMessage.mockResolvedValue(undefined);
    mocks.engine.getMessages.mockResolvedValue([{ role: "user", content: "hello" }]);
    mocks.engine.addAssistantMessage.mockResolvedValue(undefined);
    mocks.engine.release.mockResolvedValue(undefined);
    mocks.getOrCreateSession.mockResolvedValue({ id: "session-1" });
    mocks.createQueryEngine.mockResolvedValue(mocks.engine);
    mocks.buildInputMessagesFromHistory.mockResolvedValue([]);
    mocks.prisma.usageLog.create.mockResolvedValue({});
  });

  it("answers direct route without retrieval", async () => {
    mocks.classifyChatIntent.mockResolvedValue({
      route: "direct",
      source: "rules",
      reason: "greeting",
      normalizedQuery: "你好",
    });
    mocks.streamDirectAnswer.mockImplementation(async (_query, send) => {
      send("delta", { content: "你好" });
      return "你好";
    });

    const response = await POST(request("你好"));
    const eventTypes = await readSseTypes(response);

    expect(eventTypes).toEqual(["init", "route", "delta", "done"]);
    expect(mocks.retrieveGrouped).not.toHaveBeenCalled();
    expect(mocks.runRagReactAnswer).not.toHaveBeenCalled();
    expect(mocks.getOrCreateSession).not.toHaveBeenCalled();
    expect(mocks.createQueryEngine).not.toHaveBeenCalled();
  });

  it("answers local lightweight direct route without DeepSeek key, retrieval, or model call", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    mocks.classifyChatIntent.mockResolvedValue({
      route: "direct",
      source: "rules",
      reason: "greeting",
      normalizedQuery: "你好",
      localReply: "你好！有什么可以帮你的吗？",
    });

    const response = await POST(request("你好"));
    const eventTypes = await readSseTypes(response);

    expect(eventTypes).toEqual(["init", "route", "delta", "done"]);
    expect(mocks.streamDirectAnswer).not.toHaveBeenCalled();
    expect(mocks.retrieveGrouped).not.toHaveBeenCalled();
    expect(mocks.runRagReactAnswer).not.toHaveBeenCalled();
    expect(mocks.createQueryEngine).not.toHaveBeenCalled();
  });

  it("runs one retrieval for retrieve_once route and emits sources", async () => {
    const grouped = { content_body: [] };
    const sources = [{ title: "A", slug: "a", category: "article", contentPreview: "A" }];
    mocks.classifyChatIntent.mockResolvedValue({
      route: "retrieve_once",
      source: "rules",
      reason: "knowledge",
      normalizedQuery: "项目",
    });
    mocks.retrieveGrouped.mockResolvedValue(grouped);
    mocks.extractSources.mockReturnValue(sources);
    mocks.streamRetrievedAnswer.mockImplementation(async (_query, _grouped, _sources, send) => {
      send("delta", { content: "答案" });
      return "答案";
    });

    const response = await POST(request("知识库里有哪些项目？"));
    const eventTypes = await readSseTypes(response);

    expect(mocks.retrieveGrouped).toHaveBeenCalledWith("项目");
    expect(mocks.streamRetrievedAnswer).toHaveBeenCalledWith("知识库里有哪些项目？", grouped, sources, expect.any(Function), expect.any(Object));
    expect(eventTypes).toEqual(["init", "route", "delta", "sources", "done"]);
    expect(mocks.createQueryEngine).not.toHaveBeenCalled();
  });

  it("runs ReAct route and emits sources returned from search tool results", async () => {
    const sources = [{ title: "A", slug: "a", category: "article", contentPreview: "A" }];
    mocks.classifyChatIntent.mockResolvedValue({
      route: "react_retrieve",
      source: "rules",
      reason: "complex",
      normalizedQuery: "对比项目",
    });
    mocks.runRagReactAnswer.mockImplementation(async ({ send }) => {
      send("delta", { content: "复杂答案" });
      return { answer: "复杂答案", sources };
    });

    const response = await POST(request("对比知识库里的两个项目"));
    const eventTypes = await readSseTypes(response);

    expect(mocks.retrieveGrouped).not.toHaveBeenCalled();
    expect(mocks.runRagReactAnswer).toHaveBeenCalled();
    expect(eventTypes).toEqual(["init", "route", "delta", "sources", "done"]);
  });
});
