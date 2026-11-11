-- 032: موديول الفيديو (دمج DaVinci، المرحلة 4). مشروع فيديو من رابط منتج أو خدمة: الموجز، السكربت، خطة اللقطات،
-- وطلبات التوليد (كل لقطة طلب بحالته وإعادة المحاولة وتكلفته). كل جدول فيه company_id. الناتج يبقى مسودة لين
-- يمر على المراجع ثم المعتمد، وما يطلع من النظام قبل الاعتماد.
create table if not exists public.video_projects (
  id bigserial primary key,
  company_id uuid not null references public.companies (id),
  title text not null default '',
  source_url text not null default '',
  brief jsonb not null default '{}',          -- العرض والفوائد والسعر كما انقرت من الصفحة، وتتعدّل باليد
  script jsonb not null default '{}',         -- نص التعليق وخطة اللقطات وتنبيهات الامتثال
  ratio text not null default '9:16' check (ratio in ('9:16', '1:1', '16:9')),
  seconds integer not null default 15 check (seconds in (15, 30, 60)),
  avatar_id text not null default '',          -- من سجل المهارات في الكود، فاضي = بدون أفاتار
  review_status text not null default 'draft' check (review_status in ('draft', 'in_review', 'returned', 'approved')),
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text not null default '',
  approved_by text,
  approved_at timestamptz,
  created_by text,
  created_by_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((review_status = 'approved') = (approved_by is not null))
);
create index if not exists video_projects_company_idx on public.video_projects (company_id, created_at desc);
alter table public.video_projects enable row level security;
revoke all on public.video_projects from anon, authenticated;

create table if not exists public.video_jobs (
  id bigserial primary key,
  company_id uuid not null references public.companies (id),
  project_id bigint not null references public.video_projects (id) on delete cascade,
  shot_no integer not null default 1 check (shot_no >= 1),
  engine text not null,
  params jsonb not null default '{}',          -- المعاملات بعد الفحص، بدون أي مفتاح
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  next_attempt_at timestamptz not null default now(),
  upstream_ref text,                           -- معرّف الطلب عند المحرك
  result_key text,                             -- مفتاح الملف في R2 بعد النسخ
  error_code text,                             -- رمز قصير، مو رد المحرك
  est_cost_usd numeric(12, 6) not null default 0 check (est_cost_usd >= 0),
  cost_recorded boolean not null default false,
  created_by_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists video_jobs_company_idx on public.video_jobs (company_id, project_id, shot_no);
create index if not exists video_jobs_due_idx on public.video_jobs (status, next_attempt_at);
alter table public.video_jobs enable row level security;
revoke all on public.video_jobs from anon, authenticated;

-- المراجع (أنس) والمعتمد (شكيب): إيميلات من يوزرز الشركة. فاضي = المالكة بس. المالكة تعدّل وتعمّد دايم.
create table if not exists public.video_settings (
  company_id uuid primary key references public.companies (id),
  reviewers text[] not null default '{}',
  approvers text[] not null default '{}',
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table public.video_settings enable row level security;
revoke all on public.video_settings from anon, authenticated;

-- ai_usage يقبل مزوّد الفيديو
alter table public.ai_usage drop constraint if exists ai_usage_provider_check;
alter table public.ai_usage add constraint ai_usage_provider_check check (provider in ('openai', 'xai', 'workers', 'anthropic', 'gemini', 'openrouter', 'higgsfield'));

-- الموديول الجديد يبدأ مقفول: لين تفتحه من الإعدادات ← الموديولات. نقفله مرة وحدة لكل شركة (سطر video_settings يمنع القفل
-- من الرجوع لو أعدنا تشغيل الملف بعد ما انفتح).
with fresh as (
  insert into public.video_settings (company_id) select id from public.companies on conflict do nothing returning company_id
)
update public.companies c set disabled_modules = array_append(c.disabled_modules, 'video')
from fresh where c.id = fresh.company_id and not ('video' = any (c.disabled_modules));
