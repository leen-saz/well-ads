-- 036: the daily full pass of the CRM lead sync (pipeline/crm/fetch.py) is tracked on its own and resumes across hourly runs.
-- Before: only last_run_at existed and was written at the very end of a run, so a run that died halfway (CRM 429) made every hourly run
-- restart the heavy 92-day pass from zero and never finish. Safe to run twice. The pipeline works without it (old behaviour, with a log line).
alter table public.crm_sync_state add column if not exists last_full_pass_at timestamptz;
alter table public.crm_sync_state add column if not exists full_pass_cursor jsonb;      -- {from, to, cursor, pages} of the pass in progress
alter table public.crm_sync_state add column if not exists full_pass_pages_last integer; -- pages the last finished pass took (for "pages left")

insert into public.schema_migrations (name) values ('036_crm_sync_progress.sql') on conflict do nothing;
