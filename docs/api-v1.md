# Dashboard API v1 (read-only)

For tools, scripts and agents that need the dashboard's numbers **without signing in through the website**. It reads only. There is no
write path anywhere in it, and a key never works on any other address of the site.

## Make a key (owner only)

النظام ← الصلاحيات والدخول ← «مفاتيح الـ API (قراءة فقط)»: a name, what the key may read (scopes), and how long it lives (90 days by default,
365 at most). The key is shown **once**. Only a hash of it is stored (`api_keys`, migration `037_api_keys.sql`). The list shows each key's
first 8 characters, scopes, last use and expiry, and **revoke** stops a key at once. Creating and revoking are written to the audit log.

Needs the Worker secret `API_KEY_PEPPER` (`docs/secrets/worker.env.example`) and migration 037. Without either, `/api/v1/*` answers `503`
with a plain message and the key page says so.

## Use a key

```bash
export WELL_KEY='wad_…'                      # the key you copied
curl -s -H "Authorization: Bearer $WELL_KEY" https://<site>/api/v1/dash | jq '.range'
curl -s -H "Authorization: Bearer $WELL_KEY" 'https://<site>/api/v1/overview?from=2026-11-01&to=2026-11-14'
curl -s -H "Authorization: Bearer $WELL_KEY" 'https://<site>/api/v1/ads?platform=snap&status=ACTIVE&from=2026-11-01&to=2026-11-14'
curl -s -H "Authorization: Bearer $WELL_KEY" https://<site>/api/v1/decisions
curl -s -H "Authorization: Bearer $WELL_KEY" https://<site>/api/v1/campaigns
curl -s -H "Authorization: Bearer $WELL_KEY" https://<site>/api/v1/health
curl -s -H "Authorization: Bearer $WELL_KEY" https://<site>/api/v1/openapi.json
```

The key goes in the `Authorization: Bearer` header **only**. A key in the address (`?key=`) or in a cookie is ignored and answers `401`.

## Rules

| | |
|---|---|
| Methods | `GET` and `HEAD` only. Everything else (`POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`) is `405`. |
| Browsers | No CORS headers: it is for scripts and agents, not for pages on other sites. |
| Answers | JSON. `cache-control: private, no-store`. Errors are `{ "error": "<code>", "message": "<plain English>" }`. |
| Rate limit | 60 requests per minute and 5,000 per day **per key**. Over it: `429` with `Retry-After`. If the counter cannot be read the request is refused (`503`), never let through. |
| Who the key is | A viewer of the owner's company, limited to its scopes. A key of another company reads that company's own data, or gets `404` where the data is Well's alone (decisions, health). |
| Never in a key's reach | connector keys and tokens, users and profiles, the audit log, buyer execution, secrets, the Vault, raw CRM lead rows, anything under admin. |
| Refusals | `401` missing, malformed, unknown, revoked or expired key (the answer never says which). `403` the key lacks the scope. `404` no such endpoint, or no data for that company. `503` not set up yet, or the counter is down. |

## Endpoints and scopes

| Endpoint | Scope | What it returns |
|---|---|---|
| `GET /api/v1/dash` | `dash` | The overview data (`site/dash.json`): ads, daily rows as `[ad, day, spend, impressions, clicks, leads, conversations]`, platforms, departments, targets. The CRM block is **totals only** (`crm.by_ad`, totals and stats); no lead rows. |
| `GET /api/v1/overview` | `dash` | Totals for a period (`from`, `to`; default the last 30 days of data), the funnel targets, and the marketing judge's verdict on the funnel. |
| `GET /api/v1/ads` | `ads` | Every ad with status, `live` and the metrics of the period: spend, impressions, clicks, leads, conversations, ctr, cost per result. Filters: `platform`, `status`, `from`, `to`, `limit` (default 500, at most 2,000). Sorted by spend. |
| `GET /api/v1/decisions` | `decisions` | Open suggestions of the decisions board, the latest decided ones, and the measured outcomes (3 and 7 days) of executed actions. No names or emails of the people who decided. Well only. |
| `GET /api/v1/campaigns` | `campaigns` | Ahlam campaigns (title, status, estimate, dates) with each task's agent, title and status. **No** generated text, pictures or voice, no author emails. |
| `GET /api/v1/health` | `health` | Data freshness: age of the numbers and of the CRM, the hourly refresh result and each pipeline step's status. No dependencies, versions, migrations or environment. Well only. |
| `GET /api/v1/openapi.json` | any key | A small OpenAPI 3 description of the above. |

Dates are whole days, `YYYY-MM-DD`; a malformed date or `from` after `to` is `400`.

## For the owner: the setup

1. Apply `supabase/migrations/037_api_keys.sql` in the Supabase SQL editor (safe to run twice).
2. Set the secret on both Workers (a random value; never change it afterwards, or every key stops working):
   `openssl rand -base64 48 | npx wrangler secret put API_KEY_PEPPER --name well-ads` and the same with `--name well-ads-staging`.
3. Make a key on the admin page, give it only the scopes the tool needs, and keep the expiry short.
