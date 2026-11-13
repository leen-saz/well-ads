# Production runbook

Production is deployed by hand (ADR-0005): Actions → **deploy** → Run workflow → `production`, through the protected
`production` environment (main only). Staging deploys by itself on every push to `main`. Rolling back takes about one minute.

## Before you deploy (2 minutes)
1. **Staging is on the commit you want.** `main` has a green `ci` and `smoke` run and a green staging deploy (Actions → deploy → the push run).
   Open `https://well-ads-staging.<account>.workers.dev/api/health`: `version` is that commit's SHA and `ok` is `true`.
2. **Look at staging by hand** with the owner login: the start page, one tab you changed, the sidebar. The smoke suite does not see
   figures, layout or anything behind a real model or connector (`docs/smoke-tests.md`, "What it does not cover").
3. **Database migrations.** If the release adds files under `supabase/migrations/`, apply them to the production Supabase project
   (SQL Editor) **before** deploying, and only if the *previous* version still works with the new schema (add columns and tables,
   never drop or rename in the same release). Migrations are not rolled back with the Worker.
4. **Secrets and variables.** A new secret named in the release goes into Cloudflare → Workers → well-ads → Settings first
   (`docs/secrets/worker.env.example` lists them). `/api/health` shows `supabase: down` if the Supabase ones are wrong.
5. Write down the current version for a rollback: `npx wrangler deployments list --env production` (top line = live version id), or the
   last "deploy" run's summary.

## Deploy
Actions → **deploy** → Run workflow → branch `main`, target `production` → approve the `production` environment.
The run does, in order: `ci` (lint, typecheck, unit, integration, build, migrations, security) → `smoke` (end-to-end on this commit) → deploy →
**health check**. The job is green only when `https://<production link>/api/health` answers 200 with `version` equal to the deployed commit
and every dependency `up`. A red health step means the version is live but wrong: roll back now (below), then investigate.

## After you deploy (3 minutes)
- `/api/health`: `version` = the commit, `env` = `production`, `checks.supabase` / `checks.storage` = `up`.
- Sign in as the owner: start page loads, sidebar shows every tab, open two tabs you did not change.
- Cloudflare → Workers → well-ads → Logs: no burst of errors after the deploy time.
- Cron: the next `*/5` run is not erroring (`scheduled` events in the same logs).
- Watchdog (hourly Cron trigger, minute 7, `src/lib/watchdog.ts`): alerts when `dash.json` is older than 3 hours, repeats at most every 6 hours, and says once when it recovers. Channels are the Worker secrets `ALERT_WEBHOOK_URL` and/or `RESEND_API_KEY` + `ALERT_EMAIL_FROM` + `ALERT_EMAIL_TO` (`docs/secrets/worker.env.example`). With none set it only logs: set one, or nobody is told. Its state is `site/watchdog-state.json` in R2.

## Roll back (under 5 minutes)
Decide fast: if the health step is red, or a tab people use is broken, roll back first and debug after.

**Fastest, from the browser (about 1 minute):** Actions → **rollback** → Run workflow → leave *version* empty (= the previous version)
→ write the reason → approve the `production` environment. It prints the version list before and after. Then check `/api/health`:
`version` is the older commit's SHA.

**From a terminal (same result):**
```bash
npx wrangler deployments list --env production          # newest first: pick the version id before the bad one
npx wrangler rollback <version-id> --env production --message "rollback: <reason>" --yes
curl -s https://<production link>/api/health            # version is the older commit
```
Notes
- A rollback restores the Worker code **and its variables** of that version (including `BUILD_VERSION`). It does not touch Supabase or R2.
- Secrets are not versioned: a bad secret change is fixed by setting it back in Cloudflare, not by rolling back.
- If a migration in the bad release was already applied and the old code cannot work with it, fix forward: write a migration that makes
  the schema work for the old code, apply it, then roll back.
- The Pages link only forwards to the Worker (`proxy/`); it needs no rollback.
- After a rollback `main` still has the bad commit: revert it (`git revert`) in a PR so the next deploy does not bring it back.

## If `/api/health` is red or silent
| Symptom | Likely cause | What to do |
|---|---|---|
| no answer / 5xx | bad build or runtime error at start | roll back |
| 200 but wrong `version` | deploy still propagating, or the deploy failed before the Worker step | wait one minute and re-check; else read the deploy run |
| `supabase: down` | wrong or missing `SUPABASE_*` secret, Supabase outage | check the secret; if it was the release, roll back |
| `storage: down` | R2 binding/bucket changed | check `wrangler.jsonc` bucket names and the bucket's existence |
| `ai: unset` | no Workers AI binding in this env | expected locally; production must have it |

