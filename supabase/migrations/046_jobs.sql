-- 046: background jobs of the Well MCP (docs/PRD.md §3.0, milestone M17). A heavy tool (a report over a long period) answers at once
-- with a job id; the 5-minute cron runs the job and stores the result here; jobs.get reads it back. Per company, kept 30 days.
create table if not exists public.mcp_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  kind text not null check (kind ~ '^[a-z_]{2,30}\.[a-z_]{2,30}$'),
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  input jsonb not null default '{}',
  result jsonb,
  error text check (error is null or error ~ '^[a-z0-9_]{1,40}$'),
  actor text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists mcp_jobs_queue_idx on public.mcp_jobs (created_at) where status = 'queued';
create index if not exists mcp_jobs_company_idx on public.mcp_jobs (company_id, created_at desc);
alter table public.mcp_jobs enable row level security;
revoke all on public.mcp_jobs from anon, authenticated;

insert into public.schema_migrations (name) values ('046_jobs.sql') on conflict do nothing;
