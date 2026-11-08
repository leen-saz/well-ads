# Data dictionary and schema audit

Audited 2026-11-06 against `supabase/migrations/000`–`018` (+ the new `021`). Source of truth is the SQL; a unit test
(`tests/unit/migrations-rls.test.ts`) fails if a table is created without RLS, without being revoked from `anon` and
`authenticated`, without `company_id` (unless listed as global on purpose), or without a row in this file.

How data is reached: the Worker and the pipeline use the **service role** (bypasses RLS). Nothing uses the public
(`anon`) key, and the only call made with a user's token is `/auth/v1/user` (password change). So every table should be
closed to `anon` and `authenticated`: RLS on, no policy, and the grants revoked (defence in depth).

## Audit findings

| # | Finding | Fix |
|---|---|---|
| 1 | `ads`, `ad_metrics`, `dashboard_state` had `select using (true)` policies **for anon** plus `grant select` (000_base.sql). Anyone with the project's public key could read ad names, spend and metrics through Supabase directly. Nothing in the code needs it. | `021_lock_down_anon.sql` drops the policies and revokes. |
| 2 | 12 tables never revoked the default grants (`profiles`, `audit_log`, `suggestions`, `control_settings`, `platform_activity`, `outcomes`, `lessons`, `journeys`, `journey_runs`, and the three above). RLS with no policy already denies them, so this is defence in depth. | Same migration: `revoke all on all tables/sequences in schema public` + default privileges for future tables. |
| 3 | `crm_leads` is read by `company_id` + `created_at` (diagnostic, debugger) with no index covering both. | `crm_leads_company_created_idx` in 021. |
| 4 | `supabase/backup.py` backs up 10 tables. Not covered: `crm_leads` (rebuildable from the CRM), `knowledge`, `brand_assets`, `copy_projects`, `motion_*`, `social_posts`, `journeys`, `content_plans`, `listen_*`, `companies`, `connections`. `knowledge`, `brand_assets`, `social_posts`, `journeys`, `copy_projects`, `motion_*` hold human-written work that cannot be rebuilt. | Not changed here. Add them to `TABLES` (separate PR). |
| 5 | `suggestions`, `control_settings`, `outcomes`, `platform_activity`, `ad_metrics`, `dashboard_state`, `crm_sync_state` have no `company_id`. Control and the ads pipeline are Well-only today (see the tenant-wall review); a second company with ads would need `company_id` on these. | Listed as global on purpose in the test; revisit when a second company gets ads. |
| 6 | `ads`, `crm_leads`, `audit_log`, `connections` carry `company_id` **without** a foreign key to `companies` (added later with `add column`, or pipeline-written), so they can hold a company that was deleted. | The data-health page counts these (`/maestro/health/`, «اليتيم»). |
| 7 | Duplicate migration numbers: `011_crm_leads`/`011_modules`, `013_listening`/`013_social_approver`, `014_knowledge`/`014_lessons_by_tab`. They touch different tables and do not depend on each other, so either order works; always refer to them by file name. | Apply order below. |

## Migrations

Apply in this order (each is idempotent: `if not exists` / `drop ... if exists`). The data-health page lists the ones
Supabase has not applied, by probing every table and column the code reads (`src/modules/maestro/schema.ts`).

`000_base` → `001_control` → `002_departments` → `003_phase_a` → `004_learning` → `005_connectors` → `006_companies` →
`007_social` → `008_journeys` → `009_content_agent` → `010_maestro` → `011_crm_leads` → `011_modules` → `012_access_levels` →
`013_listening` → `013_social_approver` → `014_knowledge` → `014_lessons_by_tab` → `015_copy` → `016_brand_assets` →
`017_knowledge_brand_source` → `018_motion_videos` → **`021_lock_down_anon`** (new; `019_ai_usage` and `020_library` from other PRs come before it).

I cannot see Leen's Supabase, so which of these are already applied is not known from the repo. All of 000–018 are read
by code that is live on main; open «المدير ← صحة الداتا ← المايقريشنات» to see the exact list that is missing.
`017` only widens a CHECK constraint (`knowledge.source` accepts `brand_file`), which a read cannot detect: run it if
`014_knowledge` was applied before it.

