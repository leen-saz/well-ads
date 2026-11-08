-- 024: تفريغ الصوت والفيديو (docs/transcribe.md). ملف صوت أو فيديو ينرفع، ينقسم لنوافذ 10 دقايق، وكل نافذة تنفرّغ في خطوة لحالها
-- (الصفحة تكمل الخطوات، وإذا انقفلت الصفحة يكملها الكرون كل 5 دقايق). النتيجة (ملخص + بنود عمل + النص) تنحفظ في المكتبة كمسودة.
-- الملف الأصلي ينحذف من R2 ومن Google بعد التفريغ، ويبقى النص بس.
create table if not exists public.transcribe_jobs (
  id bigserial primary key,
  company_id uuid not null references public.companies (id),
  created_by text,
  created_by_id uuid,
  title text not null default '',
  purpose text not null default 'meeting' check (purpose in ('meeting', 'ad')),
  mime text not null,
  bytes bigint not null check (bytes > 0),
  seconds integer not null check (seconds between 1 and 14400),
  r2_key text,
  status text not null default 'queued' check (status in ('queued', 'processing', 'done', 'failed')),
  step integer not null default 0,
  steps integer not null default 3,
  attempts integer not null default 0,
  gemini_file text,
  gemini_uri text,
  segments jsonb not null default '[]',
  result jsonb not null default '{}',
  error text,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists transcribe_jobs_company_idx on public.transcribe_jobs (company_id, created_at desc);
create index if not exists transcribe_jobs_open_idx on public.transcribe_jobs (status, updated_at) where status in ('queued', 'processing');
alter table public.transcribe_jobs enable row level security;
revoke all on public.transcribe_jobs from anon, authenticated;

-- Gemini bills speech, audio and images: its calls are recorded in ai_usage next to the other providers
alter table public.ai_usage drop constraint if exists ai_usage_provider_check;
alter table public.ai_usage add constraint ai_usage_provider_check check (provider in ('openai', 'xai', 'workers', 'anthropic', 'gemini'));

-- موديول جديد يبدأ مقفل لكل الشركات لين تفتحه المالكة من الإعدادات ← الموديولات
update public.companies set disabled_modules = array_append(disabled_modules, 'transcribe') where not ('transcribe' = any (disabled_modules));
