-- 017: بنود معرفة مقترحة من دليل العلامة (PDF). تنحفظ موقوفة بـ source = 'brand_file' لين يراجعها المدير ويفعّلها.
-- topic = guide-<رقم الملف> عشان الدليل نفسه ما يتقرا مرتين.
alter table public.knowledge drop constraint if exists knowledge_source_check;
alter table public.knowledge add constraint knowledge_source_check check (source in ('manual', 'training', 'brand_file'));
