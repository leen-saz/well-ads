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
| 10 | `024_video` | `companies`, `ai_usage` (019); it also locks the `video` module for every company once |

Rules going forward:

- New files take the next free number (019, 020, …). A duplicate number fails `tests/unit/migrations.test.ts`; the three
  existing pairs are the only ones allowed, because renaming applied files would break the "already applied" record.
- A file never depends on a same-numbered sibling.
- Tables read by every company must carry `company_id`. `ads.ad_key` is still the global primary key and `ad_metrics`
  has no company column; the routes that read `ad_metrics` (design, copy, debugger) are safe only because they join on
  the company's own `ad_key`s. Per-company ad keys (ADR-0006) must add `company_id` to `ad_metrics` first.
- `control_settings`, `suggestions`, `outcomes`, `platform_activity` and `connections` have no company column, so the
  Control and Connectors routes are Well-only in code (`requireUser(..., { well: true })`).
