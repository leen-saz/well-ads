-- 045: the campaigns «تلقائي» may touch (docs/PRD.md §3.6, milestone M13). Auto mode acts only on an entity the owner put on this
-- list herself; anything else stays an approval request. The on/off switches and caps live in control_settings (global.auto).
create table if not exists public.managed_campaigns (
  company_id uuid not null references public.companies (id),
  platform text not null check (platform in ('meta', 'snapchat')),
  level text not null default 'campaign' check (level in ('campaign', 'adset')),
  entity_id text not null check (entity_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  name text check (name is null or length(name) <= 200),
  added_by text,
  created_at timestamptz not null default now(),
  primary key (company_id, platform, entity_id)
);
alter table public.managed_campaigns enable row level security;
revoke all on public.managed_campaigns from anon, authenticated;

insert into public.schema_migrations (name) values ('045_automation.sql') on conflict do nothing;
