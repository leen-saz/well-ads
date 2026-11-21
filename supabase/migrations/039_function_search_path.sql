-- 039: تثبيت search_path على أربع دوال أُنشئت بدونه (Supabase lint 0011 function_search_path_mutable).
-- قبل: مسار البحث يتبع جلسة المستدعي، فجدول بنفس الاسم في schema أولى بالبحث قد يحل محل الجدول المقصود.
-- بعد: search_path فارغ، وكل مرجع جدول في أجسامها مؤهَّل بـ public. (دوال pg_catalog مثل count وsum وto_char تبقى متاحة دائماً.)
-- آمن للإعادة، ولا يغيّر بيانات ولا نص الدوال ولا صلاحياتها.
-- التراجع: alter function ... reset search_path لكل دالة أدناه.
alter function public.audit_log_append_only() set search_path = '';
alter function public.ai_spend(uuid, timestamptz) set search_path = '';
alter function public.ai_spend_provider(uuid, text, timestamptz, timestamptz) set search_path = '';
alter function public.ai_models_spend(uuid, timestamptz) set search_path = '';

insert into public.schema_migrations (name) values ('039_function_search_path.sql') on conflict do nothing;
