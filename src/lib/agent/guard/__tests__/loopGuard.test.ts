import { describe, it, expect, beforeEach } from "vitest";
import {
  LoopGuard,
  LoopDetectedError,
  ToolCallLimitError,
  TotalToolLimitError,
} from "../loopGuard";

describe("LoopGuard", () => {
  let guard: LoopGuard;

  beforeEach(() => {
    guard = new LoopGuard();
  });

  describe("正常调用", () => {
    it("允许首次工具调用", () => {
      expect(() => guard.check("tool_a", { query: "test" })).not.toThrow();
    });

    it("允许不同工具交替调用", () => {
      guard.check("tool_a", { q: "1" });
      guard.check("tool_b", { q: "2" });
      guard.check("tool_a", { q: "3" });
      expect(() => guard.check("tool_c", { q: "4" })).not.toThrow();
    });

    it("允许同一工具不同参数调用", () => {
      guard.check("search", { query: "AI" });
      expect(() => guard.check("search", { query: "区块链" })).not.toThrow();
    });
  });

  describe("连续相同调用检测", () => {
    it("连续2次相同调用应抛出 LoopDetectedError", () => {
      guard.check("search", { query: "AI" });
      expect(() => guard.check("search", { query: "AI" })).toThrow(LoopDetectedError);
    });

    it("LoopDetectedError 应包含工具名", () => {
      guard.check("search", { query: "AI" });
      try {
        guard.check("search", { query: "AI" });
      } catch (err) {
        expect(err).toBeInstanceOf(LoopDetectedError);
        expect((err as LoopDetectedError).toolName).toBe("search");
      }
    });

    it("中间插入不同调用应重置连续计数", () => {
      guard.check("search", { query: "AI" });
      guard.check("list", {}); // 不同调用，重置
      expect(() => guard.check("search", { query: "AI" })).not.toThrow();
    });
  });

  describe("单工具调用上限", () => {
    it("同一工具调用超过5次应抛出 ToolCallLimitError", () => {
      for (let i = 0; i < 5; i++) {
        guard.check("search", { query: `query_${i}` });
      }
      expect(() => guard.check("search", { query: "overflow" })).toThrow(ToolCallLimitError);
    });

    it("不同工具各自独立计数", () => {
      for (let i = 0; i < 5; i++) {
        guard.check("tool_a", { i });
      }
      // tool_a 已到上限，但 tool_b 应该正常
      expect(() => guard.check("tool_b", {})).not.toThrow();
    });

    it("ToolCallLimitError 应包含工具名和次数", () => {
      for (let i = 0; i < 5; i++) guard.check("search", { i });
      try {
        guard.check("search", { i: 6 });
      } catch (err) {
        expect(err).toBeInstanceOf(ToolCallLimitError);
        expect((err as ToolCallLimitError).toolName).toBe("search");
        expect((err as ToolCallLimitError).count).toBe(6);
      }
    });
  });

  describe("总调用上限", () => {
    it("总调用超过12次应抛出 TotalToolLimitError", () => {
      for (let i = 0; i < 12; i++) {
        guard.check(`tool_${i % 3}`, { i });
      }
      expect(() => guard.check("tool_0", { i: 13 })).toThrow(TotalToolLimitError);
    });
  });

  describe("reset()", () => {
    it("重置后所有计数器归零", () => {
      guard.check("search", { q: "test" });
      guard.check("search", { q: "test2" });
      guard.reset();
      // 重置后应能再次调用
      expect(() => guard.check("search", { q: "test" })).not.toThrow();
    });
  });

  describe("getStatus()", () => {
    it("返回正确的调用统计", () => {
      guard.check("search", { q: "1" });
      guard.check("search", { q: "2" });
      guard.check("list", {});
      const status = guard.getStatus();
      expect(status.totalCalls).toBe(3);
      expect(status.perTool.search).toBe(2);
      expect(status.perTool.list).toBe(1);
    });
  });

  describe("自定义配置", () => {
    it("支持自定义 maxPerTool", () => {
      const customGuard = new LoopGuard({ maxPerTool: 2 });
      customGuard.check("search", { q: "1" });
      customGuard.check("search", { q: "2" });
      expect(() => customGuard.check("search", { q: "3" })).toThrow(ToolCallLimitError);
    });

    it("支持自定义 maxConsecutiveSame = 1", () => {
      const strictGuard = new LoopGuard({ maxConsecutiveSame: 1 });
      strictGuard.check("search", { q: "1" });
      // 第2次相同调用就触发
      expect(() => strictGuard.check("search", { q: "1" })).toThrow(LoopDetectedError);
    });
  });
});
