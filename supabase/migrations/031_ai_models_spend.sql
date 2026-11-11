-- 031: جدول مقارنة التكلفة المسجّلة بالمتوقعة للمالكة (صفحة الصرف). تجميع شهري لكل مزوّد وموديل: الطلبات والتوكنز
-- والتكلفة المسجّلة، وعدد الطلبات بدون سعر وعدد اللي توكنزها مقدّرة. للخادم بس.
create or replace function public.ai_models_spend(p_company uuid, p_since timestamptz)
returns table (month text, provider text, model text, calls bigint, tokens_in bigint, tokens_out bigint, cost_usd numeric, unpriced bigint, estimated bigint)
language sql stable as $$
  select to_char(created_at at time zone 'Asia/Riyadh', 'YYYY-MM'), provider, model, count(*), coalesce(sum(tokens_in), 0)::bigint, coalesce(sum(tokens_out), 0)::bigint,
         coalesce(sum(cost_usd), 0), count(*) filter (where not priced), count(*) filter (where estimated)
  from public.ai_usage
  where company_id = p_company and created_at >= p_since
  group by 1, 2, 3
$$;
revoke all on function public.ai_models_spend(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.ai_models_spend(uuid, timestamptz) to service_role;
