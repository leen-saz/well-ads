-- 028: the Apipeline site moved to its own repo (leen-saz/pipeline) with its own Supabase project, so Well no longer
-- keeps the website requests. 027 stays as it was (merged migrations never change); this removes what it created.
-- 027 was never applied in production, so there is nothing to keep; on a database where it was, any rows go with it.
drop table if exists public.site_requests;
