# Social publishing engines (Facebook, Instagram, TikTok, X, LinkedIn)

Owner document. Technical text is allowed here and on the Connectors page; the Social tab itself stays in plain words.

## What the system does

```
post written in the Social tab
  → the named approver approves it (companies.social_approvers; none named = the owner only), audit-logged
  → the cron run (every 5 min) claims it (scheduled → publishing)
  → one engine per platform:   facebook, instagram → native (our own Graph API code)
                               tiktok, x, linkedin → postiz (extra engine, over HTTPS)
                               snapchat            → saved as a reminder
  → the result of each platform is stored on the post (social_posts.results)
```

**The approval rule is ours, never Postiz's.** Only `src/modules/social/cron.ts` calls an engine, and only for a post that is approved by a
currently named approver. A post that was never approved makes zero calls to Postiz (test: `postiz.test.ts`, "an UNAPPROVED post…").
Postiz is told to publish **at once** (`type: "now"`); we never use its schedule, draft or approval-comment features, so none of them
can hold or release a post.

A platform is shown as available only when its engine is set up **and** that account is connected in the engine. Otherwise the post
is kept as a reminder, as before.

## What you must set up (Leen's side)

### 1. A host for Postiz
Postiz does not run on Workers or Cloudflare Containers (ephemeral disk, no stateful database, no Temporal). Use one small VM:
- 4 GB RAM or more, 2 vCPU, 30 GB disk; Docker and docker compose; a domain with HTTPS in front (Caddy or nginx, Let's Encrypt).
- Use Postiz's own docker compose from its installation docs (docs.postiz.com): it brings PostgreSQL, Redis and Temporal (Temporal is a hard
  dependency since v2.12). Do not trim services out of it.
- Create the first user, then turn registration off (`DISABLE_REGISTRATION=true`) so nobody else can sign up.
- Keep Postiz **unmodified** and pinned to a tested image version; update on purpose, not automatically.
- Do not expose Postgres, Redis or Temporal ports to the internet; only the HTTPS front.

### 2. Backups (before connecting any account)
- Nightly dump of the Postiz PostgreSQL database (and the Temporal database if it is a separate one), kept off the VM for 14+ days.
- Back up the uploads volume and the compose `.env` file (it holds the JWT secret and the platform app secrets).
- Restore once on a spare machine to prove it works. Losing the database means every account has to be connected again.

### 3. The platform apps (each needs its own developer app, approved by the platform)
Each is created in the platform's developer portal, with the redirect URL that Postiz shows for that provider (docs.postiz.com → Providers →
the platform) and the keys put in Postiz's `.env`. Approval times are the platform's, and some take weeks.
- **TikTok**: TikTok for Developers → app with Login Kit and Content Posting API, domain/URL-prefix verification for our media links.
  An app that has not passed TikTok's audit can only post as private (`SELF_ONLY`) whatever we send. Until it is audited, TikTok posts will not be public.
  We send `DIRECT_POST` so the post is published, not left as an upload to finish in the app.
- **X**: developer portal → project and app with read/write permission. Posting through the API needs a plan that allows writing; check X's current limits.
- **LinkedIn**: developer portal → app with "Share on LinkedIn" (profile) and, for a company page, the Community Management API (needs LinkedIn approval).
  If both a profile and a page are connected we use the page.
- **Facebook / Instagram**: not through Postiz. They use our own Meta connection (Connectors → Meta pages).

In Postiz: connect one account per platform (the system refuses to guess between two accounts of one platform; it says so on the Social tab),
then Settings → Public API → copy the key.

### 4. Tell the system (the only two variables)
| Name | Value | Where |
|---|---|---|
| `POSTIZ_URL` | `https://postiz.your-domain.com` (https only, a domain, not an IP or localhost). We add `/api/public/v1`. For Postiz cloud use the full `https://api.postiz.com/public/v1`. | Connectors page card "Postiz", or a Worker secret |
| `POSTIZ_API_KEY` | the Public API key | same |

The Connectors card tests the pair before saving. The vault wins over a Worker secret of the same name. Owner only; neither value is ever
returned to a browser or stored in a post result. Rotate the key in Postiz, then paste the new one in the card.

On the Social tab the owner gets **"Check the service and accounts"**: reachable, key valid, and which of TikTok / X / LinkedIn has a
connected account (names only). Other users only see «غير متاح الحين» next to a platform that is not available.

## How a post goes out through Postiz

1. Params are checked before any call: text limit, media count and type (TikTok 35 images or one MP4; X 4 images or one MP4; LinkedIn 9 images or one MP4; MOV and WebM are refused), TikTok needs media.
2. `GET /integrations` finds the one enabled channel of that platform.
3. Each media file is imported by Postiz from our public `/m/` link (`POST /upload-from-url`); the returned id and path go into the post.
4. The result is saved as `sending`, then `POST /posts` with `type: "now"` is made **once**.
5. The Postiz post id is saved (`processing`) and `GET /posts` is followed until `PUBLISHED` (done) or `ERROR` (failed, Postiz's message for the owner). Still queued after the polls: the next cron run continues; after 30 minutes it becomes `unconfirmed`.

### Never double-post
Postiz has no idempotency key, so the create call is never retried. Reads and media imports are retried (with backoff).
- A timeout, a lost connection or a 5xx on the create call is **unknown**: we look the post up (same channel, same text, created after we started). Found: we follow it, we do not create it again. Not found: `unconfirmed`, and a person decides.
- A re-run (stale-claim recovery, a second cron run) of a platform that is `processing` only follows it; `sending` or `unconfirmed` is never re-sent by itself. Only the approver's single "retry" (which clears that platform's entry) may send it again.
- 429 (rate limit): nothing was created; the post waits for the next run, for up to 30 minutes, then fails as busy.
- Postiz's limit applies to creating posts (the docs say 30 per hour in the API reference and 90/100 per hour in the introduction): large batches will queue across cron runs.

## Not verified (built from docs.postiz.com, no live server was available)
- Whether `type: "now"` answers before the post is published (we handle both: we poll).
- The exact error body shape, and the rate-limit number and scope (the docs disagree).
- Whether Postiz stores our plain text as is or as HTML (the look-up strips tags and whitespace before comparing).
- That a self-hosted install serves `/api/public/v1` behind the same domain as the web app (we complete the path; give the full path if yours differs).
- The upload size limit of `/upload-from-url`; the redirect URLs and `.env` names of each provider (take them from Postiz's provider pages, not from here).
- `GET /posts` has no pagination or single-post lookup in the docs; we ask for a window around the post.
Run one real test post per platform to a test account before relying on it, and tell us what differs.

## Adding another platform Postiz supports
1. `engine.ts`: a `SOCIAL` entry (`engine: 'postiz'`, text limit) and its `CAPS` (image count, mp4 only).
2. `postiz.ts`: its channel identifier in `IDENT`, and its settings in `settingsFor` if Postiz requires any (Postiz's provider page lists them).
3. `public/assets/i18n-en.js`: its name. The Social tab, the checks and the tests pick it up from the map.
Platforms that need extra per-post fields (YouTube title and privacy, Pinterest board) need a form field first.

## AGPL-3.0
Postiz is licensed AGPL-3.0 (github.com/gitroomhq/postiz-app). We only call its public HTTP API from our own code; no Postiz code is copied
or linked into this repository, and none of its code runs inside our Worker. Run it unmodified. If you ever modify Postiz and let other people
use it over a network, AGPL requires you to offer them your modified source. Keep any such change out of this repo and ask for legal advice first.
