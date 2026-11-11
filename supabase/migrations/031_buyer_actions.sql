-- 031: إجراءات الميديا باير بموافقة. كل توصية تغيّر حساباً إعلانياً (ميزانية، إيقاف، تشغيل) تتحول لصف هنا ينتظر موافقة لين،
-- وما ينفّذ شي إلا بعد ضغطها بنفسها وتأكيد ثانٍ. القيم هنا أرقام وأرقام تعريف منصات فقط: لا مفاتيح ولا نصوص رسائل المنصات.
-- المفاتيح تنحفظ في أسرار الـ Worker وليس هنا. الجدول مقفل على المتصفح: السيرفر بس.
-- status: proposed (ينتظر) / rejected / applying (قيد التنفيذ، يمنع التكرار) / applied / failed / aborted (القيمة تغيّرت قبل التنفيذ) / rolled_back / manual_done.
-- mode: auto (ينفّذه النظام بعد الموافقة) / manual (نفّذ يدوياً: تيك توك، قوقل، أو ما قدرنا نحدد الكيان بدقة).
create table if not exists public.buyer_actions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  created_at timestamptz not null default now(),
  created_by text,
  platform text not null check (platform in ('meta', 'snapchat', 'tiktok', 'google')),
  level text not null check (level in ('campaign', 'adset', 'ad')),
  entity_id text,
  entity_name text,
  rec_id text,
  rec_rule text,
  kind text not null,
  change jsonb not null,
  reason text not null,
  risk text,
  success jsonb not null default '{}',
  mode text not null default 'auto' check (mode in ('auto', 'manual')),
  manual_why text,
  status text not null default 'proposed' check (status in ('proposed', 'rejected', 'applying', 'applied', 'failed', 'aborted', 'rolled_back', 'manual_done')),
  idem_key text not null,
  decided_by text,
  decided_at timestamptz,
  dry_run jsonb,
  result jsonb,
  applied_at timestamptz,
  rolled_back_at timestamptz,
  rolled_back_by text
);
create index if not exists buyer_actions_company_time_idx on public.buyer_actions (company_id, created_at desc);
create index if not exists buyer_actions_entity_idx on public.buyer_actions (company_id, platform, entity_id, applied_at desc);
-- نفس التغيير لنفس الكيان في نفس اليوم: صف واحد فعّال بس (مفتوح أو قيد التنفيذ أو منفّذ). هذا الـ idempotency على مستوى القاعدة.
create unique index if not exists buyer_actions_one_live on public.buyer_actions (company_id, idem_key) where status in ('proposed', 'applying', 'applied');
alter table public.buyer_actions enable row level security;
revoke all on public.buyer_actions from anon, authenticated;
