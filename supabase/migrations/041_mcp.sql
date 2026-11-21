-- 041: Well MCP idempotency (docs/PRD.md §3.0, milestone M9). One row per (company, idempotency key) for 24 hours: a retried write with the
-- same key gets the first answer back instead of running twice; the same key with different arguments is refused.
-- The server writes it with the service key only. Expired rows are ignored by the code and can be deleted at any time.
create table if not exists public.mcp_idempotency (
  company_id uuid not null references public.companies (id),
  key text not null check (key ~ '^[A-Za-z0-9_.:-]{8,128}$'),
  tool text not null check (tool ~ '^[a-z0-9_.]{3,80}$'),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  response jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (company_id, key)
);
create index if not exists mcp_idempotency_expires_idx on public.mcp_idempotency (expires_at);
alter table public.mcp_idempotency enable row level security;
revoke all on public.mcp_idempotency from anon, authenticated;

insert into public.schema_migrations (name) values ('041_mcp.sql') on conflict do nothing;
