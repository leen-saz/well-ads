-- 023: السوشال: استرجاع المنشور العالق وإعادة المحاولة.
-- claimed_at: متى بدأ الـ Cron ينشر المنشور (publishing أقدم من 15 دقيقة = عالق، يُسترجع من النتائج المحفوظة لكل منصة).
-- retried_at: إعادة المحاولة للمنصات الفاشلة مسموحة مرة وحدة بس.
alter table public.social_posts add column if not exists claimed_at timestamptz;
alter table public.social_posts add column if not exists retried_at timestamptz;
create index if not exists social_posts_publishing_idx on public.social_posts (publish_at) where status = 'publishing';
