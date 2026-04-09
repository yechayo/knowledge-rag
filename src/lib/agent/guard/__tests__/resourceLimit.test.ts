import { describe, it, expect } from "vitest";
import { truncateToolResult, DEFAULT_RESOURCE_LIMITS } from "../resourceLimit";

describe("truncateToolResult", () => {
  it("短结果不应被截断", () => {
    const short = "这是一段短文本";
    expect(truncateToolResult(short)).toBe(short);
  });

  it("恰好等于上限的结果不应被截断", () => {
    const exact = "a".repeat(DEFAULT_RESOURCE_LIMITS.maxResultChars);
    expect(truncateToolResult(exact)).toBe(exact);
  });

  it("超过上限的结果应被截断并追加提示", () => {
    const long = "a".repeat(DEFAULT_RESOURCE_LIMITS.maxResultChars + 100);
    const result = truncateToolResult(long);
    expect(result.length).toBeLessThan(long.length);
    expect(result).toContain("结果已截断");
    expect(result).toContain(String(long.length));
  });

  it("截断后结果长度等于 maxChars + 提示文本", () => {
    const long = "x".repeat(15000);
    const result = truncateToolResult(long, 10000);
    expect(result.startsWith("x".repeat(10000))).toBe(true);
    expect(result).toContain("15000");
  });

  it("非字符串输入应被 JSON.stringify", () => {
    const obj = { key: "value" };
    const result = truncateToolResult(obj as any);
    expect(result).toBe('{"key":"value"}');
  });

  it("自定义 maxChars 参数生效", () => {
    const text = "a".repeat(200);
    const result = truncateToolResult(text, 100);
    expect(result.length).toBeLessThan(200);
    expect(result).toContain("200");
  });

  it("空字符串不应被截断", () => {
    expect(truncateToolResult("")).toBe("");
  });
});

describe("DEFAULT_RESOURCE_LIMITS", () => {
  it("默认 maxResultChars 为 10000", () => {
    expect(DEFAULT_RESOURCE_LIMITS.maxResultChars).toBe(10_000);
  });
});
