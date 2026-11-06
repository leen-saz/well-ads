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

## Settings only the repository owner can change
- **Branch protection / rulesets on `main`**: add the status check `smoke` (the job of `.github/workflows/smoke.yml`) next to `ci / gate`, so a PR cannot merge with a red smoke run.
  The deploy workflow already needs it: `deploy` calls `smoke.yml` through `workflow_call` and `needs: [ci, smoke]`, no setting required.
- **Environment `production`** (Settings → Environments): keep "Deployment branches: main only" and required reviewers; `rollback.yml` uses the same environment.
- **Code security**: turn on Dependabot security alerts (currently disabled).

## Test artifacts are public
Failed smoke runs upload `test-results/` (the repo is public). The suite uses synthetic accounts (`*@example.test`), a fake Supabase and synthetic pages only;
traces, screenshots and videos are switched off in `playwright.smoke.config.ts`, so the artifact holds only text error context of those synthetic pages.
Never point the suite at staging or production, and never add real data to `tests/smoke/`.
