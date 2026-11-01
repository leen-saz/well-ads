-- لوحة القرارات والدخول (المرحلة 1). يتشغّل مرة وحدة من Supabase > SQL Editor في مشروع WELL.
-- كل الجداول مقفلة على anon و authenticated. السيرفر (Vercel) يقرأ ويكتب بمفتاح service_role بس.

-- اليوزرز: لين تضيفهم وتختار لكل واحد اللوحات (ceo / creative / control)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  name text,
  role text not null default 'member' check (role in ('owner', 'member')),
  dashboards text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- سجل كل فعل: دخول، قرار، تعديل يوزر، تغيير وضع، وبعدين أي تعديل على حسابات الإعلانات.
-- ما ينعدّل ولا ينحذف. منه يتعلّم الإيجنت.
create table if not exists public.audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  user_id uuid,
  email text,
  action text not null,
  target jsonb,
  before jsonb,
  after jsonb,
  note text,
  result jsonb
);
create index if not exists audit_log_at_idx on public.audit_log (at desc);

-- اقتراحات كلود والقواعد، وقرار الميديا باير عليها
create table if not exists public.suggestions (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  platform text not null check (platform in ('meta', 'snap', 'tiktok', 'google')),
  level text not null check (level in ('campaign', 'adset', 'ad')),
  target_id text not null,
  target_name text,
  campaign text,
  kind text not null,              -- pause / budget_up / budget_down / refresh_creative / ...
  params jsonb not null default '{}',
  reason text not null,
  evidence jsonb not null default '{}',
  priority int not null default 0,
  source text not null default 'rule',   -- rule أو claude
  status text not null default 'open' check (status in ('open', 'approved', 'rejected', 'modified', 'executed', 'failed', 'expired')),
  note text,
  decided_by text,
  decided_at timestamptz,
  result jsonb
);
create index if not exists suggestions_open_idx on public.suggestions (status, platform);
-- اقتراح مفتوح واحد بس لنفس الهدف ونفس النوع
create unique index if not exists suggestions_one_open on public.suggestions (platform, target_id, kind) where status = 'open';

-- وضع كل منصة
create table if not exists public.control_settings (
  platform text primary key check (platform in ('meta', 'snap', 'tiktok', 'google')),
  mode text not null default 'manual' check (mode in ('manual', 'auto')),
  guardrails jsonb not null default '{}',
  updated_by text,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.audit_log enable row level security;
alter table public.suggestions enable row level security;
alter table public.control_settings enable row level security;
revoke all on public.profiles, public.audit_log, public.suggestions, public.control_settings from anon, authenticated;

-- السجل: إضافة بس، بدون تعديل أو حذف حتى من السيرفر
create or replace function public.audit_log_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;
drop trigger if exists audit_log_no_change on public.audit_log;
create trigger audit_log_no_change before update or delete on public.audit_log
  for each row execute function public.audit_log_append_only();
