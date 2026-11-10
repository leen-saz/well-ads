# Postiz for Well Ads

The self-hosted Postiz that publishes our approved posts to TikTok, X and LinkedIn (engine layer: `docs/social-engine.md`).
Step by step for a non-engineer, in Arabic: **`docs/postiz-setup.md`**.

| File | What it is |
|---|---|
| `docker-compose.yaml` | Official Postiz stack (Postiz, PostgreSQL, Redis, Temporal + its PostgreSQL, Elasticsearch, admin tools, UI) with pinned images, plus Caddy for HTTPS. Only Caddy opens ports (80/443). |
| `.env.example` | Every setting with placeholders only. Copy to `.env` on the server; `.env` is never committed. |
| `Caddyfile` | Automatic HTTPS for the domain in `.env`. |
| `dynamicconfig/` | Temporal's config file, as shipped by Postiz (the compose mounts it). |
| `backup/backup.sh`, `backup/postiz-backup.cron` | Nightly encrypted backup (both databases, uploads, config, `.env`), 14 days, copied off the server. |
| `RESTORE-TEST.md` | Restore checklist. Do it before connecting any account. |
| `UPDATE.md` | Pin, snapshot, upgrade on purpose, rollback. |

Postiz is AGPL-3.0. We run it unmodified and only call its HTTP API. Nothing from Postiz's code is in this repo except the unchanged
Temporal config file and the service layout of its public compose file.

Not tested on a real server (none was available): see "ما لم نختبره" in `docs/postiz-setup.md`.
