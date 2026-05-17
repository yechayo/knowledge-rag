import type { PoolConfig } from "pg";

const DEFAULT_LOCAL_POOL_MAX = 10;
const DEFAULT_VERCEL_POOL_MAX = 1;

export function buildPgPoolConfig(
  connectionString: string,
  env: Record<string, string | undefined> = process.env,
): PoolConfig {
  return {
    connectionString,
    max: getPoolMax(env),
    connectionTimeoutMillis: getPositiveInteger(env.DB_CONNECTION_TIMEOUT_MS, 10_000),
    idleTimeoutMillis: getPositiveInteger(env.DB_IDLE_TIMEOUT_MS, 5_000),
    allowExitOnIdle: true,
  };
}

function getPoolMax(env: Record<string, string | undefined>): number {
  if (env.DB_POOL_MAX) {
    return getPositiveInteger(env.DB_POOL_MAX, 1);
  }

  return env.VERCEL ? DEFAULT_VERCEL_POOL_MAX : DEFAULT_LOCAL_POOL_MAX;
}

function getPositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Expected a positive integer, received "${value}".`);
  }

  return parsed;
}
