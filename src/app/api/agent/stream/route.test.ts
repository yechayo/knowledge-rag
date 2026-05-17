import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  createAgentModel: vi.fn(),
  getOrCreateSession: vi.fn(),
  createQueryEngine: vi.fn(),
  prisma: {
    agentModelConfig: {
      findUnique: vi.fn(),
    },
    agentSession: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/langchain/llm", () => ({ createAgentModel: mocks.createAgentModel }));
vi.mock("@/lib/agent/session", () => ({ getOrCreateSession: mocks.getOrCreateSession }));
vi.mock("@/lib/agent/chat", () => ({ createQueryEngine: mocks.createQueryEngine }));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/agent/skills", () => ({ getSkillPromptWithUserInstalled: vi.fn() }));
vi.mock("@/lib/agent/skillRouter", () => ({ resolveSkillContext: vi.fn(() => ({ activeSkill: null, cleanMessage: null })) }));
vi.mock("@/lib/agent/memory", () => ({
  loadMemories: vi.fn(async () => []),
  loadTeamMemories: vi.fn(async () => []),
  formatMemoriesForPrompt: vi.fn(() => ""),
  loadProjectContext: vi.fn(async () => ""),
}));
vi.mock("@/lib/agent/tools/registry", () => ({
  createToolRegistry: vi.fn(() => ({ tools: [], rawTools: [] })),
}));
vi.mock("@/lib/agent/stream/agentRunner", () => ({
  runAgentStream: vi.fn(),
}));

import { POST } from "./route";

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/agent/stream", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/agent/stream", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.getServerSession.mockResolvedValue({ user: { id: "admin-1", isAdmin: true } });
  });

  it("returns a clear SSE error when no backend model config is selected", async () => {
    mocks.createAgentModel.mockImplementation(() => {
      throw new Error("缺少后台 Agent 模型配置（请在模型设置中保存并选择配置）");
    });

    const response = await POST(request({ message: "你好", sessionKey: "agent-1" }));
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(text).toContain("缺少后台 Agent 模型配置");
    expect(mocks.getOrCreateSession).not.toHaveBeenCalled();
  });

  it("loads saved model configs server-side when modelConfigId is provided", async () => {
    const engine = {
      initialize: vi.fn(async () => []),
      addUserMessage: vi.fn(async () => undefined),
      checkAndCompact: vi.fn(async () => undefined),
      getMessages: vi.fn(async () => []),
      release: vi.fn(async () => undefined),
    };
    mocks.prisma.agentModelConfig.findUnique.mockResolvedValue({
      id: "cfg-1",
      modelName: "deepseek-chat",
      baseURL: "https://api.deepseek.com",
      apiKey: "sk-saved",
    });
    mocks.prisma.agentSession.findUnique.mockResolvedValue({ metadata: {} });
    mocks.getOrCreateSession.mockResolvedValue({ id: "session-1" });
    mocks.createQueryEngine.mockResolvedValue(engine);
    mocks.createAgentModel.mockReturnValue({});

    const response = await POST(request({ message: "你好", sessionKey: "agent-1", modelConfigId: "cfg-1" }));
    await response.text();

    expect(mocks.createAgentModel).toHaveBeenCalledWith(
      { temperature: 0.7, maxTokens: 8000 },
      {
        modelName: "deepseek-chat",
        baseURL: "https://api.deepseek.com",
        apiKey: "sk-saved",
      }
    );
  });

  it("releases initialized sessions when model configuration is invalid", async () => {
    vi.stubEnv("AGENT_MODEL_NAME", "deepseek-chat");
    const engine = {
      initialize: vi.fn(async () => []),
      addUserMessage: vi.fn(async () => undefined),
      release: vi.fn(async () => undefined),
    };
    mocks.getOrCreateSession.mockResolvedValue({ id: "session-1" });
    mocks.createQueryEngine.mockResolvedValue(engine);
    mocks.createAgentModel.mockImplementation(() => {
      throw new Error("缺少 API Key（请在模型设置中配置）");
    });

    const response = await POST(request({ message: "你好", sessionKey: "agent-1" }));
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(text).toContain("缺少 API Key");
    expect(engine.release).toHaveBeenCalled();
  });
});
