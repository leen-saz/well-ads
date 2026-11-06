-- 020: المكتبة المشتركة والمفضلة (docs/library.md). أي ناتج (نص، تصميم، سكربت، فيديو) من أي موديول ينحفظ مع نتيجة فحص الامتثال.
-- أعمدة المراجعة والتعميد (review_status, reviewed_by, approved_by) موجودة من الحين؛ مسار المراجعة نفسه (أنس ثم شكيب) المرحلة الرابعة.
-- المالكة تعدّل وتعمّد كل شي. المفضلة لكل مستخدم داخل شركته.
create table if not exists public.library_items (
  id bigserial primary key,
  company_id uuid not null references public.companies (id),
  module text not null,
  kind text not null check (kind in ('text', 'design', 'script', 'video')),
  title text not null default '',
  content text not null default '',
  platform text not null default '',
  service text not null default '',
  compliance_result jsonb not null default '{}',
  review_status text not null default 'draft' check (review_status in ('draft', 'in_review', 'returned', 'approved')),
  reviewed_by text,
  approved_by text,
  created_by text,
  created_by_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((review_status = 'approved') = (approved_by is not null))
);
create index if not exists library_items_company_idx on public.library_items (company_id, created_at desc);
create index if not exists library_items_module_idx on public.library_items (company_id, module, created_at desc);
alter table public.library_items enable row level security;
revoke all on public.library_items from anon, authenticated;

create table if not exists public.library_favorites (
  company_id uuid not null references public.companies (id),
  item_id bigint not null references public.library_items (id) on delete cascade,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (item_id, user_id)
);
create index if not exists library_favorites_user_idx on public.library_favorites (company_id, user_id);
alter table public.library_favorites enable row level security;
revoke all on public.library_favorites from anon, authenticated;
