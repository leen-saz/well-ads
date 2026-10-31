# ADR-0002: القاعدة تبقى Supabase (عن طريق Hyperdrive) بدل D1

**الحالة:** مقترح · 2026-10-31

**السياق:** الاستراتيجية افتراضياً D1. كل بياناتنا والدخول (Supabase Auth) والخزنة (Vault) والصلاحيات في Supabase/Postgres.

**القرار:** نبقى على Supabase. الـ Worker يوصل لها عن طريق Cloudflare Hyperdrive (مذكور في M9 كبديل مقبول لـ D1)، أو REST بمفتاح السيرفر.

**الأثر:** خطوة "D1 migration check" في الـ CI تتبدل بتطبيق `supabase/migrations` على Postgres مؤقت. نقل المشروع بين منظمات Supabase بـ Transfer project بس (عشان مفتاح الخزنة).
