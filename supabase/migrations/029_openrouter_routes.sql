-- 029: OpenRouter كمزوّد، وتوجيه كل مهمة (تاب) لمزوّد وموديل تختاره المالكة. بدون سطر هنا كل شي يشتغل زي ما هو.
-- ai_usage يقبل مزوّد openrouter (التكلفة تجي من رد المزوّد نفسه). ai_routes: للمالكة بس، ما فيه وصول من المتصفح.
alter table public.ai_usage drop constraint if exists ai_usage_provider_check;
alter table public.ai_usage add constraint ai_usage_provider_check check (provider in ('openai', 'xai', 'workers', 'anthropic', 'gemini', 'openrouter'));

create table if not exists public.ai_routes (
  company_id uuid not null references public.companies (id),
  task text not null,
  provider text not null check (provider in ('openai', 'xai', 'openrouter', 'workers')),
  model text,
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (company_id, task)
);
alter table public.ai_routes enable row level security;
revoke all on public.ai_routes from anon, authenticated;
