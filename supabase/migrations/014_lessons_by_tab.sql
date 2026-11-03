-- 014: لوب التعلّم لكل تاب (docs/learning-loops.md، L1). الدروس صارت لكل شركة ولكل تاب، ولها حالة:
-- new (جديد) ← reviewed (راجعه المايسترو) ← approved (اعتمده صاحب صلاحية الموافقة) أو ignored ← exported (انحفظ في playbook).
-- دروس الإعلانات الحالية تصير module = 'ads' لشركة Well، وتبقى تشتغل مثل قبل (active).
alter table public.lessons add column if not exists company_id uuid not null default '00000000-0000-0000-0000-000000000001' references public.companies (id);
alter table public.lessons add column if not exists module text not null default 'ads';
alter table public.lessons add column if not exists status text not null default 'new' check (status in ('new', 'reviewed', 'approved', 'ignored', 'exported'));
alter table public.lessons add column if not exists source text;
alter table public.lessons add column if not exists decided_by text;
alter table public.lessons add column if not exists decided_at timestamptz;
create index if not exists lessons_company_module_idx on public.lessons (company_id, module, created_at desc);
