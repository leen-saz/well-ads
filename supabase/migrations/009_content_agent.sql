-- 009: إيجنت المحتوى و SEO/AEO. يحلل الموقع (+ Search Console لو مربوط) ويطلع بلان، والماركتير يوافق على كل بند.
-- competitors = المنافسين اللي عاجبينه (نبرة وأسلوب) كمرجع.
create table if not exists public.content_plans (
  id bigserial primary key,
  company_id uuid not null references public.companies (id),
  site text not null,
  niche text not null default '',
  competitors text[] not null default '{}',
  analysis jsonb not null default '{}',
  items jsonb not null default '[]',
  engine text not null default 'rules',
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists content_plans_company_idx on public.content_plans (company_id, created_at desc);
alter table public.content_plans enable row level security;
revoke all on public.content_plans from anon, authenticated;
