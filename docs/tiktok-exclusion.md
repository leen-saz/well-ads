# Keeping another company's TikTok account out

The repo is public, so the other company's advertiser id and name markers are not in it. `pipeline/tiktok/merge.py` reads them from two
secrets of the `production` environment (the same environment `refresh.yml` uses):

| Secret | Format | Used for |
|---|---|---|
| `TIKTOK_EXCLUDED_ADVERTISER_IDS` | comma separated advertiser ids | accounts that are never pulled or merged |
| `TIKTOK_EXCLUDED_MARKERS` | `;` separated, case-insensitive | names inside ad, campaign or account names that mark an ad as theirs |

## What happens without them (fails closed for TikTok)
The code only knows made-up placeholders, so without the secrets the other company's account would NOT be excluded. So:
- **Neither the two secrets nor the opt-out:** every TikTok step of `refresh.yml` is skipped (Restore / MCP / Save), `fetch_data.py` reads nothing new
  for TikTok (the previous numbers stay and are marked stale, status `exclusion_not_configured`), and `python -m tiktok.mcp` exits 1. Meta, Google and
  Snapchat carry on and the refresh does not fail. The first step of the run says why in a warning.
- **Fix it one of two ways:** set both secrets above in the `production` environment, **or**, if the TikTok token cannot see that account at all, set the
  variable `TIKTOK_EXCLUSION_DISABLED` to `true` (Settings → Environments → production → Variables, not a secret). The run then warns on every run
  that nothing is excluded.
- The staging export (`pipeline.yml`) applies the same filter and needs the same two secrets in the `staging` environment.

There is no client-side copy of the id or the markers any more: the page JS no longer carries them, so the server-side filter is the only one.
