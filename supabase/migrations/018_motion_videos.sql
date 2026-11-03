-- 018: فيديو الموشن من المايسترو (docs/motion-video.md). مشروع = تصميم معتمد + صوت معتمد؛ كل نسخة خطة مشاهد يكتبها ChatGPT.
-- النسخ ما تنمسح ولا تتعدل: التعديل يضيف نسخة جديدة (parent_version = النسخة اللي انطلب عليها التعديل)، والأصلية v1 باقية.
-- الاعتماد على مستوى المشروع (approved_version)، وأي تعديل بعده يرجّعه مسودة. الملفات في R2 تحت motion/<company>/.
create table if not exists public.motion_projects (
  id bigserial primary key,
  company_id uuid not null references public.companies (id),
  title text not null default '',
  headline text not null default '',
  script text not null default '',
  ratio text not null default '9:16' check (ratio in ('9:16', '1:1', '16:9')),
  design_key text not null,
  design_mime text not null,
  voice_key text not null,
  voice_mime text not null,
  voice_seconds numeric(5, 2) not null check (voice_seconds between 3 and 90),
  status text not null default 'draft' check (status in ('draft', 'approved')),
  approved_version integer,
  approved_by text,
  approved_at timestamptz,
  pc_issue text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'approved') = (approved_version is not null))
);
create index if not exists motion_projects_company_idx on public.motion_projects (company_id, created_at desc);

create table if not exists public.motion_versions (
  id bigserial primary key,
  company_id uuid not null references public.companies (id),
  project_id bigint not null references public.motion_projects (id),
  version integer not null check (version >= 1),
  parent_version integer,
  change_request text,
  spec jsonb not null,
  engine text not null,
  model text,
  created_by text,
  created_at timestamptz not null default now(),
  unique (project_id, version),
  check ((version = 1) = (parent_version is null))
);
create index if not exists motion_versions_project_idx on public.motion_versions (company_id, project_id, version);

alter table public.motion_projects enable row level security;
alter table public.motion_versions enable row level security;
revoke all on public.motion_projects from anon, authenticated;
revoke all on public.motion_versions from anon, authenticated;
