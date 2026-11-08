-- 024: وصف الصور (docs/vision.md). صورة إعلان تنرفع، ويطلع وصفها بالعربي ونص بديل والنص اللي داخلها والعرض والهوك والدعوة، مع ملاحظات الامتثال.
-- الصورة نفسها ما تنحفظ (تنصغّر في المتصفح وتنرسل للتحليل وبس)، يبقى الناتج. نفس الصورة داخل الشركة ما تنحلل مرتين (بصمتها).
create table if not exists public.vision_analyses (
  id bigserial primary key,
  company_id uuid not null references public.companies (id),
  created_by text,
  created_by_id uuid,
  title text not null default '',
  file_hash text not null check (file_hash ~ '^[0-9a-f]{64}$'),
  mime text not null,
  result jsonb not null default '{}',
  compliance_result jsonb not null default '{}',
  library_id bigint,
  created_at timestamptz not null default now(),
  unique (company_id, file_hash)
);
create index if not exists vision_analyses_company_idx on public.vision_analyses (company_id, created_at desc);
alter table public.vision_analyses enable row level security;
revoke all on public.vision_analyses from anon, authenticated;

-- موديول جديد يبدأ مقفل لكل الشركات لين تفتحه المالكة من الإعدادات ← الموديولات
update public.companies set disabled_modules = array_append(disabled_modules, 'vision') where not ('vision' = any (disabled_modules));
