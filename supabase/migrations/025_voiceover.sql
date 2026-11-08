-- 025: الفويس أوفر العربي (docs/voiceover.md). نص يتحول لصوت بلهجة سعودية أو خليجية، والصوت ما ينحفظ (يتولّد ويتسمع وينزّل).
-- صوت العلامة: الصوت واللهجة والنبرة والإيقاع الافتراضية للشركة، تحددها مرة وتنطبق على كل توليد.
create table if not exists public.voiceover_settings (
  company_id uuid primary key references public.companies (id),
  voice text not null default 'Charon',
  accent text not null default 'najdi',
  tone text not null default 'warm',
  pace text not null default 'normal' check (pace in ('slow', 'normal', 'fast')),
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table public.voiceover_settings enable row level security;
revoke all on public.voiceover_settings from anon, authenticated;

-- موديول جديد يبدأ مقفل لكل الشركات لين تفتحه المالكة من الإعدادات ← الموديولات
update public.companies set disabled_modules = array_append(disabled_modules, 'voiceover') where not ('voiceover' = any (disabled_modules));
