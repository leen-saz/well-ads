-- 027: requests sent from the public Apipeline pages (/welcome/, /security/, /profile/) through src/api/routes/site.ts.
-- Personal data under PDPL: collected only with the visitor's consent (consent_at), used only to answer the request,
-- read and deleted by the owner (Settings → Website requests). No IP is stored: ip_key is a keyed hash that changes
-- every day, used only to limit how many requests one visitor sends in an hour.
create table if not exists public.site_requests (
  id bigserial primary key,
  at timestamptz not null default now(),
  kind text not null check (kind in ('board', 'leakmap', 'security', 'other')),
  name text not null check (char_length(name) between 2 and 80),
  company text check (char_length(company) <= 120),
  phone text not null check (phone ~ '^\+9665[0-9]{8}$|^\+[1-9][0-9]{7,14}$'),
  email text check (char_length(email) <= 254),
  scope text[] not null default '{}',
  message text check (char_length(message) <= 1500),
  page text not null default '/',
  lang text not null default 'ar' check (lang in ('ar', 'en')),
  consent_at timestamptz not null,
  ip_key text not null,
  status text not null default 'new' check (status in ('new', 'contacted', 'closed')),
  handled_at timestamptz
);
create index if not exists site_requests_at_idx on public.site_requests (at desc);
create index if not exists site_requests_ip_idx on public.site_requests (ip_key, at desc);
-- Server only (the Worker's service role): no policy means no access for anyone else
alter table public.site_requests enable row level security;
