-- 019: no table is readable or writable with the public (anon) or a signed-in (authenticated) key.
-- 000_base.sql gave `ads`, `ad_metrics` and `dashboard_state` a "select using (true)" policy for anon, so anyone holding the
-- project's public key could read ad names, spend and metrics straight from Supabase. Nothing in the code uses that:
-- the Worker and the pipeline use the service role only (it bypasses RLS), and the one call with a user's token goes to
-- /auth/v1/user. Several later tables also never revoked the default grants (they were safe only because RLS has no policy).
-- Safe to run twice. Run it in the Supabase SQL editor after 000-018.
drop policy if exists ads_read on public.ads;
drop policy if exists ad_metrics_read on public.ad_metrics;
drop policy if exists dashboard_state_read on public.dashboard_state;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
-- Tables and sequences created later (by the role running migrations) start without those grants too
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- Indexes for reads the code makes that had none: the CRM diagnostic and debugger read one company's leads by created_at
create index if not exists crm_leads_company_created_idx on public.crm_leads (company_id, created_at desc);
