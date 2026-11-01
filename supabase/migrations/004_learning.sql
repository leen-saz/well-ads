-- المرحلة C: حلقة التعلّم. كل حركة للميديا باير (في اللوحة أو داخل المنصة نفسها) تنسجل، وتنقاس نتيجتها، وتطلع منها دروس.

-- الحركات اللي تصير داخل المنصات مباشرة (سجل نشاط Meta، وتغييرات Google)
create table if not exists public.platform_activity (
  id bigserial primary key,
  platform text not null,
  event_id text not null,
  at timestamptz not null,
  actor text,
  event text not null,
  object_type text,
  object_id text,
  object_name text,
  detail jsonb,
  unique (platform, event_id)
);
create index if not exists platform_activity_at_idx on public.platform_activity (at desc);

-- نتيجة كل قرار بعد 3 و7 أيام
create table if not exists public.outcomes (
  id bigserial primary key,
  suggestion_id bigint not null references public.suggestions (id) on delete cascade,
  day int not null check (day in (3, 7)),
  at timestamptz not null default now(),
  metrics jsonb not null,
  vs_expect jsonb,
  unique (suggestion_id, day)
);

-- الدروس اللي يقراها الاقتراح والمراجع
create table if not exists public.lessons (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  platform text,
  kind text,
  lesson text not null,
  evidence jsonb not null default '{}',
  confidence numeric not null default 0,
  block boolean not null default false,
  active boolean not null default true
);

alter table public.platform_activity enable row level security;
alter table public.outcomes enable row level security;
alter table public.lessons enable row level security;
revoke all on public.platform_activity, public.outcomes, public.lessons from anon, authenticated;
