-- 042: a Token Vault per company (docs/PRD.md §3.0, milestone M11). Well's secrets keep their names ('conn:NAME', 005_connectors.sql),
-- so the hourly pull and every existing reader work unchanged. Any other company's secret is 'conn:<company uuid>:NAME' and is
-- reachable only through the three functions below, for that company alone. Service role only, as in 005.

-- Well's reader, unchanged except that it no longer sees another company's names
create or replace function public.connector_env() returns table (name text, value text)
language sql security definer set search_path = '' as $$
  select substr(s.name, 6), s.decrypted_secret from vault.decrypted_secrets s
  where s.name like 'conn:%' and s.name !~ '^conn:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:';
$$;

create or replace function public.connector_put_co(p_company uuid, p_name text, p_value text) returns void
language plpgsql security definer set search_path = '' as $$
declare sid uuid; full_name text;
begin
  if p_company is null then raise exception 'no company'; end if;
  if p_name !~ '^[A-Z][A-Z0-9_]{1,63}$' then raise exception 'bad name'; end if;
  if coalesce(p_value, '') = '' then raise exception 'empty value'; end if;
  if not exists (select 1 from public.companies where id = p_company) then raise exception 'unknown company'; end if;
  full_name := 'conn:' || p_company::text || ':' || p_name;
  select id into sid from vault.secrets where name = full_name;
  if sid is null then
    perform vault.create_secret(p_value, full_name, 'لوحة الربط');
  else
    perform vault.update_secret(sid, p_value);
  end if;
end $$;

create or replace function public.connector_drop_co(p_company uuid, p_names text[]) returns void
language sql security definer set search_path = '' as $$
  delete from vault.secrets where p_company is not null and name in (select 'conn:' || p_company::text || ':' || n from unnest(p_names) n);
$$;

create or replace function public.connector_env_co(p_company uuid) returns table (name text, value text)
language sql security definer set search_path = '' as $$
  select substr(s.name, length('conn:' || p_company::text || ':') + 1), s.decrypted_secret from vault.decrypted_secrets s
  where p_company is not null and s.name like 'conn:' || p_company::text || ':%';
$$;

revoke all on function public.connector_env() from public, anon, authenticated;
revoke all on function public.connector_put_co(uuid, text, text) from public, anon, authenticated;
revoke all on function public.connector_drop_co(uuid, text[]) from public, anon, authenticated;
revoke all on function public.connector_env_co(uuid) from public, anon, authenticated;
grant execute on function public.connector_env() to service_role;
grant execute on function public.connector_put_co(uuid, text, text) to service_role;
grant execute on function public.connector_drop_co(uuid, text[]) to service_role;
grant execute on function public.connector_env_co(uuid) to service_role;

insert into public.schema_migrations (name) values ('042_vault_company.sql') on conflict do nothing;
