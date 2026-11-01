-- 011: كل تاب موديول، والشركة تقفل الموديولات اللي ما تحتاجها. المقفل يطلع بقفل في القائمة ويرجع 403.
alter table public.companies add column if not exists disabled_modules text[] not null default '{}';
-- Well ما تحتاج الرحلات وواتساب الأعمال
update public.companies set disabled_modules = array['journeys'] where id = '00000000-0000-0000-0000-000000000001' and not ('journeys' = any (disabled_modules));
