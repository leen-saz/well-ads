# Smoke tests (`npm run test:smoke`)

The built Worker runs locally (`wrangler dev`) with a fake Supabase (`tests/smoke/fake-supabase.mjs`) and a local R2
seeded with synthetic pages (`tests/smoke/seed-r2.sh`). Everything is synthetic: accounts are `<name>@example.test`,
nothing leaves the machine, no secrets are used. CI job: `.github/workflows/smoke.yml` (about 7 minutes; the language crawl is close to half of it).

```bash
npm run build && npm run test:smoke      # locally, with Chrome installed: PW_CHANNEL=chrome npm run test:smoke
```

Two checkouts on one machine: give the second its own ports, `SMOKE_PORT=8931 SMOKE_FAKE_PORT=8932 npm run test:smoke`.
Without them it reuses the first checkout's running servers (outside CI) and tests the other checkout's build. Specs take the
addresses from `BASE` / `FAKE` in `tests/smoke/helpers.ts`, never a written port.

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
- Language (`lang.spec.ts`): every page (the owner on all of them, and the sign-in, reset and welcome pages signed out) is opened with
  `?lang=en`, every tab and segment button is clicked, and **no Arabic may be left** in a text node (hidden panes too), a placeholder, an
  aria-label, a tooltip or the title. The only allow-list is at the top of the spec (the «عربي» button, an English help text that quotes
  Arabic example words); put user data in `data-user-text` to skip it. A new Arabic string without an English line in
  `public/assets/i18n-en.js` fails this test and prints the string. It sees what the fake data draws: empty states, labels, counters, help text.
  A string that only appears with real rows (a number inside a sentence) still needs a pattern in `pat()`: add the page's state to the spec when you add one.

- Plain words (`plain-words.spec.ts`, and `tests/unit/no-tech-text.test.ts` for every API answer): a normal member who may open every tab reads
  nothing technical on any page, in Arabic and in English, with normal data and with the database tables missing (the fake answers
  like a table that was never created after `POST :8788/__mode {"missing":true}`). The word list is `tests/shared/tech-words.ts`
  (Supabase, SQL, Cloudflare, GitHub, API, token, key and secret names, pipeline, migration, dash.json, MCP, Worker, table names).
  Technical text may live only on the Connectors page and the owner-only pages (data health, admin), which these tests do not visit.
  A route that needs a setup step uses `notApplied(user, file)` / `notEnabled(user, …)` from `src/lib/auth.ts`: the owner gets the
  step, everyone else "tell the admin".

- **Layout stability** (`cls.spec.ts`): the control, maestro, health, audit, admin, listening, knowledge, today and overview pages are loaded with every API answer held back 400 ms (the way late data arrives on the live site) and the Cumulative Layout Shift must stay at 0.1 or less. A failure names the element that moved most. The fixture's «numbers are old» notice is switched off for this test (it is a deliberate, rare shift). New late-filled areas get their space reserved in `public/assets/app.css` («Reserved space») or a `.sk` placeholder.

- **Slow pages** (`loading.spec.ts`): the knowledge chat shows the answers so far at once and the AI's next question behind a placeholder (and keeps the answers if that question fails); the four data-health parts are requested together; the audit page shows a placeholder while it computes.

## What it does not cover
- Real Supabase (RLS, migrations, the real `profiles` shape beyond what the fake returns): the migrations job covers schema only.
- Anything an AI model, Paperclip, Meta/TikTok/Google, R2 uploads or the Workflow actually does; only the permission gate and the
  main read-only API of each tab are hit. POST flows (write/approve levels) are not exercised here: see `tests/unit`.
- Page content and numbers: pages are checked to render, not for their figures (that is the parity suite). The `/` dashboard is a
  synthetic page from R2, not the pipeline's.
- Cron triggers, staging/production bindings, Cloudflare headers and caching behaviour at the edge.
- Visual layout, mobile, and every sub-page of each tab.
