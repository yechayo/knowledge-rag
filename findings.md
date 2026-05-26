# Findings

- The application project is `knowledge-rag`.
- Database access is centralized through `DATABASE_URL` in Prisma config, `src/lib/prisma.ts`, seed scripts, reindex scripts, and utility scripts.
- `.env.example` also mentions `DIRECT_URL`, but Prisma config currently uses only `DATABASE_URL`.
- `schema.prisma` includes `Unsupported("vector")`, so the target Supabase database needs the `vector` extension.
- Current Prisma migrations are not sufficient to reconstruct the full current schema by themselves.
- The local machine does not have PostgreSQL CLI tools (`pg_dump`, `pg_restore`, `psql`) on PATH.
- The new Supabase direct database host was provided as `db.fwnmohcptedgefzsumyc.supabase.co:5432`; the source note says direct connection is not IPv4 compatible, so a session pooler may be needed on IPv4-only networks.
