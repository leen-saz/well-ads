-- 006: الشركات (SaaS). كل شركة بياناتها معزولة، وWell هي الشركة الأولى.
-- اليوزر ينتمي لشركة وحدة. owner = مالكة الشركة (تدير يوزرز شركتها بس).
-- الجداول الجديدة (السوشال، الرحلات، المحتوى، المهام) كلها فيها company_id من أول يوم.
-- جداول الإعلانات والربط القديمة تاخذ company_id بقيمة Well الافتراضية، وتحويل مفاتيحها الأساسية خطوة لاحقة (ADR-0006).

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  name text not null,
  plan text not null default 'free',
  active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.companies (id, slug, name) values ('00000000-0000-0000-0000-000000000001', 'well', 'Well')
  on conflict (id) do nothing;

alter table public.profiles add column if not exists company_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.companies (id);
alter table public.audit_log add column if not exists company_id uuid not null default '00000000-0000-0000-0000-000000000001';
alter table public.connections add column if not exists company_id uuid not null default '00000000-0000-0000-0000-000000000001';
alter table public.ads add column if not exists company_id uuid not null default '00000000-0000-0000-0000-000000000001';
create index if not exists profiles_company_idx on public.profiles (company_id);
create index if not exists audit_log_company_at_idx on public.audit_log (company_id, at desc);
create index if not exists ads_company_idx on public.ads (company_id);

alter table public.companies enable row level security;
revoke all on public.companies from anon, authenticated;
