-- 030: حملات احلم. الأمنيات (wishes) تتحول لخطة (brief) ومهام، كل مهمة لإيجنت من التطبيق، ومخرجاتها تنحفظ هنا.
-- كل صف لشركة وحدة. ما فيه وصول من المتصفح: الخادم بس. ما فيه أي كتابة على حسابات الإعلانات: الحزمة وثائق ومسودات.
-- status الحملة: draft (قيد الكتابة) / planned (الخطة جاهزة تنتظر اعتماد) / approved (معتمدة، تبدأ المهام) / running / review / done / cancelled.
-- status المهمة: waiting (ينتظر) / running (يشتغل) / review (يحتاج مراجعة) / approved (معتمد) / blocked (موقوف بسبب الامتثال) / failed.
create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  title text not null,
  wishes jsonb not null default '{}',
  brief jsonb not null default '{}',
  status text not null default 'planned' check (status in ('draft', 'planned', 'approved', 'running', 'review', 'done', 'cancelled')),
  estimate_usd numeric(12, 6) not null default 0 check (estimate_usd >= 0),
  approved_by text,
  approved_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists campaigns_company_time_idx on public.campaigns (company_id, created_at desc);
alter table public.campaigns enable row level security;
revoke all on public.campaigns from anon, authenticated;

create table if not exists public.campaign_tasks (
  id bigserial primary key,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  company_id uuid not null references public.companies (id),
  position integer not null default 0,
  agent text not null check (agent in ('knowledge', 'content', 'design', 'voice', 'social', 'compliance', 'optimize')),
  title text not null,
  spec jsonb not null default '{}',
  depends_on integer[] not null default '{}',
  status text not null default 'waiting' check (status in ('waiting', 'running', 'review', 'approved', 'blocked', 'failed')),
  blocked_reason text,
  estimate_usd numeric(12, 6) not null default 0 check (estimate_usd >= 0),
  updated_at timestamptz not null default now()
);
create index if not exists campaign_tasks_campaign_idx on public.campaign_tasks (campaign_id, position);
alter table public.campaign_tasks enable row level security;
revoke all on public.campaign_tasks from anon, authenticated;

create table if not exists public.campaign_outputs (
  id bigserial primary key,
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  task_id bigint references public.campaign_tasks (id) on delete cascade,
  company_id uuid not null references public.companies (id),
  kind text not null,
  platform text,
  body jsonb not null default '{}',
  compliance jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index if not exists campaign_outputs_campaign_idx on public.campaign_outputs (campaign_id, created_at);
alter table public.campaign_outputs enable row level security;
revoke all on public.campaign_outputs from anon, authenticated;
