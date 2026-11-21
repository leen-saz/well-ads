-- 044: what each connected account may write (docs/PRD.md §7 M12a), checked automatically once a day and with «افحص الحين».
-- One row per company and connection, overwritten every check. Permission names only: never a token.
create table if not exists public.account_permissions (
  company_id uuid not null references public.companies (id),
  platform text not null check (platform ~ '^[a-z0-9_]{1,40}$'),
  state text not null check (state in ('write', 'partial', 'read_only', 'not_connected', 'unknown')),
  missing text[] not null default '{}',
  code text check (code is null or code ~ '^[a-z0-9_]{1,40}$'),
  checked_at timestamptz not null default now(),
  primary key (company_id, platform)
);
alter table public.account_permissions enable row level security;
revoke all on public.account_permissions from anon, authenticated;

insert into public.schema_migrations (name) values ('044_account_permissions.sql') on conflict do nothing;
