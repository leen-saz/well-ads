-- 011: leads from Well's CRM (Marketing API v1, read-only, pseudonymous). One row per lead, upserted by lead_id.
-- Used to measure each ad on bookings and payments, not only on lead counts. No names, phones or emails exist here.

create table if not exists public.crm_leads (
  lead_id text primary key,
  company_id uuid not null default '00000000-0000-0000-0000-000000000001',
  customer_id text,
  created_at timestamptz not null,
  platform_created_at timestamptz,
  updated_at timestamptz not null,
  source_platform text not null,
  attribution_tier text,
  campaign_id text, campaign_name text,
  adset_id text, adset_name text,
  ad_id text, ad_id_quality text, ad_name text,
  form_id text,
  status text not null,
  crm_stage text, lost_reason text,
  booking_id text, booked_at timestamptz, service_date timestamptz,
  department text, service text, city text,
  booking_value_sar numeric, amount_paid_sar numeric, paid_at timestamptz, payment_status text,
  is_returning boolean, customer_lead_seq integer,
  doc jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);
create index if not exists crm_leads_updated_idx on public.crm_leads (updated_at desc);
create index if not exists crm_leads_ad_idx on public.crm_leads (source_platform, ad_id);
create index if not exists crm_leads_created_idx on public.crm_leads (created_at desc);
alter table public.crm_leads enable row level security;
revoke all on public.crm_leads from anon, authenticated;

-- Where the hourly sync stopped: the largest updated_at stored
create table if not exists public.crm_sync_state (
  id int primary key default 1 check (id = 1),
  last_updated_at timestamptz,
  last_run_at timestamptz,
  rows_last_run integer
);
alter table public.crm_sync_state enable row level security;
revoke all on public.crm_sync_state from anon, authenticated;
