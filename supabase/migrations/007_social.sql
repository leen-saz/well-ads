-- 007: السوشال والجدولة. كل منشور لشركة وحدة، وينشر لأكثر من منصة.
-- mode: auto = ينشر في وقته، manual = ينتظر موافقة (مع تنبيه). الجدولة يشغلها Cron في الـ Worker كل 5 دقايق.
create table if not exists public.social_posts (
  id bigserial primary key,
  company_id uuid not null references public.companies (id),
  platforms text[] not null check (cardinality(platforms) > 0),
  body text not null default '',
  media jsonb not null default '[]',
  publish_at timestamptz not null,
  mode text not null default 'manual' check (mode in ('auto', 'manual')),
  status text not null default 'scheduled' check (status in ('draft', 'scheduled', 'publishing', 'published', 'partial', 'failed', 'cancelled')),
  approved_by text,
  approved_at timestamptz,
  results jsonb not null default '{}',
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists social_posts_company_at_idx on public.social_posts (company_id, publish_at);
create index if not exists social_posts_due_idx on public.social_posts (publish_at) where status = 'scheduled';
alter table public.social_posts enable row level security;
revoke all on public.social_posts from anon, authenticated;
