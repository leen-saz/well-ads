-- 008: الرحلات (بديل CleverTap). رحلة = خطوات: انتظر، واتساب، إيميل، إشعار. كل شركة رحلاتها.
-- التشغيل: Cloudflare Workflows (كل عميل داخل رحلة = instance تنام وتصحى بين الخطوات). ما نحتاج سيرفر دايم.
create table if not exists public.journeys (
  id bigserial primary key,
  company_id uuid not null references public.companies (id),
  name text not null,
  trigger text not null default 'manual' check (trigger in ('manual', 'lead_created')),
  steps jsonb not null default '[]',
  mode text not null default 'manual' check (mode in ('auto', 'manual')),
  active boolean not null default false,
  created_by text,
  created_at timestamptz not null default now()
);
create table if not exists public.journey_runs (
  id bigserial primary key,
  company_id uuid not null references public.companies (id),
  journey_id bigint not null references public.journeys (id) on delete cascade,
  contact jsonb not null,
  status text not null default 'running' check (status in ('running', 'done', 'failed', 'stopped')),
  log jsonb not null default '[]',
  started_by text,
  started_at timestamptz not null default now()
);
create index if not exists journeys_company_idx on public.journeys (company_id);
create index if not exists journey_runs_journey_idx on public.journey_runs (journey_id, started_at desc);
alter table public.journeys enable row level security;
alter table public.journey_runs enable row level security;
revoke all on public.journeys, public.journey_runs from anon, authenticated;
