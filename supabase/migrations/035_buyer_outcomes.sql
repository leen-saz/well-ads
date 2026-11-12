-- 035: نتيجة كل إجراء نفّذته لين من توصيات الميديا باير، بعد 3 و7 أيام: مقاييس الحملة قبل التنفيذ وبعده (CPL وCTR والصرف والنتائج)
-- وحكم على النتيجة. هذا اللي ينقص لوب التعلّم عشان يقارن ويقترح تعديل القواعد كـ PR تطويري. أرقام وأرقام تعريف بس: لا أسماء حملات
-- (الاسم يُقرأ من buyer_actions) ولا نصوص. الجدول مقفل على المتصفح: السيرفر بس. صف واحد لكل إجراء ويوم قياس.
-- result: worked / no_change / worse / unclear (عينة صغيرة).
create table if not exists public.buyer_outcomes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  action_id uuid not null references public.buyer_actions (id) on delete cascade,
  day int not null check (day in (3, 7)),
  measured_at timestamptz not null default now(),
  platform text not null check (platform in ('meta', 'snapchat', 'tiktok', 'google')),
  rec_rule text,
  kind text not null,
  before jsonb not null default '{}',
  after jsonb not null default '{}',
  result text not null check (result in ('worked', 'no_change', 'worse', 'unclear')),
  unique (action_id, day)
);
create index if not exists buyer_outcomes_company_time_idx on public.buyer_outcomes (company_id, measured_at desc);
alter table public.buyer_outcomes enable row level security;
revoke all on public.buyer_outcomes from anon, authenticated;

insert into public.schema_migrations (name) values ('035_buyer_outcomes.sql') on conflict do nothing;
