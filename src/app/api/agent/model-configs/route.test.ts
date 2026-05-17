import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  prisma: {
    agentModelConfig: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));

import { GET, POST } from "./route";

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/agent/model-configs", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("/api/agent/model-configs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({ user: { isAdmin: true } });
  });

  it("masks API keys when listing configs", async () => {
    mocks.prisma.agentModelConfig.findMany.mockResolvedValue([{
      id: "cfg-1",
      name: "DeepSeek",
      modelName: "deepseek-v4-flash",
      baseURL: "https://api.deepseek.com",
      apiKey: "sk-1234567890abcdef",
      isDefault: false,
      createdAt: new Date("2026-05-17T00:00:00.000Z"),
      updatedAt: new Date("2026-05-17T00:00:00.000Z"),
    }]);

    const response = await GET();
    const data = await response.json();

    expect(data.configs).toEqual([expect.objectContaining({
      id: "cfg-1",
      hasApiKey: true,
      apiKeyPreview: "sk-1...cdef",
    })]);
    expect(JSON.stringify(data)).not.toContain("sk-1234567890abcdef");
  });

  it("creates model configs for admins", async () => {
    mocks.prisma.agentModelConfig.create.mockResolvedValue({
      id: "cfg-1",
      name: "DeepSeek",
      modelName: "deepseek-v4-flash",
      baseURL: "https://api.deepseek.com",
      apiKey: "sk-test",
      isDefault: false,
      createdAt: new Date("2026-05-17T00:00:00.000Z"),
      updatedAt: new Date("2026-05-17T00:00:00.000Z"),
    });

    const response = await POST(request({
      name: "DeepSeek",
      modelName: "deepseek-v4-flash",
      baseURL: "https://api.deepseek.com",
      apiKey: "sk-test",
    }));
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(mocks.prisma.agentModelConfig.create).toHaveBeenCalledWith({
      data: {
        name: "DeepSeek",
        modelName: "deepseek-v4-flash",
        baseURL: "https://api.deepseek.com",
        apiKey: "sk-test",
        isDefault: false,
      },
    });
    expect(JSON.stringify(data)).not.toContain("sk-test");
  });

  it("rejects non-admin users", async () => {
    mocks.getServerSession.mockResolvedValue({ user: { isAdmin: false } });

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.prisma.agentModelConfig.findMany).not.toHaveBeenCalled();
  });
});
