-- 043: outbound events and webhooks (docs/PRD.md §3.0 and §3.8, milestone M11). An event is a fact Well already recorded
-- (a post went out, an ad change was applied, an account disconnected). Each company's webhooks get a signed copy of the
-- event types they asked for. Each webhook's signing secret lives in that company's Token Vault, never in these tables.
create table if not exists public.mcp_events (
  id bigserial primary key,
  company_id uuid not null references public.companies (id),
  type text not null check (type ~ '^[a-z_]{2,30}\.[a-z_]{2,30}$'),
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists mcp_events_company_idx on public.mcp_events (company_id, created_at desc);
alter table public.mcp_events enable row level security;
revoke all on public.mcp_events from anon, authenticated;

create table if not exists public.webhooks (
  id bigserial primary key,
  company_id uuid not null references public.companies (id),
  url text not null check (url ~ '^https://' and length(url) <= 500),
  types text[] not null check (cardinality(types) between 1 and 20),
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists webhooks_company_idx on public.webhooks (company_id);
alter table public.webhooks enable row level security;
revoke all on public.webhooks from anon, authenticated;

create table if not exists public.webhook_deliveries (
  id bigserial primary key,
  company_id uuid not null references public.companies (id),
  webhook_id bigint not null references public.webhooks (id) on delete cascade,
  event_id bigint not null references public.mcp_events (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  attempts int not null default 0,
  next_at timestamptz not null default now(),
  last_code int,
  delivered_at timestamptz,
  unique (webhook_id, event_id)
);
create index if not exists webhook_deliveries_due_idx on public.webhook_deliveries (next_at) where status = 'pending';
create index if not exists webhook_deliveries_event_idx on public.webhook_deliveries (event_id);
create index if not exists webhook_deliveries_company_idx on public.webhook_deliveries (company_id);
alter table public.webhook_deliveries enable row level security;
revoke all on public.webhook_deliveries from anon, authenticated;

-- One delivery per active webhook of the company that asked for the type, queued by the database when the event is stored:
-- the Worker spends one request per event (the 5-minute cron shares 50 subrequests)
create or replace function public.mcp_events_queue() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.webhook_deliveries (company_id, webhook_id, event_id)
  select new.company_id, w.id, new.id from public.webhooks w
  where w.company_id = new.company_id and w.active and new.type = any (w.types)
  on conflict (webhook_id, event_id) do nothing;
  return new;
end $$;
revoke all on function public.mcp_events_queue() from public, anon, authenticated;
drop trigger if exists mcp_events_queue on public.mcp_events;
create trigger mcp_events_queue after insert on public.mcp_events for each row execute function public.mcp_events_queue();

insert into public.schema_migrations (name) values ('043_events.sql') on conflict do nothing;
