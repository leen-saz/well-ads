-- 013: Social listening (الرصد). Watch lists and the mentions found for them.
create table if not exists public.listen_watch (
  id bigserial primary key,
  company_id uuid not null references public.companies (id),
  kind text not null check (kind in ('brand', 'competitor', 'alert')),
  name text not null,
  keywords text[] not null default '{}',
  links jsonb not null default '{}',
  fetched_at timestamptz,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists listen_watch_company_idx on public.listen_watch (company_id);
create index if not exists listen_watch_due_idx on public.listen_watch (fetched_at nulls first);
alter table public.listen_watch enable row level security;
revoke all on public.listen_watch from anon, authenticated;

create table if not exists public.listen_mentions (
  id bigserial primary key,
  company_id uuid not null references public.companies (id),
  watch_id bigint not null references public.listen_watch (id) on delete cascade,
  source text not null,
  url text not null,
  title text not null default '',
  snippet text not null default '',
  author text not null default '',
  published_at timestamptz,
  sentiment text check (sentiment in ('positive', 'negative', 'neutral')),
  reason text,
  fetched_at timestamptz not null default now(),
  unique (company_id, url)
);
create index if not exists listen_mentions_company_at_idx on public.listen_mentions (company_id, published_at desc);
create index if not exists listen_mentions_unscored_idx on public.listen_mentions (company_id) where sentiment is null;
alter table public.listen_mentions enable row level security;
revoke all on public.listen_mentions from anon, authenticated;
