# Passing the ad id from the ad to the CRM

UX audit 2026-11-12, fix 2. The dashboard can only tie a lead or a payment to an ad when the CRM row carries something that names the ad. Today `ad_id` is empty for most TikTok and WhatsApp leads (the tracking page says so per source). This note is what the form/link owner and the CRM owner (Kareem) need to send, and what the pipeline already accepts.

## What the pipeline accepts now (`pipeline/crm/join.py`, no migration)
Tried in this order, each only when the value is one of our ads (`<platform letter><id>`), so a wrong value never credits the wrong ad:
1. `ad_id` (and `ad_id_quality` not `broken_by_import`)
2. **new:** `ad_id`, `utm_id` or `utm_content` inside the stored CRM row (`crm_leads.doc`), when they hold the ad id
3. the ad's name, when it belongs to exactly one ad id (`ad_name`)
4. for a payment with none of these: the same customer's last ad lead in the 90 days before it

The platform comes from `source_platform`; when that says nothing (e.g. a WhatsApp lead that came from an ad link) `utm_source` (facebook / instagram / meta / snapchat / tiktok / google) names it. Why each paid closing did or did not match is on «صحة الداتا» (`crm.attribution`).

## What to put on each ad (platform macros, filled in at click time)
| Platform | Website link (URL parameters) | Lead form / WhatsApp |
|---|---|---|
| Meta | `utm_source=facebook&utm_medium=paid&utm_id={{ad.id}}&utm_content={{ad.id}}` | Lead Ads: the CRM connector should store the form's `ad_id` as `ad_id`. Click-to-WhatsApp: store the referral's ad id (`source_id`) as `ad_id` |
| Snapchat | `utm_source=snapchat&utm_medium=paid&utm_id={{ad.id}}` | Lead form: store the ad id as `ad_id` |
| TikTok | `utm_source=tiktok&utm_medium=paid&utm_id=__CID__` | Instant form: store the ad id as `ad_id` |

Check before relying on it: the macro names are the platforms' own and change; Meta and Snapchat document `{{ad.id}}`, but for TikTok sources disagree on whether `__CID__` is the creative or the ad id (TikTok's own help page lists `__CAMPAIGN_ID__` and `__AID_NAME__`). Open one real click per platform, read the value in the CRM, and compare it with the ad id shown on «التتبع». If it does not match an ad we pull, the closing shows under «رقم الإعلان مو بين الإعلانات المسحوبة» on «صحة الداتا».

## What we still need from the CRM owner
`ad_id` on every ad-sourced lead and booking, the UTM fields above stored on the lead (any field name works if it lands in the lead's row under `ad_id`, `utm_id`, `utm_content`, `utm_source`; other names need a small mapping), the payment date and the amount (`paid_at`, `amount_paid_sar`: already read), and the original lead on a manual booking (see `docs/crm-booking-message.md`).
