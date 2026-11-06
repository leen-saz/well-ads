-- 019: تتبع تكلفة الذكاء الاصطناعي (docs/ai-cost.md). كل طلب موديل يمر من src/lib/llm.ts يكتب سطر في ai_usage:
-- التاب والمزوّد والموديل والتوكنز والتكلفة بالدولار (وحدة فاتورة المزوّد) وبالريال بسعر الصرف وقتها، ومعرّف المستخدم.
-- ما ينكتب نص الطلب ولا الرد ولا الإيميل. سقف التاب الشهري في ai_budgets: فاضي = بدون سقف، وما فيه سقف افتراضي.
create table if not exists public.ai_usage (
  id bigserial primary key,
  company_id uuid not null references public.companies (id),
  user_id uuid,
  module text not null,
  provider text not null check (provider in ('openai', 'xai', 'workers', 'anthropic')),
  model text not null,
  tokens_in integer not null default 0 check (tokens_in >= 0),
  tokens_out integer not null default 0 check (tokens_out >= 0),
  cost_usd numeric(12, 6) not null default 0 check (cost_usd >= 0),
  cost_sar numeric(12, 6) not null default 0 check (cost_sar >= 0),
  usd_sar numeric(8, 4) not null default 3.75,
  priced boolean not null default true,
  estimated boolean not null default false,   -- التوكنز مقدّرة: انقطع البث قبل ما يرجع المزوّد الأرقام
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_company_time_idx on public.ai_usage (company_id, created_at desc);
create index if not exists ai_usage_company_module_idx on public.ai_usage (company_id, module, created_at desc);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;

create table if not exists public.ai_budgets (
  company_id uuid not null references public.companies (id),
  module text not null,
  monthly_cap_usd numeric(12, 4) check (monthly_cap_usd is null or monthly_cap_usd > 0),
  alert_at_pct integer not null default 80 check (alert_at_pct between 1 and 99),
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (company_id, module)
);
alter table public.ai_budgets enable row level security;
revoke all on public.ai_budgets from anon, authenticated;

-- Spend per month (Riyadh time) and tab for one company since a date: one read for the owner screen and the cap check
create or replace function public.ai_spend(p_company uuid, p_since timestamptz)
returns table (month text, module text, calls bigint, tokens_in bigint, tokens_out bigint, cost_usd numeric, cost_sar numeric, unpriced bigint, providers text[])
language sql stable as $$
  select to_char(created_at at time zone 'Asia/Riyadh', 'YYYY-MM'), module, count(*), coalesce(sum(tokens_in), 0)::bigint, coalesce(sum(tokens_out), 0)::bigint,
         coalesce(sum(cost_usd), 0), coalesce(sum(cost_sar), 0), count(*) filter (where not priced), array_agg(distinct provider)
  from public.ai_usage
  where company_id = p_company and created_at >= p_since
  group by 1, 2
$$;
revoke all on function public.ai_spend(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.ai_spend(uuid, timestamptz) to service_role;

-- What the invoice check compares: one provider's recorded cost in a month
create or replace function public.ai_spend_provider(p_company uuid, p_provider text, p_from timestamptz, p_to timestamptz)
returns table (calls bigint, cost_usd numeric, unpriced bigint)
language sql stable as $$
  select count(*), coalesce(sum(cost_usd), 0), count(*) filter (where not priced)
  from public.ai_usage
  where company_id = p_company and provider = p_provider and created_at >= p_from and created_at < p_to
$$;
revoke all on function public.ai_spend_provider(uuid, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.ai_spend_provider(uuid, text, timestamptz, timestamptz) to service_role;
