# Plan progress

Source: `docs/plan.md`. Updated with every PR. Live since 2026-11-01: **https://well-ads.pages.dev**.

| Phase | Status | Notes |
|---|---|---|
| 0 Foundation | done | PRD, plan and ADRs (old repo #44). ADR-0005: GitHub Free |
| 1 Skeleton and CI | done | #1, #2, #4, #13 (Node 24). CI = eng-policies reusable (Node, Python, Postgres migration check) |
| 2 Auth and permissions | done | #6 to #12. Supabase over REST with the secret key |
| 3 Data pipeline | done, one item open | #14 copy, #15/#16 read-only export + covers to R2, #23. Open: PyAirbyte trial platform |
| 4 Dashboards | done (parity), split open | #17 pages built by `build.py` served from R2; #24 sidebar cache; #27 old #48/#49 ported. Open: split `template.html` into Astro pages, Playwright number parity |
| 5 Decisions board | done | #18. Executor smoke test: `execute-smoke.yml` |
| 6 Connectors | done | #19, #25 (styles). Old #47 not merged there, nothing to port yet |
| 7 Cutover | done 2026-11-01 | #21/#22 Pages proxy, #26 `refresh.yml` + `docs/cutover.md`, #29 hourly schedule. Old `refresh-and-deploy` disabled; rehearsal and first live run matched the old numbers |
| 8 Tighten | not started | After 7 days without rollback (2026-11-08): bug hunt, security review, archive old repo and Vercel |

## Running now
- `refresh.yml` hourly (minute 7, production): the only writer to Supabase.
- `pipeline.yml` hourly (minute 37, staging): read-only export.
- `deploy.yml`: staging on push to main, production manual.
- `db-backup.yml`, `execute-smoke.yml`: manual.

## Waiting on Leen
- GA4: a Web OAuth client in Google Cloud with `https://well-ads.pages.dev/api/connectors/callback`, its id/secret as Worker secrets, then Connect from the connectors tab.
- Tell Grok the cutover is done (TikTok to `leen-saz/well-ads` only).
- Send the new link to the team.

## Decisions
- Supabase stays on the Well project. Workers and GitHub reach it over HTTPS; Vault secrets are encrypted per project and would not move.
- Production link: Cloudflare Pages proxy (`proxy/`) over a service binding; the Worker has no workers.dev address.
- Supabase access from Workers: REST with the secret key (Hyperdrive not needed so far).
- New work goes to this repo only; the old repo stays frozen until it is archived.
