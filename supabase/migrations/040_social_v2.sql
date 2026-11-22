-- 040: النشر v2 (docs/PRD.md §3.2، المرحلة M6).
-- social_posts.overrides: نص خاص لكل منصة لما يختلف عن النص المشترك، مثل {"x": {"body": "..."}}. فاضي = النص المشترك للكل.
-- social_slots: مواعيد الطابور الأسبوعية للشركة بتوقيت الرياض. «أضف للطابور» يختار أول موعد فاضي، والمنشور ينتظر الاعتماد مثل أي منشور.
alter table public.social_posts add column if not exists overrides jsonb not null default '{}';

create table if not exists public.social_slots (
  id bigserial primary key,
  company_id uuid not null references public.companies (id),
  weekday smallint not null check (weekday between 0 and 6),
  at_local text not null check (at_local ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  created_by text,
  created_at timestamptz not null default now(),
  unique (company_id, weekday, at_local)
);
alter table public.social_slots enable row level security;
revoke all on public.social_slots from anon, authenticated;

insert into public.schema_migrations (name) values ('040_social_v2.sql') on conflict do nothing;
