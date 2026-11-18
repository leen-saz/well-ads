-- 037: read-only API keys for the dashboard's /api/v1/* (docs/api-v1.md). The owner makes a key in النظام ← الصلاحيات والدخول; the key is shown ONCE.
-- Only a SHA-256 hash (with the Worker's API_KEY_PEPPER) is stored, never the key. A key reads, never writes, and only what its scopes name.
-- api_key_hits counts requests per key (a minute and a day window) for the rate limit; api_key_hit() counts one request atomically.
-- Safe to run twice. The Worker answers 503 on /api/v1/* until this is applied. Closed to the browser: the server's service role only.
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id),
  name text not null check (char_length(name) between 1 and 80),
  key_hash text not null unique,                  -- hex SHA-256 of pepper + key
  prefix text not null,                           -- first 8 characters of the key, for display
  scopes text[] not null default '{}',
  created_by uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  use_count bigint not null default 0,
  revoked_at timestamptz
);
create index if not exists api_keys_company_idx on public.api_keys (company_id, created_at desc);
alter table public.api_keys enable row level security;
revoke all on public.api_keys from anon, authenticated;

create table if not exists public.api_key_hits (
  key_id uuid not null references public.api_keys (id) on delete cascade,
  company_id uuid not null references public.companies (id),
  kind text not null check (kind in ('m', 'd')),   -- minute or day window
  window_start timestamptz not null,
  n integer not null default 0,
  primary key (key_id, kind, window_start)
);
alter table public.api_key_hits enable row level security;
revoke all on public.api_key_hits from anon, authenticated;

-- Counts one request of a key and returns this minute's and today's totals (UTC windows). Also stamps last_used_at and use_count.
create or replace function public.api_key_hit(p_key uuid) returns table (minute_n integer, day_n integer)
language plpgsql security definer set search_path = public as $$
declare
  v_co uuid;
  v_min timestamptz := date_trunc('minute', now());
  v_day timestamptz := date_trunc('day', now());
  m integer;
  d integer;
begin
  update public.api_keys set last_used_at = now(), use_count = use_count + 1 where id = p_key returning company_id into v_co;
  if v_co is null then return; end if;
  insert into public.api_key_hits (key_id, company_id, kind, window_start, n) values (p_key, v_co, 'm', v_min, 1)
    on conflict (key_id, kind, window_start) do update set n = public.api_key_hits.n + 1 returning n into m;
  insert into public.api_key_hits (key_id, company_id, kind, window_start, n) values (p_key, v_co, 'd', v_day, 1)
    on conflict (key_id, kind, window_start) do update set n = public.api_key_hits.n + 1 returning n into d;
  delete from public.api_key_hits where key_id = p_key and window_start < now() - interval '2 days';
  return query select m, d;
end $$;
revoke all on function public.api_key_hit(uuid) from public, anon, authenticated;
grant execute on function public.api_key_hit(uuid) to service_role;

insert into public.schema_migrations (name) values ('037_api_keys.sql') on conflict do nothing;
