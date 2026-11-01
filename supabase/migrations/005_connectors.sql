-- 005: صفحة الربط. مفاتيح المنصات تنحفظ مشفّرة في Supabase Vault (المفتاح عند Supabase برّا القاعدة)،
-- والجدول connections فيه الحالة بس: مين ربط ومتى، وأسماء المتغيرات بدون قيمها.
-- السيرفر (service_role) بس يكتب ويقرا. التحديث كل ساعة يقرا القيم عن طريق connector_env().
-- انقل المشروع بين المنظمات بـ Transfer project، مو pg_dump/restore: النسخ لمشروع جديد يضيّع مفتاح الخزنة.

create extension if not exists supabase_vault with schema vault;

create table if not exists public.connections (
  platform text primary key,
  method text not null check (method in ('oauth', 'key')),
  names text[] not null default '{}',        -- أسماء المتغيرات المحفوظة في الخزنة (بدون القيم)
  shown jsonb not null default '{}',         -- قيم مو سرية تنعرض في الصفحة (أرقام الحسابات)
  connected_by text,
  connected_at timestamptz not null default now(),
  expires_at timestamptz,
  checked text                               -- نتيجة تجربة المفتاح وقت الحفظ
);
alter table public.connections enable row level security;
revoke all on public.connections from anon, authenticated;

-- يحفظ أو يحدّث قيمة وحدة باسم المتغير اللي يقراه السحب (مثل META_ACCESS_TOKEN)
create or replace function public.connector_put(p_name text, p_value text) returns void
language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  if p_name !~ '^[A-Z][A-Z0-9_]{1,63}$' then raise exception 'bad name'; end if;
  if coalesce(p_value, '') = '' then raise exception 'empty value'; end if;
  select id into sid from vault.secrets where name = 'conn:' || p_name;
  if sid is null then
    perform vault.create_secret(p_value, 'conn:' || p_name, 'لوحة الربط');
  else
    perform vault.update_secret(sid, p_value);
  end if;
end $$;

create or replace function public.connector_drop(p_names text[]) returns void
language sql security definer set search_path = '' as $$
  delete from vault.secrets where name in (select 'conn:' || n from unnest(p_names) n);
$$;

create or replace function public.connector_env() returns table (name text, value text)
language sql security definer set search_path = '' as $$
  select substr(s.name, 6), s.decrypted_secret from vault.decrypted_secrets s where s.name like 'conn:%';
$$;

revoke all on function public.connector_put(text, text) from public, anon, authenticated;
revoke all on function public.connector_drop(text[]) from public, anon, authenticated;
revoke all on function public.connector_env() from public, anon, authenticated;
grant execute on function public.connector_put(text, text) to service_role;
grant execute on function public.connector_drop(text[]) to service_role;
grant execute on function public.connector_env() to service_role;
