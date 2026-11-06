-- 022: Core Web Vitals reports from real visits (src/api/routes/vitals.ts), kept 7 days, read by the owner on the data-health page.
-- No personal data: the page's path (ids collapsed to :id), four numbers and a mobile flag. No user, company or IP.
create table if not exists public.web_vitals (
  id bigserial primary key,
  at timestamptz not null default now(),
  path text not null,
  lcp numeric,
  inp numeric,
  cls numeric,
  ttfb numeric,
  mobile boolean not null default false
);
create index if not exists web_vitals_at_idx on public.web_vitals (at desc);
-- Server only (the Worker's service role): no policy means no access for anyone else
alter table public.web_vitals enable row level security;
