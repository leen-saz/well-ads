-- 013: لين: ما ينشر أي منشور إلا باعتماد مدير معيّن. الشركة تختار مين يعتمد (إيميلات من يوزرز الشركة).
-- فاضية = المالك بس يعتمد. الوضع التلقائي انلغى: كل منشور ينتظر اعتماد.
alter table public.companies add column if not exists social_approvers text[] not null default '{}';
-- المنشورات التلقائية اللي ما انتشرت للحين تصير يدوية (تنتظر اعتماد)
update public.social_posts set mode = 'manual' where mode = 'auto' and status = 'scheduled' and approved_at is null;
