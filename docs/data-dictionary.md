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
| `social_posts` | 007 | social | yes (FK) | id, platforms, body, overrides (text per platform, 040), media, publish_at, mode, status, approved_by, results … | Keep published/failed 12 months; drafts never deleted automatically. Media in R2 `social/<company>/`: delete the file with the post. |
| `journeys` | 008 | journeys | yes (FK) | id, name, trigger, steps, mode, active … | Forever. |
| `journey_runs` | 008 | journeys | yes (FK) | id, journey_id, contact, status, log, started_at | `contact` is personal data: expire runs after 90 days. |
| `content_plans` | 009 | content | yes (FK) | id, site, niche, competitors, analysis, items, engine … | Keep the last 20 per company; older ones can expire. |
| `crm_leads` | 011_crm_leads | pipeline/crm (`fetch.py`, `join.py`), maestro health, debugger | yes, no FK | lead_id PK, customer_id, created_at, updated_at, source_platform, ad_id(+quality), status, crm_stage, booking_*, amount_paid_sar, paid_at, payment_status, doc (full CRM row), synced_at. Pseudonymous: no names, phones or emails. | Forever (it is the revenue history; the CRM remains the master and the daily 92-day re-pull keeps it fresh). |
| `crm_sync_state` | 011_crm_leads, 036_crm_sync_progress | pipeline/crm | no | id=1, last_updated_at, last_run_at, rows_last_run, last_full_pass_at, full_pass_cursor, full_pass_pages_last (036) | Single row. The daily 92-day pass resumes across hourly runs through full_pass_cursor. |
| `listen_watch` | 013_listening | listening | yes (FK) | id, kind, name, keywords, links, fetched_at | Forever. |
| `listen_mentions` | 013_listening | listening | yes (FK, cascade with the watch) | id, watch_id, source, url, title, snippet, author, published_at, sentiment, fetched_at; unique (company_id, url) | Third-party text and author names: expire after 12 months. |
| `knowledge` | 014 (+017) | knowledge | yes (FK) | id, kind, title, body, price, modules, active, source, topic, question … | Forever; deactivate instead of delete (the log is the point). |
| `copy_projects` | 015 | copy | yes (FK) | id, name, service, audience, offer, cta, voice, banned, competitors … | Forever. |
| `brand_assets` | 016 | knowledge (brand) | yes (FK) | id, kind, title, r2_key, mime, size, value, active … | Forever; files in R2 `brand/<company>/`. |
| `motion_projects` | 018 | design (video) | yes (FK) | id, title, headline, script, ratio, design_key, voice_key, status, approved_version … | Draft projects expire after 30 days (PRD: uploaded design/voice files after 30 days); approved ones stay. |
| `ai_usage` | 019 | llm.ts (every model call) → maestro spend screen | yes (FK) | id, user_id, module (tab), provider, model, tokens_in, tokens_out, cost_usd, cost_sar, usd_sar, priced, estimated, created_at. No prompt, answer or email. | Keep 24 months, then archive; the owner's invoice check reads it. |
| `ai_budgets` | 019 | maestro (owner only) | yes (FK) | company_id + module PK, monthly_cap_usd (null = no cap, no default), alert_at_pct, updated_by | One row per company and tab. |
| `ai_routes` | 029 | maestro (owner only) | yes (FK) | company_id + task PK, provider (openai, xai, openrouter, workers), model id, updated_by | One row per company and task. No row = the task keeps its default provider (docs/ai-providers.md). |
| `campaigns` | 030 | أحلم (today) | yes (FK) | id uuid, title, wishes, brief, status (draft, planned, approved, running, review, done, cancelled), estimate_usd, approved_by/at | One row per campaign wish. Never touches an ad account. Keep 12 months. |
| `campaign_tasks` | 030 | أحلم (today) | yes (FK) | campaign_id, position, agent, title, spec, depends_on, status (waiting, running, review, approved, blocked, failed), blocked_reason, estimate_usd | Deleted with its campaign. |
| `campaign_outputs` | 030 | أحلم (today) | yes (FK) | campaign_id, task_id, kind, platform, body, compliance | What the agents wrote (copy, briefs, plans), with the compliance result. Deleted with its campaign. |
| `buyer_outcomes` | 035 | buyer outcomes (نتيجة كل إجراء بعد 3 و7 أيام) | yes (FK) | action_id, day (3/7), platform, rec_rule, kind, before/after (cpl, ctr, spend, leads, impr), result | Forever; numbers only, no campaign names (the name is read from buyer_actions). |
| `buyer_actions` | 034 | buyer (الميديا باير) | yes (FK) | platform, level, entity_id, entity_name, rec_id, kind, change (from/to), reason, risk, mode (auto/manual), status (proposed, rejected, applying, applied, failed, aborted, rolled_back, manual_done), idem_key, decided_by, dry_run, result, applied_at | Forever (it is the executor's own record, next to `audit_log`). No keys and no platform error text: ids, numbers and short codes only. |
| `account_health` | 039 | connectors (صحة الحسابات) | yes (FK) | company_id, platform, account_ref (PK); status (ok, degraded, expiring, disconnected), probed, last_check_at, first_failed_at, grace_until, error_code, expires_at, alerted_status | One row per connected account, overwritten every check. No keys, no account names, no platform message: a short code only. |
| `mcp_events` | 043 | Well MCP events (src/mcp/events.ts) | yes (FK) | type (post.published, ad_action.applied, account.disconnected…), data (ids, platforms, codes only), created_at | Kept as a record of what happened; no post text, token or personal data. |
| `webhooks` | 043 | Webhooks (/api/webhooks) | yes (FK) | url (public https), types, active, created_by | Until removed by the owner. The signing secret is in the company's Token Vault, not here. |
| `webhook_deliveries` | 043 | Webhooks | yes (FK) | webhook_id, event_id (unique pair); status (pending, delivered, failed), attempts, next_at, last_code, delivered_at | Delivery attempts; removed with the webhook or the event. |
| `mcp_jobs` | 046 | Well MCP background jobs (src/mcp/jobs.ts) | yes (FK) | kind (report.performance), status (queued, running, done, failed), input, result (numbers only), error (code), actor, created_at, started_at, finished_at | 30 days; a report can be run again. |
| `auto_exclusions` | 045 | automation («تلقائي») | yes (FK) | company_id, platform, entity_id (PK); name, added_by | Until the owner removes it. Auto mode works on every campaign except these. |
| `account_permissions` | 044 | connectors (صلاحيات الكتابة) | yes (FK) | company_id, platform (PK); state (write, partial, read_only, not_connected, unknown), missing (permission names), code, checked_at | One row per connection, overwritten by the daily check. Permission names only, never a token. |
| `account_groups` | 039 | connectors (مجموعات الحسابات) | yes (FK) | name (unique per company), created_by | Until deleted by a user. |
| `account_group_members` | 039 | connectors | yes (FK) | group_id, platform, account_ref | Deleted with its group. |
| `mcp_idempotency` | 041 | Well MCP (src/mcp/call.ts) | yes (FK) | company_id, key (PK); tool, request_hash (sha256 of tool + arguments), response, created_at, expires_at | 24 hours: an expired row is ignored and can be deleted. Holds the tool's answer, never a token. |
| `social_slots` | 040 | social (مواعيد الطابور) | yes (FK) | weekday (0 = Sunday), at_local ('HH:MM', Riyadh), created_by; unique per company, day and time | Until removed by a user. |
| `library_items` | 020 | shared library (copywriter and the other tabs) | yes (FK) | id, module, kind, title, content, platform, service, compliance_result, review_status, reviewed_by, approved_by, created_by, created_by_id | Forever; the owner edits and approves. Deleting is not offered yet. |
| `library_favorites` | 020 | shared library | yes (FK) | item_id + user_id PK, created_at | Goes with its item (cascade). |
| `video_projects` | 034 | video | yes (FK) | id, title, source_url, brief, script, ratio, seconds, avatar_id, review_status, reviewed_by, approved_by, created_by … | Draft until the reviewer and then the approver pass it; nothing leaves the system before. Deleting is not offered yet. |
| `video_jobs` | 034 | video (engine layer) | yes (FK) | id, project_id, shot_no, engine, params (no keys), status, attempts, upstream_ref, result_key, error_code, est_cost_usd, cost_recorded | Goes with its project (cascade). Result files in R2 `video/<company>/`. |
| `video_settings` | 034 | video (owner only) | yes (FK, one row per company) | company_id PK, reviewers, approvers (emails of the company's users; empty = the owner only) | One row per company. |
| `web_vitals` | 022 | vitals beacon (`/api/vitals/report`) → data-health «الأداء» card | no (global: page path and timings only, no user, no company) | id, at, path (ids collapsed to `:id`), lcp, inp, cls, ttfb, mobile | 7 days: rows older than that are deleted when the owner opens the card. |
| `schema_migrations` | 033 | /api/health (`src/lib/health.ts`) | no (global: file names only) | name PK, applied_at. Each migration from 033 on ends by inserting its own file name. | Forever (tiny). |
| `site_requests` | 027, dropped in 028 | none: the Apipeline site and its request form moved to leen-saz/pipeline | no (global) | (none) | Dropped by 028. |
| `transcribe_jobs` | 024 | transcribe | yes (FK) | id, title, purpose, mime, bytes, seconds, r2_key, status, step, steps, attempts, gemini_file, gemini_uri, segments, result, error, locked_until | The original file is deleted (R2 and Google) when the job ends, only the text stays; failed and finished jobs keep their text. |
| `vision_analyses` | 025 | vision | yes (FK) | id, title, file_hash (unique per company), mime, result, compliance_result, library_id. The image itself is never stored. | Forever (text only); the owner can ask to clear. |
| `voiceover_settings` | 026 | voiceover | yes (FK, one row per company) | company_id PK, voice, accent, tone, pace, updated_by | Forever (one row). The audio itself is never stored. |
| `motion_versions` | 018 | design (video) | yes (FK) | id, project_id, version, parent_version, change_request, spec, engine, model | Never edited; goes with its project. |

## Ad delivery fields (dash.json `ads`)

`live` means **switched on** (ad, ad group/squad/ad set and campaign all on), exactly as computed before the delivery layer. The decision board, the media buyer rules and the counts read it. The delivery layer (`pipeline/delivery.py`) only **adds** fields and never touches `live` or `status`. It is computed in the pipeline on every refresh and is not stored in Supabase (the `ads` table keeps `live`), so a database-only read falls back to `live`.

The verdict comes **only from the platform's own API fields**. Spend never decides it.

| Field | Values | Meaning |
|---|---|---|
| `delivery` | `delivering`, `rejected`, `in_review`, `scheduled`, `ended`, `budget`, `off`, `unknown` | `delivering` = the platform says nothing blocks it. `off` = switched off (or an ancestor is). `unknown` = the field needed for the verdict could not be read for this ad (reason «ما قدرنا نقرأ الحالة من المنصة»): not a guess, not `off`. `rejected`/`in_review` can also be on a switched-off ad. |
| `delivery_reason` | fixed Arabic set (`REASON` in `delivery.py`), or the platform status word for `off` | Hover text and the line under the badge. Empty for `delivering`. |
| `delivery_days_no_spend` | integer | **Secondary note only** («بدون صرف من N أيام»): switched on, and no spend or impressions from today-2 to today. Days since the last spend, or 3 when none is recorded. Never changes `delivery`. Not set for ads created or switched on in the last 24 hours, or for a platform whose refresh failed. |
| `fresh_at` | ISO time | Created or switched on within 48 hours (or first seen by the pipeline); exempts the ad from the note for 24 hours. Dropped after 48 hours. |

Exact field and value mapping per platform (same text as the docstring in `delivery.py`; tests in `pipeline/tests/test_delivery.py` use these value names):

| Platform | Fields | Mapping |
|---|---|---|
| Meta (Graph v23) | ad `effective_status`; ad set and campaign `effective_status`, `start_time`, `end_time`/`stop_time`, `lifetime_budget`, `budget_remaining` (a separate optional call) | `DISAPPROVED`→rejected; `PENDING_REVIEW`, `IN_PROCESS`→in_review; `PREAPPROVED`→scheduled; `ACTIVE`→ requires ad set and campaign `ACTIVE` (else off), then `start_time` in the future→scheduled, `end_time`/`stop_time` passed→ended, `lifetime_budget`>0 with `budget_remaining`<=0→budget, else delivering; every other status (`PAUSED`, `ADSET_PAUSED`, `CAMPAIGN_PAUSED`, `WITH_ISSUES`, `ARCHIVED`, `DELETED`…)→off. Missing status, or no schedule fields on an `ACTIVE` ad→unknown. |
| Snapchat (v1) | ad `review_status`, ad / ad squad / campaign `status`, ad squad and campaign `start_time`/`end_time` | `REJECTED`→rejected; `PENDING_REVIEW`→in_review; any of the three `status` not `ACTIVE`→off; squad then campaign `start_time` future→scheduled, `end_time` passed→ended; else delivering. No `review_status` or a missing `status`→unknown. |
| TikTok (Business API v1.3) | ad `secondary_status`; ad group `schedule_start_time`/`schedule_end_time` (confirm only) | `AD_STATUS_DELIVERY_OK`→delivering; `AD_STATUS_AUDIT`, `AD_STATUS_REAUDIT`→in_review; `AD_STATUS_AUDIT_DENY`, `AD_STATUS_REAUDIT_DENY`, `AD_STATUS_PARTIAL_AUDIT_DENY`→rejected; `AD_STATUS_NOT_START`, `AD_STATUS_SCHEDULE_NOT_START`→scheduled; `AD_STATUS_DONE`, `AD_STATUS_SCHEDULE_DONE`, `AD_STATUS_TIME_DONE`→ended; `AD_STATUS_BUDGET_EXCEED`, `AD_STATUS_CAMPAIGN_EXCEED`→budget; `*_DISABLE`, `*_DELETE`, `AD_STATUS_BALANCE_EXCEED`→off. Any other or empty value→unknown. A delivering ad whose ad group schedule has ended or not started becomes ended/scheduled. |
| Google (Ads API v24) | `ad_group_ad.policy_summary.approval_status`, `ad_group_ad.primary_status`, `campaign.primary_status`, `campaign.primary_status_reasons` (a separate optional query) | approval `DISAPPROVED`→rejected; campaign `ENDED`→ended; `PENDING`→scheduled; campaign or ad `PAUSED`/`REMOVED`→off; ad `PENDING`→in_review; campaign `ELIGIBLE`, `LIMITED`, `LEARNING`→delivering; `NOT_ELIGIBLE`→by reason (`ENDED`, `PENDING`, `DISAPPROVED`, `UNDER_REVIEW`, `BUDGET`), else unknown; `MISCONFIGURED`, missing→unknown. |

Not given by the current API versions: Snapchat and TikTok expose no remaining-budget field (so `budget` is only seen through TikTok's `secondary_status`); Google has no per-ad budget; Meta `issues_info` and Google `ad_group_ad.primary_status_reasons` are not used (no verdict hangs on them). Meta ad sets and campaigns without a `start_time` in the response give `unknown` rather than a guess.

**Guards (added after the 2026-11-20 incident).** The delivery layer only adds fields and can never change `live`, `status` or which ads exist: every platform call goes through `delivery.guarded` (an error becomes "status unknown, judge by spend"), the extra Meta and Google fields are fetched in separate optional calls so the core pulls are the same requests as before, and `fetch_data.py` refuses to write `dash.json` when switched-on ads fall by more than half versus the previous run (per platform with a successful pull, and in total) unless the run was started with `live_drop_reason` (refresh.yml input, env `LIVE_DROP_REASON`).

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
