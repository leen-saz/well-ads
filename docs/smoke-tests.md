# Smoke tests (`npm run test:smoke`)

The built Worker runs locally (`wrangler dev`) with a fake Supabase (`tests/smoke/fake-supabase.mjs`) and a local R2
seeded with synthetic pages (`tests/smoke/seed-r2.sh`). Everything is synthetic: accounts are `<name>@example.test`,
nothing leaves the machine, no secrets are used. CI job: `.github/workflows/smoke.yml` (about 3 minutes).

```bash
npm run build && npm run test:smoke      # locally, with Chrome installed: PW_CHANNEL=chrome npm run test:smoke
```

## What it covers
- `/api/health` answers without a login; signed-out pages go to `/login/?next=`, signed-out API calls get 401 JSON in Arabic.
- Sign-in through the real `/api/auth/login`: wrong password (401, no cookie), another origin (403), a tampered cookie (401).
- Every live module (the first test fails when a module is live but not listed): a user with only that permission opens its
  page (200) and its main API (200 JSON); a user with no permission is sent to `/today/` and the API answers 403 with an Arabic
  message; a user with another tab's permission gets 403 on the API. The owner opens everything, `/admin/` is the owner only.
- Core dashboards (`/`, `/control/`, `/connectors/`) per permission.
- Old URLs redirect (`/maestro/video`, `/design/video`, `/history`, `/review/history`, `/analytics`, `/home`, `/start`, `/permissions`),
  `?id=` rides along, and the destination links (`/performance/`, `/system/`...) open the first tool the user may open.
- In a browser: the sidebar draws an entry per permission and shows locked entries for the rest; the owner sees every live tab and
  the permissions page; the language switch flips `lang`/`dir` to English and back.
- Failure behaviour (`failure.spec.ts`): for each tab's first load, a 500 with a message, a gateway HTML page and a dropped connection each show one
  error state with a retry button (`failure`/`pageFailure` in `public/assets/common.js`), and retry recovers; a failed sidebar call shows a page banner;
  a request that never answers ends with a timeout message. API side: `tests/unit/api-errors.test.ts` sweeps every route signed out and with upstreams down.

## What it does not cover
- Real Supabase (RLS, migrations, the real `profiles` shape beyond what the fake returns): the migrations job covers schema only.
- Anything an AI model, Paperclip, Meta/TikTok/Google, R2 uploads or the Workflow actually does; only the permission gate and the
  main read-only API of each tab are hit. POST flows (write/approve levels) are not exercised here: see `tests/unit`.
- Page content and numbers: pages are checked to render, not for their figures (that is the parity suite). The `/` dashboard is a
  synthetic page from R2, not the pipeline's.
- Cron triggers, staging/production bindings, Cloudflare headers and caching behaviour at the edge.
- Visual layout, mobile, and every sub-page of each tab.
