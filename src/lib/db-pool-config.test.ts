import { describe, expect, test } from "vitest";

import { buildPgPoolConfig } from "./db-pool-config";

describe("buildPgPoolConfig", () => {
  test("limits Vercel runtime pools to one connection by default", () => {
    const config = buildPgPoolConfig("postgresql://example", { VERCEL: "1" });

    expect(config).toMatchObject({
      connectionString: "postgresql://example",
      max: 1,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 5_000,
      allowExitOnIdle: true,
    });
  });

  test("keeps a larger local pool default outside Vercel", () => {
    const config = buildPgPoolConfig("postgresql://example", {});

    expect(config.max).toBe(10);
  });

  test("allows DB_POOL_MAX to override the default", () => {
    const config = buildPgPoolConfig("postgresql://example", {
      VERCEL: "1",
      DB_POOL_MAX: "2",
    });

    expect(config.max).toBe(2);
  });

  test("rejects invalid pool limits", () => {
    expect(() =>
      buildPgPoolConfig("postgresql://example", {
        DB_POOL_MAX: "0",
      }),
    ).toThrow(/positive integer/);
  });
});
