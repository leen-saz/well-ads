-- 016: الهوية والبصريات في تاب المعرفة. الشعار، ألوان العلامة، الخطوط، دليل العلامة (PDF)، وصور مرجعية.
-- الملفات في R2 تحت brand/<company>/؛ هنا وصفها. التصميم يستخدم الفعّال منها تلقائياً في كل مرة.
-- مثل بنود المعرفة: اللي يرفعه أحد بدون صلاحية موافقة يبقى موقوف لين يعتمده المدير، وما فيه حذف (الإيقاف يكفي).
create table if not exists public.brand_assets (
  id bigserial primary key,
  company_id uuid not null references public.companies (id),
  kind text not null check (kind in ('logo', 'colors', 'font', 'guide', 'reference')),
  title text not null default '',
  r2_key text,
  mime text,
  size integer,
  value text,
  description text,
  active boolean not null default false,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind = 'colors') = (r2_key is null))
);
create index if not exists brand_assets_company_idx on public.brand_assets (company_id, active, kind);
alter table public.brand_assets enable row level security;
revoke all on public.brand_assets from anon, authenticated;
