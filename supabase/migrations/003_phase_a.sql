-- المرحلة A: أعمدة الاقتراح الكاملة، والمراجع الثاني، وزر الطوارئ.
alter table public.suggestions
  add column if not exists before jsonb,
  add column if not exists after jsonb,
  add column if not exists risk text[] not null default '{}',
  add column if not exists expect jsonb,
  add column if not exists measure_plan text,
  add column if not exists reversal_plan text,
  add column if not exists digest text,
  add column if not exists revision int not null default 1,
  add column if not exists requested_by text,
  add column if not exists critic jsonb;

-- صف "global" لزر الطوارئ والقائمة المسموحة (canary)
alter table public.control_settings drop constraint if exists control_settings_platform_check;
alter table public.control_settings add constraint control_settings_platform_check check (platform in ('meta', 'snap', 'tiktok', 'google', 'global'));
insert into public.control_settings (platform, mode, guardrails) values ('global', 'manual', '{"kill": false, "canary": []}')
  on conflict (platform) do nothing;
