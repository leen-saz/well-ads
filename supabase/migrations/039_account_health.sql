-- 039: صحة الحسابات المربوطة ومجموعاتها (docs/PRD.md §3.4، المرحلة M5).
-- account_health: نتيجة آخر فحص لكل حساب مربوط، منفصلة عن الربط نفسه (connections). أول فشل = degraded مع مهلة ساعة
-- (grace_until)، وفشل بعد المهلة = disconnected وتنبيه واحد. لا مفاتيح ولا نص رسائل المنصات: رمز قصير فقط (error_code).
-- account_groups / account_group_members: تجميع حسابات (مثلاً قسم بصفحاته) لاختيارها مرة وحدة.
-- كل جدول فيه company_id، ومقفل على المتصفح: السيرفر بس.

create table if not exists public.account_health (
  company_id uuid not null references public.companies (id),
  platform text not null check (platform ~ '^[a-z0-9_]{1,40}$'),
  account_ref text not null default '' check (length(account_ref) <= 120),
  status text not null check (status in ('ok', 'degraded', 'expiring', 'disconnected')),
  probed boolean not null default false,
  last_check_at timestamptz,
  first_failed_at timestamptz,
  grace_until timestamptz,
  error_code text check (error_code is null or error_code ~ '^[a-z0-9_]{1,40}$'),
  expires_at timestamptz,
  alerted_status text,
  updated_at timestamptz not null default now(),
  primary key (company_id, platform, account_ref)
);
create index if not exists account_health_grace_idx on public.account_health (grace_until) where status = 'degraded';
alter table public.account_health enable row level security;
revoke all on public.account_health from anon, authenticated;

create table if not exists public.account_groups (
  id bigserial primary key,
  company_id uuid not null references public.companies (id),
  name text not null check (length(name) between 1 and 60),
  created_by text,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);
alter table public.account_groups enable row level security;
revoke all on public.account_groups from anon, authenticated;

create table if not exists public.account_group_members (
  group_id bigint not null references public.account_groups (id) on delete cascade,
  company_id uuid not null references public.companies (id),
  platform text not null check (platform ~ '^[a-z0-9_]{1,40}$'),
  account_ref text not null default '' check (length(account_ref) <= 120),
  primary key (group_id, platform, account_ref)
);
create index if not exists account_group_members_company_idx on public.account_group_members (company_id);
alter table public.account_group_members enable row level security;
revoke all on public.account_group_members from anon, authenticated;

insert into public.schema_migrations (name) values ('039_account_health.sql') on conflict do nothing;
