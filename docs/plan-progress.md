# Plan progress

Source: `docs/plan.md`. Updated with every PR.

| Phase | Status | Notes |
|---|---|---|
| 0 Foundation | done | PRD, plan and ADRs merged (old repo #44). ADR-0005: GitHub Free |
| 1 Skeleton and CI | done | #1, #2, #4. Staging: https://well-ads-staging.leen-b9b.workers.dev |
| 2 Auth and permissions | done (awaiting Leen's OK) | #6 to #11. Owner login verified on staging 2026-11-01; Supabase over REST with the secret key |
| 3 to 8 | not started | |

## Waiting on Leen
- OK on phase 2 before phase 3 (data pipeline) starts.
- `production` environment limited to `main` (Settings → Environments). The session cannot change environment settings.
- Delete the temporary branches `diag/blocked` and `diag/login` (the session's git proxy refuses branch deletes).

## Decisions
- Supabase stays on the Well project. Workers and GitHub reach it over HTTPS, so the separate account does not matter, and Vault secrets are encrypted per project and would not move.
- Supabase access from Workers: REST with the secret key (Hyperdrive not needed so far).
