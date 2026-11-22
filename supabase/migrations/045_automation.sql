-- 045: campaigns «تلقائي» must leave alone (docs/PRD.md §3.6, milestone M13). Leen, 2026-11-22: the optimizing agent works on every
-- campaign of the connected ad accounts; the owner may exclude some here. Every guard still applies (caps, spend cap, emergency stop).
-- The on/off switches and caps live in control_settings (global.auto).
create table if not exists public.auto_exclusions (
  company_id uuid not null references public.companies (id),
  platform text not null check (platform in ('meta', 'snapchat')),
  entity_id text not null check (entity_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  name text check (name is null or length(name) <= 200),
  added_by text,
  created_at timestamptz not null default now(),
  primary key (company_id, platform, entity_id)
);
alter table public.auto_exclusions enable row level security;
revoke all on public.auto_exclusions from anon, authenticated;

insert into public.schema_migrations (name) values ('045_automation.sql') on conflict do nothing;
