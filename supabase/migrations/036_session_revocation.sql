-- 036: إنهاء الجلسات القديمة. الكوكي موقّع وبلا حالة على السيرفر، فلا يمكن إلغاؤه إلا بتاريخ على الملف: أي دخول
-- أقدم من valid_after يُرفض (تغيير الباسوورد، إعادة التعيين، الخروج). العمود فاضي = ما أُلغي شي. السيرفر بس يكتبه.
-- قبل تطبيق الملف يشتغل كل شي كما كان (بدون إلغاء)، فلا يحتاج ترتيب مع النشر.
alter table public.profiles add column if not exists valid_after timestamptz;

insert into public.schema_migrations (name) values ('036_session_revocation.sql') on conflict do nothing;
