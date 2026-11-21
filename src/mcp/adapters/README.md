# Well MCP adapters

The only files that speak to the ad and social platforms (docs/PRD.md §3.0). `tests/unit/adapter-boundary.test.ts` fails when any other
source file names a platform API host, apart from the short list there of files waiting for their milestone.

| File | Platform | Used by |
|---|---|---|
| `ads.ts` | The ad adapter contract (read, find a campaign, set a budget or a status) and the write secrets | `src/modules/buyer/exec/service.ts` |
| `meta-ads.ts` | Meta Marketing API | buyer execution |
| `snap-ads.ts` | Snapchat Marketing API | buyer execution |
| `meta-graph.ts` | Meta Graph: Facebook and Instagram publishing, the connection check, the account-health probe | `src/modules/social/social.ts`, `src/lib/account-health.ts` |
| `postiz.ts` | Postiz, the extra publishing engine (TikTok, X, LinkedIn) | social publishing, connectors, account health |

Adapters hold no policy: approval, timing, retries and guards stay with their callers. Tokens arrive as arguments and never leave in a
log or an answer.
