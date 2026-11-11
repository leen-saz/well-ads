# Keeping another company's TikTok account out

The repo is public, so the other company's advertiser id and name markers are not in it. `pipeline/tiktok/merge.py` reads them from two
secrets of the `production` environment (the same environment `refresh.yml` uses):

| Secret | Format | Used for |
|---|---|---|
| `TIKTOK_EXCLUDED_ADVERTISER_IDS` | comma separated advertiser ids | accounts that are never pulled or merged |
| `TIKTOK_EXCLUDED_MARKERS` | `;` separated, case-insensitive | names inside ad, campaign or account names that mark an ad as theirs |

Without them the code falls back to made-up placeholders (so tests never need real values) and `refresh.yml` warns in its first step with a
clear message instead of quietly letting that account in. Set both secrets **before** merging the PR that introduced this.

Not covered: `pipeline/dash/01-base.js` still carries the same account's id and markers in the dashboard page itself (a second,
client-side filter). Moving that one needs the page build to receive them too, so it is a separate change.
