# Outbound webhooks

Well sends a signed POST to your address when something happens in your company (docs/PRD.md §3.0, milestone M11). The code is in
`src/mcp/events.ts`, the tables in `supabase/migrations/043_events.sql`.

## Events

| Type | When | `data` |
|---|---|---|
| `post.published` | A post went out on all or some of its platforms | `post_id`, `status` (`published` / `partial`), `platforms`, `codes` for the ones that failed |
| `post.failed` | A post failed everywhere | `post_id`, `status`, `platforms` (empty), `codes` |
| `ad_action.applied` | An approved ad change was written and read back | `id`, `platform`, `level`, `entity_id`, `before`, `after` |
| `ad_action.failed` | An approved ad change could not be written or verified | `id`, `platform`, `level`, `entity_id`, `code` |
| `account.disconnected` / `account.expiring` / `account.recovered` | The hourly account check changed state | `platform`, `status`, `code` |

Payloads carry ids, platforms and short codes only: never post text, a token, a person's details or a platform's message.

## Managing webhooks (owner only)

- `GET /api/webhooks/list`
- `POST /api/webhooks/create` with `{ "url": "https://…", "types": ["post.published"] }`. The answer has `secret`, shown **once**.
  It is kept only in the company's Token Vault (`WEBHOOK_SECRET_<id>`).
- `POST /api/webhooks/remove` with `{ "id": 7 }`.

The address must be public `https` by name, on the default port: no IP address, no `localhost` or internal names. Redirects are not followed.

## Delivery and signature

Each request follows [Standard Webhooks](https://www.standardwebhooks.com/):

- Headers: `webhook-id` (`evt_<id>`, the same on every retry), `webhook-timestamp` (Unix seconds), and `webhook-signature`.
- The signature is `v1,` followed by base64 HMAC-SHA256, keyed with the secret after the `whsec_` prefix, over `"<webhook-id>.<webhook-timestamp>.<raw body>"`.
- Body: `{ "id", "type", "created_at", "data" }`.
- Answer with any 2xx within 10 seconds. Anything else is retried after 1, 5, 30, 120 and 360 minutes; after the sixth attempt the delivery is marked failed.
- Sending runs every 5 minutes, a few deliveries per run, so allow a few minutes of delay. Use `webhook-id` to drop duplicates.
