-- 038: فهارس لأعمدة المفتاح الأجنبي التي عليها on delete cascade ولا يبدأ بها أي فهرس.
-- قبل: حذف صف أب (مراقبة استماع، مهمة حملة، مشروع فيديو) يمسح جدول الأبناء كاملاً ليجد صفوفه (Postgres لا ينشئ هذا الفهرس تلقائياً).
-- آمن للإعادة، وإضافي فقط: لا يغيّر بيانات ولا يمس جدولاً موجوداً. التراجع: drop index if exists لكل فهرس أدناه.
create index if not exists listen_mentions_watch_idx on public.listen_mentions (watch_id);
create index if not exists campaign_outputs_task_idx on public.campaign_outputs (task_id) where task_id is not null;
create index if not exists video_jobs_project_idx on public.video_jobs (project_id, shot_no);

insert into public.schema_migrations (name) values ('038_cascade_fk_indexes.sql') on conflict do nothing;
