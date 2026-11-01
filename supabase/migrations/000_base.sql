-- Well ads dashboard
-- Run once in the Supabase SQL editor after creating the project.
-- GitHub Actions uses the service role key, which bypasses RLS.
-- The anon and authenticated roles can only read. There is no write policy.

create table if not exists public.ads (
  ad_key text primary key,
  platform text not null default '',
  name text not null default '',
  campaign text not null default '',
  ad_group text not null default '',
  format text not null default '',
  status text not null default '',
  live boolean not null default false,
  goal text not null default '',
  preview_url text,
  video text,
  link text,
  doc jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.ad_metrics (
  ad_key text not null references public.ads (ad_key) on delete cascade,
  day date not null,
  spend numeric not null default 0,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  leads numeric not null default 0,
  conversations bigint not null default 0,
  primary key (ad_key, day)
);

create index if not exists ad_metrics_day_idx on public.ad_metrics (day);
create index if not exists ads_platform_idx on public.ads (platform);

create table if not exists public.dashboard_state (
  id int primary key,
  doc jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.ads enable row level security;
alter table public.ad_metrics enable row level security;
alter table public.dashboard_state enable row level security;

drop policy if exists ads_read on public.ads;
drop policy if exists ad_metrics_read on public.ad_metrics;
drop policy if exists dashboard_state_read on public.dashboard_state;

create policy ads_read on public.ads
  for select to anon, authenticated
  using (true);

create policy ad_metrics_read on public.ad_metrics
  for select to anon, authenticated
  using (true);

create policy dashboard_state_read on public.dashboard_state
  for select to anon, authenticated
  using (true);

revoke insert, update, delete on public.ads from anon, authenticated;
revoke insert, update, delete on public.ad_metrics from anon, authenticated;
revoke insert, update, delete on public.dashboard_state from anon, authenticated;

grant select on public.ads to anon, authenticated;
grant select on public.ad_metrics to anon, authenticated;
grant select on public.dashboard_state to anon, authenticated;
