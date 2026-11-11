-- 031: a record of which migrations were applied (system review 6.2). Until now they were run by hand in the SQL editor and
-- nothing said which; the code could deploy before its migration. From this file on, every migration ends with
--   insert into public.schema_migrations (name) values ('<its own file name>') on conflict do nothing;
-- and /api/health lists the tracked files that have no row (src/lib/health.ts). Files up to 030 predate the table:
-- docs/migrations.md has the one-time statement to record the ones that are applied.
create table if not exists public.schema_migrations (
  name text primary key,
  applied_at timestamptz not null default now()
);
alter table public.schema_migrations enable row level security;
revoke all on public.schema_migrations from anon, authenticated;

insert into public.schema_migrations (name) values ('031_schema_migrations.sql') on conflict do nothing;
