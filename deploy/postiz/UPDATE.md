# Updating Postiz (on purpose, never automatically)

The images in `docker-compose.yaml` are **pinned to exact versions**. Nothing updates by itself: never use `latest`, never run Watchtower or
similar. Postiz releases often (v2.25.0 on 2026-10-02, v2.25.3 on 2026-10-24) and its own docs say the compose file and variables change
between releases.

Update when: a security fix is announced, a platform changes its API and posting breaks, or every ~2 months. Otherwise leave it.

## Procedure (about 20 minutes, do it when nothing is scheduled to publish in the next hour)

- [ ] 1. **Read the release notes** of every version between yours and the target: https://github.com/gitroomhq/postiz-app/releases
  Look for words like "migration", "breaking", "env", "Temporal". If a release asks for new environment variables or a changed compose
  file, stop and tell the developer: compare with the official file https://github.com/gitroomhq/postiz-docker-compose (`git diff` between
  the commit noted at the top of our `docker-compose.yaml` and the new one).
- [ ] 2. **Check the new tag exists** and is not a pre-release (the Releases page above). Pick an exact tag like `v2.26.0`.
- [ ] 3. **Snapshot** so you can go back in minutes:
  1. In the VM provider's console take a snapshot of the whole server (Hetzner: Servers → your server → Snapshots → Take snapshot, about €0.01/GB/month; delete it a week later).
  2. Run a fresh backup and confirm it reached the off-site storage: `cd /opt/postiz && ./backup/backup.sh` ends with `done, copied to the off-site remote`.
  3. Write the **current** image tag down (`grep 'postiz-app:' docker-compose.yaml`).
- [ ] 4. Change the tag in `docker-compose.yaml` (only the `postiz` image line, one version at a time; do not jump several majors at once).
- [ ] 5. `docker compose pull postiz && docker compose up -d`. Watch `docker compose logs -f postiz` for 2 to 3 minutes. Errors about the database
  or Temporal at startup are the sign of a migration problem: go to Rollback.
- [ ] 6. Check: log in; the three channels are still listed and not marked "disconnected"; on the Social tab of Well Ads press
  **"Check the service and accounts"**: reachable, key valid, three platforms connected.
- [ ] 7. Do **one real test post** to a test account (see section 6 of docs/postiz-setup.md). Only then are you done.
- [ ] 8. Commit the new tag in this repo (`deploy/postiz/docker-compose.yaml`) through a PR, and note the date in your own log.

## Rollback
1. If it broke right away and nothing was posted: put the old tag back, `docker compose up -d`. A newer version may have changed the database
   shape, so if it still fails go to 2.
2. Restore the VM snapshot from step 3 (provider console → Rebuild from snapshot). This brings back files, volumes and databases exactly as
   before the update. Anything created after the snapshot is lost (usually nothing).
3. If the snapshot is gone, restore the nightly backup following `RESTORE-TEST.md`, on a new server, then move the DNS record.

## Other pinned parts
`caddy`, `postgres`, `redis`, `elasticsearch` and the `temporalio/*` images are pinned too. Change them only when Postiz's release notes
or the official compose file say so (Temporal and Elasticsearch in particular have to match each other). Postgres major versions
(17 → 18) are **not** an in-place upgrade: they need a dump and restore; ask the developer.
