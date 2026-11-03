-- 015: الكوبي رايتر (docs/learning-loops.md، C1). مشروع لكل خدمة أو حملة: الإعداد، وصوت العلامة، والكلمات الممنوعة،
-- والمنافسين (اسم أو رابط عام + نصوص ملصوقة). بطاقة النمط تنحسب وقت القراءة، فما تنحفظ.
create table if not exists public.copy_projects (
  id bigserial primary key,
  company_id uuid not null references public.companies (id),
  name text not null,
  service text not null default '',
  audience text not null default '',
  offer text not null default '',
  cta text not null default '',
  voice text not null default '',
  banned text[] not null default '{}',
  competitors jsonb not null default '[]',
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists copy_projects_company_idx on public.copy_projects (company_id, updated_at desc);
alter table public.copy_projects enable row level security;
revoke all on public.copy_projects from anon, authenticated;
