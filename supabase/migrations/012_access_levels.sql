-- 012: صلاحيات أدق. لكل يوزر ولكل لوحة/موديول مستوى: view (مشاهدة) / edit (تعديل) / approve (موافقة).
-- dashboards يبقى (مفاتيح اللوحات اللي له فيها أي مستوى) عشان أي كود قديم يقراه.
alter table public.profiles add column if not exists access jsonb not null default '{}';
-- الموجودين: كل لوحة عندهم = موافقة (نفس صلاحيتهم قبل، ما ينقص منهم شي)
update public.profiles p set access = (select coalesce(jsonb_object_agg(d, 'approve'), '{}'::jsonb) from unnest(p.dashboards) d)
  where p.access = '{}'::jsonb and cardinality(p.dashboards) > 0;