## Tables

`company_id` = rows are per company. After 021 every table is: RLS on, no policy, revoked from anon/authenticated.

| Table | Migration | Owner | `company_id` | Columns | Retention |
|---|---|---|---|---|---|
| `ads` | 000 (+006) | pipeline (`supabase_store`) → analytics, debugger | yes, no FK | ad_key PK, platform, name, campaign, ad_group, format, status, live, goal, preview_url, video, link, doc, updated_at | Forever. Ads that stopped delivering stay for history. |
| `ad_metrics` | 000 | pipeline | no (global; keyed by ad_key, cascades with the ad) | ad_key, day, spend, impressions, clicks, leads, conversations | Forever (small: one row per ad per day). Revisit past ~2M rows. |
| `dashboard_state` | 000 | pipeline | no | id=1, doc, updated_at | Single row, overwritten. |
| `profiles` | 001 (+002, 006, 012) | auth / admin | yes (FK) | id, email, name, role, dashboards, departments, access, active, created_at | Forever. Deactivate (`active=false`), never delete. |
| `audit_log` | 001 (+006) | auth, every module | yes, no FK | id, at, user_id, email, action, target, before, after, note, result | Append-only, never edited. Keep 24 months, then archive; do not delete earlier. |
| `suggestions` | 001 (+003) | control | no (Well-only) | id, created_at, platform, level, target_id, kind, params, status, decided_by, result, before, after, risk, expect, critic … | Forever (the learning loop reads them). Expire `open` ones (`status=expired` is already a state). |
| `control_settings` | 001 | control | no | platform PK, mode, guardrails, updated_by | One row per platform. |
| `platform_activity` | 004 | pipeline (Meta/Google activity feed) | no | id, platform, event_id, at, actor, event, object_*, detail | 12 months is enough; older rows are not read. |
| `outcomes` | 004 | control learning loop | no | id, suggestion_id (FK), day (3/7), metrics, vs_expect | Forever (tiny). |
| `lessons` | 004 (+014) | learning loop, every tab | yes (FK) | id, platform, kind, lesson, evidence, confidence, block, active, module, status, source, decided_by | Forever; set `active=false`/`ignored` instead of deleting. |
| `connections` | 005 (+006) | connectors | yes, no FK | platform PK, method, names, shown, connected_by, connected_at, expires_at, checked. Secret values live in Supabase Vault, never here. | Forever; one row per platform. |
| `companies` | 006 (+010, 011_modules, 013_social_approver) | tenant | n/a (is the company) | id, slug, name, plan, active, paperclip_company_id, disabled_modules, social_approvers | Forever. |
| `social_posts` | 007 | social | yes (FK) | id, platforms, body, media, publish_at, mode, status, approved_by, results … | Keep published/failed 12 months; drafts never deleted automatically. Media in R2 `social/<company>/`: delete the file with the post. |
| `journeys` | 008 | journeys | yes (FK) | id, name, trigger, steps, mode, active … | Forever. |
| `journey_runs` | 008 | journeys | yes (FK) | id, journey_id, contact, status, log, started_at | `contact` is personal data: expire runs after 90 days. |
| `content_plans` | 009 | content | yes (FK) | id, site, niche, competitors, analysis, items, engine … | Keep the last 20 per company; older ones can expire. |
| `crm_leads` | 011_crm_leads | pipeline/crm (`fetch.py`, `join.py`), maestro health, debugger | yes, no FK | lead_id PK, customer_id, created_at, updated_at, source_platform, ad_id(+quality), status, crm_stage, booking_*, amount_paid_sar, paid_at, payment_status, doc (full CRM row), synced_at. Pseudonymous: no names, phones or emails. | Forever (it is the revenue history; the CRM remains the master and the daily 92-day re-pull keeps it fresh). |
| `crm_sync_state` | 011_crm_leads | pipeline/crm | no | id=1, last_updated_at, last_run_at, rows_last_run | Single row. |
| `listen_watch` | 013_listening | listening | yes (FK) | id, kind, name, keywords, links, fetched_at | Forever. |
| `listen_mentions` | 013_listening | listening | yes (FK, cascade with the watch) | id, watch_id, source, url, title, snippet, author, published_at, sentiment, fetched_at; unique (company_id, url) | Third-party text and author names: expire after 12 months. |
| `knowledge` | 014 (+017) | knowledge | yes (FK) | id, kind, title, body, price, modules, active, source, topic, question … | Forever; deactivate instead of delete (the log is the point). |
| `copy_projects` | 015 | copy | yes (FK) | id, name, service, audience, offer, cta, voice, banned, competitors … | Forever. |
| `brand_assets` | 016 | knowledge (brand) | yes (FK) | id, kind, title, r2_key, mime, size, value, active … | Forever; files in R2 `brand/<company>/`. |
| `motion_projects` | 018 | design (video) | yes (FK) | id, title, headline, script, ratio, design_key, voice_key, status, approved_version … | Draft projects expire after 30 days (PRD: uploaded design/voice files after 30 days); approved ones stay. |
| `ai_usage` | 019 | llm.ts (every model call) → maestro spend screen | yes (FK) | id, user_id, module (tab), provider, model, tokens_in, tokens_out, cost_usd, cost_sar, usd_sar, priced, estimated, created_at. No prompt, answer or email. | Keep 24 months, then archive; the owner's invoice check reads it. |
| `ai_budgets` | 019 | maestro (owner only) | yes (FK) | company_id + module PK, monthly_cap_usd (null = no cap, no default), alert_at_pct, updated_by | One row per company and tab. |
| `library_items` | 020 | shared library (copywriter and the other tabs) | yes (FK) | id, module, kind, title, content, platform, service, compliance_result, review_status, reviewed_by, approved_by, created_by, created_by_id | Forever; the owner edits and approves. Deleting is not offered yet. |
| `library_favorites` | 020 | shared library | yes (FK) | item_id + user_id PK, created_at | Goes with its item (cascade). |
| `web_vitals` | 022 | vitals beacon (`/api/vitals/report`) → data-health «الأداء» card | no (global: page path and timings only, no user, no company) | id, at, path (ids collapsed to `:id`), lcp, inp, cls, ttfb, mobile | 7 days: rows older than that are deleted when the owner opens the card. |
| `transcribe_jobs` | 023 | transcribe | yes (FK) | id, title, purpose, mime, bytes, seconds, r2_key, status, step, steps, attempts, gemini_file, gemini_uri, segments, result, error, locked_until | The original file is deleted (R2 and Google) when the job ends, only the text stays; failed and finished jobs keep their text. |
| `vision_analyses` | 024 | vision | yes (FK) | id, title, file_hash (unique per company), mime, result, compliance_result, library_id. The image itself is never stored. | Forever (text only); the owner can ask to clear. |
| `voiceover_settings` | 025 | voiceover | yes (FK, one row per company) | company_id PK, voice, accent, tone, pace, updated_by | Forever (one row). The audio itself is never stored. |
| `motion_versions` | 018 | design (video) | yes (FK) | id, project_id, version, parent_version, change_request, spec, engine, model | Never edited; goes with its project. |

## Indexes against the queries the code makes

Covered: ads by company/platform; ad_metrics by day and by (ad_key, day) PK; audit_log by (company, at); crm_leads by
`updated_at`, `created_at`, (source_platform, ad_id), and now (company, created_at); social posts by (company,
publish_at) and due; listening, knowledge, brand, copy, motion and lessons all by (company, …). Reads of `crm_leads` for
the dashboard load the whole table in 1000-row pages ordered by `lead_id` (primary key): fine up to tens of thousands of
leads. Nothing else needed today.

## Files (R2)

| Prefix | What | Retention |
|---|---|---|
| `site/` | built analytics pages and `dash.json`, rebuilt hourly | overwritten |
| `social/<company>/` | post media | with the post |
| `brand/<company>/` | logos, fonts, guide, references | forever |
| `motion/<company>/` | uploaded design image and voice for video projects | 30 days for drafts (needs a lifecycle rule on the bucket; not set up yet) |
