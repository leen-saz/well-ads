# Migrations: apply order

Files in `supabase/migrations/` are applied **in file-name order** (what CI does against a throwaway Postgres, and what
the SQL Editor run should follow). Every file is idempotent (`if not exists`, `add column if not exists`).

Numbers 011, 013 and 014 exist twice. They were written in parallel and each pair is independent: no file of a pair
reads or alters what the other creates, so either order gives the same schema. Keep the alphabetical order:

| order | file | needs |
|---|---|---|
| 1 | `000_base` … `010_maestro` | one after the other |
| 2 | `011_crm_leads` | `companies` (006) |
| 3 | `011_modules` | `companies` (006) |
| 4 | `012_access_levels` | `profiles` |
| 5 | `013_listening` | `companies` |
| 6 | `013_social_approver` | `companies`, `social_posts` (007) |
| 7 | `014_knowledge` | `companies` |
| 8 | `014_lessons_by_tab` | `lessons` (004), `companies` |
| 9 | `015_copy` … `018_motion_videos` | one after the other |

Rules going forward:

- New files take the next free number (019, 020, …). A duplicate number fails `tests/unit/migrations.test.ts`; the three
  existing pairs are the only ones allowed, because renaming applied files would break the "already applied" record.
- A file never depends on a same-numbered sibling.
- Tables read by every company must carry `company_id`. `ads.ad_key` is still the global primary key and `ad_metrics`
  has no company column; the routes that read `ad_metrics` (design, copy, debugger) are safe only because they join on
  the company's own `ad_key`s. Per-company ad keys (ADR-0006) must add `company_id` to `ad_metrics` first.
- `control_settings`, `suggestions`, `outcomes`, `platform_activity` and `connections` have no company column, so the
  Control and Connectors routes are Well-only in code (`requireUser(..., { well: true })`).

## Which migrations are applied (tracking from 033)

`033_schema_migrations.sql` creates `public.schema_migrations (name, applied_at)`. From 033 on, **every migration ends with**

```sql
insert into public.schema_migrations (name) values ('NNN_name.sql') on conflict do nothing;
```

(a test fails if a new file forgets it). `/api/health` then returns `migrations`:

| state | meaning |
|---|---|
| `ok` | every tracked file has a row |
| `missing` | `missing` lists the file names with no row: apply them in the SQL editor |
| `untracked` | `033` itself is not applied yet (run it first) |
| `unknown` | the table could not be read (a Supabase problem, not a missing migration) |

Files up to `032_buyer_actions.sql` predate the table and are not checked there: «المدير ← صحة الداتا ← المايقريشنات» probes
their tables and columns instead. To record them too (optional, for the record only), run once after 033, listing only the
ones you know are applied:

```sql
insert into public.schema_migrations (name) values
  ('000_base.sql'), ('001_control.sql') -- … one per applied file
on conflict do nothing;
```

**Failing the production deploy.** By default a missing migration is only reported (the site keeps deploying). Setting
the Worker variable `MIGRATIONS_STRICT` to `1` (Cloudflare ← Workers ← well-ads ← Settings ← Variables) makes `/api/health`
return `ok: false` while any tracked migration is missing or `033` is not applied, and the deploy check in
`deploy.yml` already fails on `ok: false`. Turn it on only after 033 and everything after it are applied, otherwise the
next deploy fails.
