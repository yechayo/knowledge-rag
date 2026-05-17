import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  prisma: {
    agentModelConfig: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));

import { DELETE, PATCH } from "./route";

const params = { params: Promise.resolve({ id: "cfg-1" }) };

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/agent/model-configs/cfg-1", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

describe("/api/agent/model-configs/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({ user: { isAdmin: true } });
  });

  it("preserves existing API key when patch omits apiKey", async () => {
    mocks.prisma.agentModelConfig.findUnique.mockResolvedValue({
      id: "cfg-1",
      apiKey: "sk-existing",
    });
    mocks.prisma.agentModelConfig.update.mockResolvedValue({
      id: "cfg-1",
      name: "DeepSeek Fast",
      modelName: "deepseek-v4-flash",
      baseURL: "https://api.deepseek.com",
      apiKey: "sk-existing",
      isDefault: false,
      createdAt: new Date("2026-05-17T00:00:00.000Z"),
      updatedAt: new Date("2026-05-17T00:00:00.000Z"),
    });

    const response = await PATCH(request({ name: "DeepSeek Fast" }), params);
    const data = await response.json();

    expect(mocks.prisma.agentModelConfig.update).toHaveBeenCalledWith({
      where: { id: "cfg-1" },
      data: { name: "DeepSeek Fast" },
    });
    expect(JSON.stringify(data)).not.toContain("sk-existing");
  });

  it("deletes model configs for admins", async () => {
    const response = await DELETE(new Request("http://localhost/api/agent/model-configs/cfg-1"), params);

    expect(response.status).toBe(200);
    expect(mocks.prisma.agentModelConfig.delete).toHaveBeenCalledWith({ where: { id: "cfg-1" } });
  });
});
