# Plan progress

Source: `docs/plan.md`. Updated with every PR.

| Phase | Status | Notes |
|---|---|---|
| 0 Foundation | done | PRD, plan and ADRs merged (old repo #44). ADR-0005: GitHub Free |
| 1 Skeleton and CI | done | #1, #2, #4. Staging: https://well-ads-staging.leen-b9b.workers.dev |
| 2 Auth and permissions | in progress | 2.1 API + gateway + tests, 2.2 pages |
| 3 to 8 | not started | |

## Waiting on Leen
- `production` environment limited to `main` (Settings → Environments). The session cannot change environment settings.
- Supabase access from Workers: REST with the service key (suggested) or Hyperdrive.
- Phase 2 secrets on staging (names only): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, `OWNER_EMAIL`.
