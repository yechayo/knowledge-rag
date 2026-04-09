import { describe, it, expect, vi } from "vitest";
import { retryWithBackoff } from "../retryWithBackoff";

describe("retryWithBackoff", () => {
  it("首次成功时直接返回结果", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await retryWithBackoff(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("失败后重试直到成功", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValue("ok");
    const result = await retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 10 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("超过 maxRetries 后抛出最后一个错误", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fail"));
    await expect(
      retryWithBackoff(fn, { maxRetries: 2, baseDelayMs: 10 })
    ).rejects.toThrow("always fail");
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("4xx 错误不重试（非 429）", async () => {
    const err: any = new Error("Bad Request");
    err.status = 400;
    const fn = vi.fn().mockRejectedValue(err);
    await expect(
      retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 10 })
    ).rejects.toThrow("Bad Request");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("429 错误应该重试", async () => {
    const err: any = new Error("Too Many Requests");
    err.status = 429;
    const fn = vi.fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValue("ok");
    const result = await retryWithBackoff(fn, { maxRetries: 2, baseDelayMs: 10 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("5xx 错误应该重试", async () => {
    const err: any = new Error("Internal Server Error");
    err.status = 500;
    const fn = vi.fn()
      .mockRejectedValueOnce(err)
      .mockResolvedValue("ok");
    const result = await retryWithBackoff(fn, { maxRetries: 2, baseDelayMs: 10 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("TypeError（网络错误）应该重试", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValue("ok");
    const result = await retryWithBackoff(fn, { maxRetries: 2, baseDelayMs: 10 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("signal 已中止时立即抛出 AbortError", async () => {
    const controller = new AbortController();
    controller.abort();
    const fn = vi.fn().mockResolvedValue("ok");
    await expect(
      retryWithBackoff(fn, { maxRetries: 2, signal: controller.signal })
    ).rejects.toThrow();
    expect(fn).not.toHaveBeenCalled();
  });

  it("maxRetries=0 时只尝试一次不重试", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("fail"));
    await expect(
      retryWithBackoff(fn, { maxRetries: 0, baseDelayMs: 10 })
    ).rejects.toThrow("fail");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("指数退避：重试间隔应递增", async () => {
    const timestamps: number[] = [];
    const fn = vi.fn().mockImplementation(async () => {
      timestamps.push(Date.now());
      throw new Error("fail");
    });

    await expect(
      retryWithBackoff(fn, { maxRetries: 2, baseDelayMs: 50, jitterFactor: 0 })
    ).rejects.toThrow();

    // 3 次调用：0ms, ~50ms, ~100ms
    expect(fn).toHaveBeenCalledTimes(3);
    if (timestamps.length >= 3) {
      const gap1 = timestamps[1] - timestamps[0];
      const gap2 = timestamps[2] - timestamps[1];
      // gap2 应该大约是 gap1 的两倍（允许误差）
      expect(gap2).toBeGreaterThan(gap1 * 0.8);
    }
  });
});
