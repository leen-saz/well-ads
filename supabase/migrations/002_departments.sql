-- نطاق الأقسام لكل يوزر: فاضي = كل الأقسام. مدير القسم يشوف تحليلات قسمه بس.
alter table public.profiles add column if not exists departments text[] not null default '{}';
