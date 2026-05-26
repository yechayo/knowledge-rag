# Supabase Data Migration Plan

Goal: switch the project to a fresh Supabase database without preserving old Aliyun RDS data.

## Phases

1. Context review - complete
2. Migration approach design - complete
3. Remove data-copy migration tooling - complete
4. Initialize fresh Supabase schema - complete
5. Switch local env to Supabase - complete
6. Verify database connection and schema - complete
7. Prepare Vercel production deploy - complete

## Decisions

- Do not preserve existing data.
- Do not write database passwords or full connection strings into committed files.
- Use Supabase Session Pooler because the direct host is IPv6-only from this network.
- Initialize the target with `CREATE EXTENSION IF NOT EXISTS vector` and `prisma db push`.

## Errors Encountered

| Error | Attempt | Resolution |
| --- | --- | --- |
| Root directory is not a git repo | `git status` from workspace root | Use `knowledge-rag` subdirectory as project root |
| `pg_dump`, `pg_restore`, and `psql` not found locally | command lookup | Implement migration using existing Node `pg` dependency |
| Initial planning/test files were created in workspace root | `apply_patch` without project-relative paths | Move files into `knowledge-rag` and delete the misplaced copies |
| New Supabase direct host is not reachable from this machine | Node `pg` probe and DNS lookup | Direct host only returned IPv6 AAAA; use Supabase Session Pooler connection string, IPv6 network, or IPv4 add-on |
| Old Aliyun RDS source rejects this machine | Migration run and source-only probes | Source returned `pg_hba.conf rejects connection for host "183.227.156.5"`; add this IP to source DB allowlist or provide another reachable source connection |
| Local `vercel build --prod` failed after Next compile | Vercel output packaging on Windows | Error was `Unable to find lambda for route: /admin/chat`; use cloud production deploy to determine whether this is local packaging or cloud build behavior |
| Production API returned Prisma P1010 after initial deploy | Vercel logs and production env probe | Supabase session pooler hit max clients; added bounded pg pool config and production `DB_POOL_MAX=1`, then redeployed |
