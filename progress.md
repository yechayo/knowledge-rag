# Progress

## 2026-05-11

- Reviewed project database configuration and found the active project under `knowledge-rag`.
- Confirmed current database code reads `DATABASE_URL`.
- Confirmed pgvector is required.
- Confirmed PostgreSQL CLI migration tools are not installed locally.
- User chose the data-preserving migration path.
- Started creating a local Node/pg migration utility that avoids committing secrets.
- Corrected misplaced planning/test files so they live inside the project directory.
- Added `scripts/migrate-supabase-data.ts`, helper tests, an npm script, and migration docs.
- `pnpm vitest run scripts/migrate-supabase-data.test.ts` passed.
- `pnpm exec tsc --noEmit` found one introduced env typing issue and unrelated existing errors in `src/lib/langchain/__tests__/llm.test.ts`.
- Updated the migration script so it prepares the target schema by enabling `vector` and running `prisma db push` against the target URL before copying rows.
- Found that `npx tsx` was not available locally and could hang; converted the migration runner to plain Node ESM (`.mjs`) so no extra runtime dependency is needed.

- Target direct host connection probe failed with DNS ENOTFOUND for db.fwnmohcptedgefzsumyc.supabase.co; need Session Pooler details or corrected direct host before actual copy can run.
- Final verification: migration helper tests passed; eslint passed for migration script/test; DNS A lookup returned no IPv4 address while AAAA returned IPv6 only. Actual data copy has not run.
- User provided Supabase Session Pooler URL; target connection probe succeeded.
- Actual migration attempt reached target but failed connecting to source Aliyun RDS: `pg_hba.conf rejects connection for host "183.227.156.5", user "yechayo", database "postgres", no encryption`.
- Source SSL probes also failed with `The server does not support SSL connections`, so this is a source access/allowlist issue rather than a target Supabase issue.
- User changed direction: do not keep old data; initialize a fresh Supabase database instead.
- Removed the data-copy migration script/test/docs and reverted the package/vitest changes that only supported that tool.
- Enabled `vector` extension on the new Supabase database.
- Ran `pnpm prisma db push` against the new Supabase Session Pooler connection successfully.
- Verified 16 public tables exist and `Chunk.embedding` uses the `vector` type.
- Updated local `.env` database URLs to the Supabase Session Pooler.
- Verified the app `.env` connects to Supabase as `postgres`.
- Ran `pnpm prisma db seed`; it created admin `2628505364@qq.com` and default site categories.
- Verified fresh row counts: `Admin=1`, `SiteConfig=1`, `Content=0`, `Chunk=0`.
- Ran `pnpm prisma generate` successfully.
- Ran `pnpm exec tsc --noEmit`; it still fails only on the pre-existing `src/lib/langchain/__tests__/llm.test.ts:45` type issue.
- Added `.vercelignore` to keep local env, Vercel cache, build output, planning files, uploads, and the password-named docs file out of deployment uploads.
- Synced production Vercel environment variables from local `.env`, then set production `NEXTAUTH_URL` to `https://knowledge-rag.vercel.app`.
- Ran `vercel pull --yes --environment production`.
- Ran `vercel build --prod --yes`; Next compiled successfully, but local Vercel packaging on Windows failed with `Unable to find lambda for route: /admin/chat`.
- Cloud production deploy succeeded as `dpl_9WQCxfr5qWif9Kj2WySf5Z5hJdXw`, proving the local Windows packaging error was not a cloud build blocker.
- Online `/api/config` initially returned 500. Vercel logs showed Prisma `P1010`, and production env probing showed Supabase Session Pooler had reached `pool_size: 15`.
- Added `src/lib/db-pool-config.ts` and test coverage to limit Vercel pg pools to `max=1`, while keeping local default at `max=10`.
- Set Vercel production `DB_POOL_MAX=1`.
- Verified `pnpm vitest run src/lib/db-pool-config.test.ts`, `pnpm exec eslint src/lib/db-pool-config.ts src/lib/db-pool-config.test.ts src/lib/prisma.ts`, and `pnpm build` all passed.
- Redeployed production as `dpl_58TsEMkYBnjC5sEKEanWkHmVvnYn`, aliased to `https://knowledge-rag-xi.vercel.app`.
- Verified production home, login, and `/api/config` return HTTP 200; recent production 500 logs showed no entries after the final deploy.