## Google Ads in the hourly data pull (سحب البيانات)
Every Google Ads call needs these secrets in the `production` environment (Settings → Environments → production → Secrets, or `gh secret set NAME --env production`):
`GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_DEVELOPER_TOKEN`
(and `GOOGLE_ADS_LOGIN_CUSTOMER_ID` when the account sits under a manager account). Google rejects any call without the developer token.
- **Token missing:** only the google part of the pull fails. Its status in `dash.json` is `ok: false` with an Arabic message that names `GOOGLE_ADS_DEVELOPER_TOKEN`;
  Meta, Snapchat and TikTok keep working and Google keeps showing its last good figures as stale. The connectors page shows Google as not connected until the token is set.
- Explorer access on the Google Ads API is enough for reading. Nothing here changes campaigns.

## Settings only the repository owner can change
- **Branch protection / rulesets on `main`**: add the status check `smoke` (the job of `.github/workflows/smoke.yml`) next to `ci / gate`, so a PR cannot merge with a red smoke run.
  The deploy workflow already needs it: `deploy` calls `smoke.yml` through `workflow_call` and `needs: [ci, smoke]`, no setting required.
- **Environment `production`** (Settings → Environments): keep "Deployment branches: main only" and required reviewers; `rollback.yml` uses the same environment.
- **Code security**: turn on Dependabot security alerts (currently disabled).

## Test artifacts are public
Failed smoke runs upload `test-results/` (the repo is public). The suite uses synthetic accounts (`*@example.test`), a fake Supabase and synthetic pages only;
traces, screenshots and videos are switched off in `playwright.smoke.config.ts`, so the artifact holds only text error context of those synthetic pages.
Never point the suite at staging or production, and never add real data to `tests/smoke/`.

## Backups (weekly, encrypted, private)
- **What:** `db-backup` dumps every table in `supabase/backup.py` plus the Auth users, encrypts the archive (AES-256, `BACKUP_PASSPHRASE`) and stores it in the private R2 bucket `well-ads-backups` as `weekly/<date>.enc` and `latest.enc`. It is never an Actions artifact and never goes into the repo (public). Before uploading it decrypts its own file and runs the restore checks; a backup that does not open is not uploaded.
- **When:** every Sunday 02:00 UTC (the hourly Worker trigger of that hour starts it) (GitHub's own `schedule` does not fire for this repo; the workflow keeps one as a second path). Run now: Actions → **db-backup** → Run workflow.
- **Restore test (monthly):** `db-restore-test` runs on the 1st at 03:00 UTC (after a backup could have run that day): downloads `latest.enc`, decrypts it with the passphrase, and checks `supabase/backup_check.py` (fresh within 9 days, every table file equals its manifest, core tables not empty, migrations included). The log has table names only. A red run = the backup cannot be trusted: fix the same day.
- **Quarterly drill (by hand, 30 min):** create a scratch Supabase project, run `supabase/migrations/*.sql` in order, then load the `backup/<table>.json` files with the service key, and open the app against it. Delete the scratch project after. Record the date here: _not done yet_.
- **Retention:** 90 days, enforced by a bucket lifecycle rule (so the weekly files of the last ~13 weeks stay). Keep your own offline copy of the passphrase: without it nothing opens.
- **One-time setup (Leen):** (1) create the bucket `well-ads-backups` in Cloudflare R2 and keep it private (no public domain, no `r2.dev` URL, no Worker binding); (2) `npx wrangler r2 bucket lifecycle add well-ads-backups expire-90d --expire-days 90`; (3) make sure the production environment has `BACKUP_PASSPHRASE`, `CLOUDFLARE_API_TOKEN` (R2 write on that bucket) and `CLOUDFLARE_ACCOUNT_ID`; (4) run **db-backup** once by hand, then **db-restore-test**, and expect both green.
- **Decrypt by hand:** `npx wrangler r2 object get well-ads-backups/latest.enc --file backup.enc --remote`, then `openssl enc -d -aes-256-cbc -pbkdf2 -in backup.enc | tar xz`.

## Cron triggers (limit: 5 per account on Workers Free)
This Worker has two: `*/5 * * * *` (due social posts, listening, transcription) and `7 * * * *` (hourly). The hourly one runs, by the scheduled time in UTC (`hourlyTasks` in `src/lib/cron.ts`): the data refresh dispatch and the watchdog every hour, the backup on Sunday at 02, and the restore test on the 1st at 03. A new periodic job goes into `hourlyTasks`, not into a new trigger: a deploy with more than the account allows fails (code 10072) and leaves the triggers half-updated. `tests/unit/cron-syntax.test.ts` keeps it at 3 or fewer.
