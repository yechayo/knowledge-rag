import { describe, it, expect, vi } from "vitest";
import { LoopGuard, LoopGuardError, LoopDetectedError } from "../loopGuard";
import { truncateToolResult, DEFAULT_RESOURCE_LIMITS } from "../resourceLimit";

/**
 * 模拟 wrapToolsWithGuard 的核心逻辑进行集成测试
 * 不直接导入 route.ts 中的函数（因为依赖 Next.js 运行时）
 */
function wrapToolsWithGuard(tools: any[], guard: LoopGuard, limits: { maxResultChars: number }): any[] {
  return tools.map((originalTool) => {
    const originalInvoke = originalTool.invoke.bind(originalTool);
    const guardedInvoke = async (input: any) => {
      const toolName = originalTool.name;
      let args: Record<string, unknown>;
      if (input && typeof input === "object" && input.type === "tool_call") {
        args = input.args || {};
      } else if (typeof input === "string") {
        try { args = JSON.parse(input); } catch { args = { input }; }
      } else {
        args = input;
      }

      try { guard.check(toolName, args); } catch (err) {
        if (err instanceof LoopGuardError) return err.message;
        throw err;
      }

      let result: any;
      try { result = await originalInvoke(input); } catch (err) {
        result = err instanceof Error ? err.message : String(err);
      }
      const resultStr = typeof result === "string" ? result : JSON.stringify(result);
      return truncateToolResult(resultStr, limits.maxResultChars);
    };

    return { ...originalTool, invoke: guardedInvoke };
  });
}

// 创建模拟工具
function createMockTool(name: string, impl?: (args: any) => any) {
  return {
    name,
    description: `Mock ${name}`,
    invoke: vi.fn(async (input: any) => {
      if (impl) return impl(input);
      return `${name} result`;
    }),
  };
}

describe("wrapToolsWithGuard 集成测试", () => {
  it("正常调用应返回工具结果", async () => {
    const guard = new LoopGuard();
    const tools = [createMockTool("search")];
    const wrapped = wrapToolsWithGuard(tools, guard, DEFAULT_RESOURCE_LIMITS);

    const result = await wrapped[0].invoke({ query: "test" });
    expect(result).toBe("search result");
  });

  it("连续相同调用应返回守卫错误信息而非工具结果", async () => {
    const guard = new LoopGuard();
    const tools = [createMockTool("search")];
    const wrapped = wrapToolsWithGuard(tools, guard, DEFAULT_RESOURCE_LIMITS);

    await wrapped[0].invoke({ query: "AI" });
    const result = await wrapped[0].invoke({ query: "AI" });
    expect(result).toContain("连续重复调用");
    // 原始工具不应被第2次调用（守卫拦截了）
    expect(tools[0].invoke).toHaveBeenCalledTimes(1);
  });

  it("超长结果应被截断", async () => {
    const guard = new LoopGuard();
    const tools = [createMockTool("big_data", () => "x".repeat(20000))];
    const wrapped = wrapToolsWithGuard(tools, guard, DEFAULT_RESOURCE_LIMITS);

    const result = await wrapped[0].invoke({});
    expect(result.length).toBeLessThan(20000);
    expect(result).toContain("结果已截断");
  });

  it("ToolCall 格式参数应被正确解析", async () => {
    const guard = new LoopGuard();
    const tools = [createMockTool("search")];
    const wrapped = wrapToolsWithGuard(tools, guard, DEFAULT_RESOURCE_LIMITS);

    // 模拟 LangGraph ToolNode 传入的 ToolCall 格式
    const result = await wrapped[0].invoke({
      type: "tool_call",
      name: "search",
      args: { query: "test" },
      id: "call_123",
    });
    expect(result).toBe("search result");
  });

  it("字符串参数应被正确解析", async () => {
    const guard = new LoopGuard();
    const tools = [createMockTool("search")];
    const wrapped = wrapToolsWithGuard(tools, guard, DEFAULT_RESOURCE_LIMITS);

    const result = await wrapped[0].invoke('{"query":"test"}');
    expect(result).toBe("search result");
  });

  it("工具抛出错误时应返回错误信息（不崩溃）", async () => {
    const guard = new LoopGuard();
    const tools = [createMockTool("fail_tool", () => { throw new Error("DB error"); })];
    const wrapped = wrapToolsWithGuard(tools, guard, DEFAULT_RESOURCE_LIMITS);

    const result = await wrapped[0].invoke({});
    expect(result).toBe("DB error");
  });

  it("单工具超过5次应返回限制错误", async () => {
    const guard = new LoopGuard();
    const tools = [createMockTool("search")];
    const wrapped = wrapToolsWithGuard(tools, guard, DEFAULT_RESOURCE_LIMITS);

    // 调用5次正常
    for (let i = 0; i < 5; i++) {
      await wrapped[0].invoke({ query: `q${i}` });
    }
    // 第6次被拦截
    const result = await wrapped[0].invoke({ query: "overflow" });
    expect(result).toContain("达到上限");
  });

  it("总调用超过12次应返回限制错误", async () => {
    const guard = new LoopGuard();
    const tools = [
      createMockTool("tool_a"),
      createMockTool("tool_b"),
      createMockTool("tool_c"),
    ];
    const wrapped = wrapToolsWithGuard(tools, guard, DEFAULT_RESOURCE_LIMITS);

    // 总共12次调用（每个工具4次）
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 3; j++) {
        await wrapped[j].invoke({ i });
      }
    }
    // 第13次被拦截
    const result = await wrapped[0].invoke({ i: 13 });
    expect(result).toContain("达到总上限");
  });
});
