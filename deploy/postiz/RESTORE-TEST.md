# Restore test checklist

A backup nobody has restored is a hope, not a backup. Do this **once before connecting any social account**, then again after every
Postiz upgrade and at least every 3 months. Use a **spare** server (a throwaway VM of the same size, delete it after) or your own computer
with Docker. **Never restore on top of the live server to "test".**

You need: one `postiz-YYYY-MM-DD_HHMM.tar.age` file from the off-site storage (download it from there, not from the live server, so the
off-site copy is the thing being tested) and your **age private key** (the file you kept on your own computer).

- [ ] 1. Download the newest archive and its `.sha256` from the off-site storage. `sha256sum -c postiz-*.tar.age.sha256` says `OK`.
- [ ] 2. Decrypt and unpack:
  ```bash
  mkdir restore && cd restore
  age -d -i ~/postiz-backup-key.txt ../postiz-YYYY-MM-DD_HHMM.tar.age | tar -xf -
  ls    # expect: postiz-db.dump temporal-all.sql.gz uploads.tgz config.tgz env.backup docker-compose.yaml Caddyfile images.txt
  ```
- [ ] 3. Put the files back in place on the spare machine:
  ```bash
  mkdir -p /opt/postiz && cp docker-compose.yaml Caddyfile /opt/postiz/ && cp env.backup /opt/postiz/.env
  # dynamicconfig/ comes from this repo: deploy/postiz/dynamicconfig/
  cd /opt/postiz && chmod 600 .env
  ```
  On a spare machine that is not on the real domain, edit `.env` and set `POSTIZ_DOMAIN=localhost` (Caddy then uses its own local certificate).
  **Do not point the real domain's DNS at the spare machine, and do not connect or click "Add channel" there**: the restored tokens are the live ones.
- [ ] 4. Start only the databases and restore into them:
  ```bash
  docker compose up -d postiz-postgres temporal-postgresql
  sleep 15
  docker exec -i postiz-postgres pg_restore -U postiz-user -d postiz-db-local --clean --if-exists < /path/to/restore/postiz-db.dump
  gzip -dc /path/to/restore/temporal-all.sql.gz | docker exec -i temporal-postgresql psql -U temporal -d postgres
  ```
  (Errors saying an object "does not exist" while `--clean` drops things on an empty database are normal. Errors about permissions or
  "relation already exists" are not: write them down. For the Temporal restore, "role temporal already exists" and "database ... already exists" are expected.)
- [ ] 5. Restore the volumes (create them first by starting the stack once, then stop Postiz):
  ```bash
  docker compose up -d --no-start
  docker run --rm -i --entrypoint tar -v postiz_postiz-uploads:/data postgres:17-alpine xzf - -C /data < /path/to/restore/uploads.tgz
  docker run --rm -i --entrypoint tar -v postiz_postiz-config:/data postgres:17-alpine xzf - -C /data < /path/to/restore/config.tgz
  ```
- [ ] 6. Start everything: `docker compose up -d`. Wait 2 to 3 minutes. `docker compose ps` shows every service `healthy`/`running`.
- [ ] 7. Open the spare machine's address. **Pass condition**: you can log in with the **same email and password as the real Postiz**, the
  connected channels (TikTok, X, LinkedIn) are listed, and a media file you uploaded earlier opens.
- [ ] 8. Check the age of the data: the newest post or channel in the restored copy is from before the backup time and not older than
  yesterday's night.
- [ ] 9. Write the result at the bottom of this file in your own notes (date, archive name, how long it took, what failed). Then **delete the
  spare machine** (it holds live tokens).

If a step fails, the backup is not trusted: fix the script and run the test again before relying on it.

## What a restore does not bring back
- The Temporal search index (the `temporal-elasticsearch-data` volume). It is only the search view of workflow history, rebuilt as new
  work arrives; we do not back it up. *Not verified on a live install.*
- The HTTPS certificate (Caddy gets a new one by itself).
- Posts that were mid-publish at backup time: our Worker marks anything unconfirmed after 30 minutes and a person decides (docs/social-engine.md).
