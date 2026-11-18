# Dashboard API v1 (read-only)

For tools, scripts and agents that need the dashboard's numbers **without signing in through the website** (a browser session expires and
does not get through the firewall). It reads only: there is no write path anywhere in it, and the key works on no other address of the site.

One static key, set by the owner, in the Worker variable `READ_API_KEY`. No database table, no page. **Unset = the whole API is off** (every
`/api/v1/*` answer is `404`). The site itself and `deploy.yml` work the same either way.

## Turn it on (owner, once)

```bash
# 1. a key: wad_ + 43 random characters. Keep it in a password manager; it is never shown anywhere else
printf 'wad_%s\n' "$(openssl rand -base64 48 | tr '+/' '-_' | tr -d '=\n' | cut -c1-43)"
# 2. store it for each environment (the command asks for the value; paste it)
gh secret set READ_API_KEY --env staging
gh secret set READ_API_KEY --env production
# 3. deploy (any merge to main, or rerun the Deploy workflow): deploy.yml passes it to the Worker as a plain variable
```

**Rotate or revoke:** run `gh secret set READ_API_KEY --env production` with a new value and redeploy; the old key stops working at
once. To switch the API off, delete the secret (`gh secret delete READ_API_KEY --env production`) and redeploy. If a Worker *secret* named
`READ_API_KEY` also exists (`wrangler secret put`), delete one of the two: a variable and a secret cannot share a name.

## Use it

```bash
export WELL_KEY='wad_…'
curl -s -H "Authorization: Bearer $WELL_KEY" https://<site>/api/v1/dash | jq '.range'
curl -s -H "Authorization: Bearer $WELL_KEY" 'https://<site>/api/v1/overview?from=2026-11-01&to=2026-11-14'
curl -s -H "Authorization: Bearer $WELL_KEY" 'https://<site>/api/v1/ads?platform=snap&status=ACTIVE&from=2026-11-01&to=2026-11-14'
curl -s -H "Authorization: Bearer $WELL_KEY" https://<site>/api/v1/decisions
curl -s -H "Authorization: Bearer $WELL_KEY" https://<site>/api/v1/campaigns
curl -s -H "Authorization: Bearer $WELL_KEY" https://<site>/api/v1/health
curl -s -H "Authorization: Bearer $WELL_KEY" https://<site>/api/v1/openapi.json
```

The key goes in the `Authorization: Bearer` header **only**. In the address (`?key=`) or a cookie it is ignored and answers `401`.

## Rules

| | |
|---|---|
| Methods | `GET` and `HEAD` only. Everything else (`POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`) is `405`. |
| Browsers | No CORS headers: for scripts and agents, not for pages on other sites. |
| Answers | JSON, `cache-control: private, no-store`. Errors: `{ "error": "<code>", "message": "<plain English>" }`. |
| Key check | SHA-256 digests compared in constant time. Missing or wrong key: `401` with the same generic message. The key is never logged or echoed. |
| Wrong keys | 10 wrong keys from one address in 10 minutes: `429` (even for the right key) until the window passes. |
| Rate limit | 60 requests per minute, counted in the Cache API per data centre. If the counter cannot be read or written the request is refused (`503`), never let through. |
| Reach | Well's data only. Never: connector keys and tokens, users and profiles, the audit log, buyer execution, secrets, the Vault, raw CRM lead rows, anything under admin. |

## Endpoints

| Endpoint | What it returns |
|---|---|
| `GET /api/v1/dash` | The overview data (`site/dash.json`): ads, daily rows as `[ad, day, spend, impressions, clicks, leads, conversations]`, platforms, departments, targets. The CRM block is **totals only** (`crm.by_ad`, totals, stats); no lead rows. |
| `GET /api/v1/overview` | Totals for a period (`from`, `to`; default the last 30 days of data), the funnel targets and the marketing judge's verdict. |
| `GET /api/v1/ads` | Every ad with status, `live` and the period's metrics (spend, impressions, clicks, leads, conversations, ctr, cost per result). Filters: `platform`, `status`, `from`, `to`, `limit` (default 500, at most 2,000). Sorted by spend. |
| `GET /api/v1/decisions` | Open suggestions of the decisions board, the latest decided ones and the measured outcomes of executed actions. No names or emails of who decided. |
| `GET /api/v1/campaigns` | Ahlam campaigns (title, status, estimate, dates) with each task's agent, title and status. No generated text, pictures or voice, no author emails. |
| `GET /api/v1/health` | Data freshness: age of the numbers and the CRM, the hourly refresh result, each pipeline step's status. No dependencies, versions, migrations or environment. |
| `GET /api/v1/openapi.json` | A small OpenAPI 3 description of the above. |

Dates are whole days, `YYYY-MM-DD`; a malformed date or `from` after `to` is `400`.
