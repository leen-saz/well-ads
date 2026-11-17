#!/usr/bin/env python3
"""يحدّث tiktok.json من نتائج موصّل TikTok for Business (MCP) المحفوظة على الجهاز.

تيك توك ما له مفتاح API حالياً، فـ Claude هو اللي يسحب البيانات عن طريق الموصّل ويشغّل هذا السكربت:
  python3 tiktok/merge.py tiktok.json --ads <ad_get.json> --days <report1.json> [<report2.json> ...]

- ad_get.json: نتيجة tool_execute(ad_get) مع primary_status=STATUS_ALL.
- كل report: نتيجة report_integrated_get بمستوى AUCTION_AD وأبعاد [ad_id, stat_time_day].
- الأيام الموجودة في التقارير الجديدة تستبدل نفس الأيام في الملف، والأقدم تبقى كما هي.
لا يحتوي الملف أي توكن. الصيغة نفس صيغة data.json: ads + rows [key, date, spend, impr, clicks, leads, 0].
--organic اختياري: يُحفظ كما هو تحت المفتاح organic (حساب تيك توك العضوي). بدون الملف تبقى نسخة organic السابقة إن وُجدت.
--covers اختياري: صور أغلفة الإعلانات. ملف أو أكثر، كل واحد واحد من:
  - نتيجة أداة معلومات الفيديو في الموصّل (فيها video_id و video_cover_url أو poster_url)
  - نتيجة أداة معلومات الصورة (فيها image_id و image_url)
  - أو قاموس جاهز {ad_id: رابط الصورة}
  عشان يرتبط الغلاف بالإعلان لازم ad_get يطلب الحقول video_id و image_ids.
  الصورة تُصغّر وتُحفظ داخل الملف (data URI) لأن روابط تيك توك تنتهي. الإعلان اللي ما جاه غلاف يحتفظ بصورته السابقة.
"""
import argparse, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from datetime import datetime, timedelta, timezone

GOAL = {"LEAD_GENERATION": "lead", "WEB_CONVERSIONS": "lead", "ENGAGEMENT": "profile", "VIDEO_VIEWS": "other", "TRAFFIC": "traffic"}
STATUS = {"AD_STATUS_DELIVERY_OK": "نشط", "AD_STATUS_CAMPAIGN_EXCEED": "حد صرف الحملة خلص", "AD_STATUS_BUDGET_EXCEED": "حد صرف المجموعة خلص", "AD_STATUS_CAMPAIGN_DISABLE": "الحملة متوقفة", "AD_STATUS_ADGROUP_DISABLE": "المجموعة متوقفة",
          "AD_STATUS_DISABLE": "متوقف", "AD_STATUS_DELETE": "محذوف", "AD_STATUS_CAMPAIGN_DELETE": "محذوف", "AD_STATUS_ADGROUP_DELETE": "محذوف"}
# Destination: a TikTok ad that opens WhatsApp (deep link / messaging destination) never reports leads on the platform,
# so zero leads there is not a failure. Detected from the ad's own link fields and the ad group's messaging app, plus
# an explicit list in config/destinations.json (campaign ids or name words) for what the API does not carry.
WA_LINK = ("wa.me", "whatsapp.com", "whatsapp://", "api.whatsapp")


def _destinations():
    try:
        path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config", "destinations.json")
        return json.load(open(path, encoding="utf-8")).get("tiktok_whatsapp") or {}
    except (OSError, ValueError):
        return {}


LINK_FIELDS = ("landing_page_url", "deeplink", "landing_page_urls", "deeplink_url")


def _links(ad):
    links = []
    for k in LINK_FIELDS:
        v = ad.get(k)
        links += [str(x) for x in v] if isinstance(v, list) else ([str(v)] if v else [])
    return links


def destination(ad, group=None, config=None):
    """Where this TikTok ad sends people, from evidence in hand only:
      'whatsapp'  the link, the ad group's messaging app, or config/destinations.json says WhatsApp
      None        evidence says somewhere else (a web link, another messaging app)
      'unknown'   no link field and no messaging info at all: we do not know, and we do not guess"""
    cfg = _destinations() if config is None else config
    links = _links(ad)
    if any(w in l.lower() for l in links for w in WA_LINK):
        return "whatsapp"
    g = group or {}
    apps = [str(src.get("messaging_app_type") or "").lower() for src in (ad, g)]
    if any("whatsapp" in a for a in apps):
        return "whatsapp"
    cid = str(ad.get("campaign_id") or "")
    if cid and cid in {str(x) for x in cfg.get("campaign_ids") or []}:
        return "whatsapp"
    name = str(ad.get("campaign_name") or "").lower()
    if any(str(w).lower() in name for w in cfg.get("campaign_name_words") or [] if str(w).strip()):
        return "whatsapp"
    return None if (links or any(apps)) else "unknown"


def whatsapp_dest(ad, group=None, config=None):
    """True only when the destination is WhatsApp (unknown is False)."""
    return destination(ad, group, config) == "whatsapp"


def dest_for(ad, group=None, goal=None, config=None):
    """The value stored on the dashboard ad as `dest`, recomputed on every run (never carried over from a previous run):
    'whatsapp', 'unknown' (lead ads only: the destination decides how cost per lead is read), or None."""
    d = destination(ad, group, config)
    return d if d == "whatsapp" or (d == "unknown" and goal == "lead") else None


# Another company's TikTok account must never reach this dashboard. This repo is public, so the real advertiser id and
# name markers are NOT in it: they come from the TIKTOK_EXCLUDED_ADVERTISER_IDS (comma separated) and
# TIKTOK_EXCLUDED_MARKERS (";" separated, matched case-insensitively inside ad, campaign and account names) secrets of
# the production environment (see docs/tiktok-exclusion.md). The defaults below are made-up placeholders.
DEFAULT_EXCLUDED_IDS = "7000000000000000002"
DEFAULT_EXCLUDED_MARKERS = "acme demo co;شركة العرض التجريبي;ad_demo_x1"


def excluded_ids():
    raw = os.environ.get("TIKTOK_EXCLUDED_ADVERTISER_IDS") or DEFAULT_EXCLUDED_IDS
    return {x.strip() for x in raw.split(",") if x.strip()}


def excluded_markers():
    raw = os.environ.get("TIKTOK_EXCLUDED_MARKERS") or DEFAULT_EXCLUDED_MARKERS
    return tuple(_flat(x) for x in raw.split(";") if x.strip())


CONV_KEYS = ("messaging_total_conversation_tiktok_direct_message", "messaging_total_conversation_instant_messaging_app")


def conversations(metrics):
    """Messaging conversations of one report row (the MCP pull asks for these metrics; 0 when the API gave none)."""
    total = 0.0
    for key in CONV_KEYS:
        v = (metrics or {}).get(key)
        if v not in (None, ""):
            total += float(v or 0)
    return int(round(total))


def exclusion_state():
    """'configured' (both secrets set), 'disabled' (explicit opt-out TIKTOK_EXCLUSION_DISABLED=true) or 'missing'.
    'missing' must stop every TikTok step: without the secrets the code only knows made-up placeholders, so the other
    company's account would NOT be excluded and its spend could reach production."""
    if exclusions_configured():
        return "configured"
    if (os.environ.get("TIKTOK_EXCLUSION_DISABLED") or "").strip().lower() == "true":
        return "disabled"
    return "missing"


def exclusions_configured():
    return bool(os.environ.get("TIKTOK_EXCLUDED_ADVERTISER_IDS") and os.environ.get("TIKTOK_EXCLUDED_MARKERS"))


def tiktok_live(x):
    """نشط فقط إذا الإعلان والمجموعة والحملة كلها ENABLE. حالة التسليم وحدها لا تكفي."""
    if x.get("operation_status") != "ENABLE":
        return False
    camp = x.get("campaign_operation_status")
    group = x.get("adgroup_operation_status")
    if camp not in (None, "ENABLE") or group not in (None, "ENABLE"):
        return False
    st = x.get("secondary_status") or ""
    if st.endswith("_DISABLE") or "DELETE" in st or st in ("AD_STATUS_DISABLE",):
        return False
    if camp is None and group is None:
        return st == "AD_STATUS_DELIVERY_OK"
    return True


def _flat(value):
    return " ".join(str(value or "").casefold().split())


def is_excluded_account(advertiser_id="", advertiser_name=""):
    if str(advertiser_id or "") in excluded_ids():
        return True
    name = _flat(advertiser_name)
    return bool(name) and any(m in name for m in excluded_markers())


def is_excluded_ad(ad):
    if not isinstance(ad, dict):
        return False
    if is_excluded_account(ad.get("advertiser_id"), ad.get("advertiser_name") or ad.get("account")):
        return True
    blob = " ".join(str(ad.get(k) or "") for k in ("name", "campaign", "group", "text", "ad_name", "campaign_name", "adgroup_name", "ad_text"))
    folded = _flat(blob)
    if not any(marker in folded for marker in excluded_markers()):
        return False
    plat = ad.get("platform") or ad.get("family") or ""
    return plat in ("", "tiktok")


def without_excluded(blob):
    """Drops the excluded company's ads and their rows from a TikTok snapshot or data.json (ids and markers come from secrets)."""
    if not isinstance(blob, dict):
        return blob
    if is_excluded_account(blob.get("advertiser_id"), blob.get("advertiser_name")):
        out = dict(blob)
        out["ads"] = {}
        out["rows"] = []
        return out
    ads = blob.get("ads") or {}
    dropped = {k for k, v in ads.items() if is_excluded_ad(v)}
    kept = {k: v for k, v in ads.items() if k not in dropped}
    # rows are dropped only for excluded ads: a row whose ad is missing from `ads` (a deleted ad the platform no
    # longer lists) keeps its spend, otherwise the TikTok history would shrink on every run
    rows = [r for r in (blob.get("rows") or []) if r and r[0] not in dropped]
    if not dropped and len(rows) == len(blob.get("rows") or []):
        return blob
    out = dict(blob)
    out["ads"] = kept
    out["rows"] = rows
    return out


def payload(path):
    d = json.load(open(path, encoding="utf-8"))
    if isinstance(d, dict) and d.get("code") not in (None, 0):
        raise SystemExit(f"{path}: TikTok error {d.get('code')} {d.get('message')}")
    return d.get("data", d) if isinstance(d, dict) else d


def cover_urls(paths, items):
    """يرجع {ad_id: رابط الغلاف} من ملفات --covers ونتيجة ad_get."""
    by_video, by_image, direct = {}, {}, {}
    for path in paths or []:
        d = payload(path)
        if isinstance(d, dict) and "list" not in d and all(isinstance(v, str) for v in d.values()):
            direct.update({str(k): v for k, v in d.items() if v})
            continue
        for x in (d.get("list") if isinstance(d, dict) else d) or []:
            if not isinstance(x, dict):
                continue
            url = x.get("video_cover_url") or x.get("poster_url") or x.get("image_url") or x.get("url")
            if not url:
                continue
            if x.get("video_id"):
                by_video[str(x["video_id"])] = url
            elif x.get("image_id"):
                by_image[str(x["image_id"])] = url
    out = {}
    for x in items:
        ad_id = str(x.get("ad_id") or "")
        url = direct.get(ad_id) or by_video.get(str(x.get("video_id") or ""))
        if not url:
            url = next((by_image[str(i)] for i in (x.get("image_ids") or []) if str(i) in by_image), None)
        if ad_id and url:
            out[ad_id] = url
    return out


def embed_covers(urls):
    """يحمّل الأغلفة ويصغّرها. اللي يفشل يُترك."""
    if not urls:
        return {}
    from concurrent.futures import ThreadPoolExecutor
    import organic
    with ThreadPoolExecutor(6) as pool:
        done = dict(zip(urls, pool.map(organic._embed_thumb, urls.values())))
    return {k: v for k, v in done.items() if v}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--ads", required=True)
    ap.add_argument("--days", nargs="+", required=True)
    ap.add_argument("--objectives", help="JSON file {campaign_id: objective_type}; defaults to the ones kept in out")
    ap.add_argument("--organic", help="Optional organic account JSON to store beside the paid rows")
    ap.add_argument("--covers", nargs="+", help="Ad cover files (video/image info results or {ad_id: url})")
    ap.add_argument("--advertiser-id", default="", help="TikTok advertiser id for this pull")
    ap.add_argument("--advertiser-name", default="", help="TikTok advertiser name for this pull")
    a = ap.parse_args()

    prev = json.load(open(a.out, encoding="utf-8")) if os.path.exists(a.out) else {"ads": {}, "rows": [], "objectives": {}}
    if is_excluded_account(prev.get("advertiser_id"), prev.get("advertiser_name")):
        prev = {**prev, "ads": {}, "rows": []}
    else:
        prev = without_excluded(prev)
    obj = dict(prev.get("objectives", {}))
    if a.objectives:
        obj.update(json.load(open(a.objectives, encoding="utf-8")))

    items = payload(a.ads).get("list", [])
    excluded_pull = is_excluded_account(a.advertiser_id, a.advertiser_name) or any(
        is_excluded_account(x.get("advertiser_id"), x.get("advertiser_name")) for x in items
    )
    ads = dict(prev.get("ads", {}))
    covers = {} if excluded_pull else embed_covers(cover_urls(a.covers, items))
    skipped = set()
    if excluded_pull:
        print("تخطي حساب تيك توك المستبعد")
    else:
        for x in items:
            if is_excluded_ad(x):
                skipped.add(str(x.get("ad_id") or ""))
                continue
            st = x.get("secondary_status", "")
            live = tiktok_live(x)
            word = "نشط" if live else STATUS.get(st, "متوقف")
            if not live and word == "نشط":
                word = "متوقف"
            ads["t" + x["ad_id"]] = dict(
                platform="tiktok", name=(x.get("ad_name") or x["ad_id"]).strip("‎ "), campaign=(x.get("campaign_name") or "").strip(),
                group=(x.get("adgroup_name") or "").strip(), format="فيديو", status=word, live=live,
                text=(x.get("ad_text") or "").strip(),
                thumb=covers.get(str(x["ad_id"])) or (prev.get("ads", {}).get("t" + x["ad_id"]) or {}).get("thumb"),
                link=f"https://www.tiktok.com/embed/v2/{x['tiktok_item_id']}" if x.get("tiktok_item_id") else None,
                goal=GOAL.get(obj.get(x.get("campaign_id"), ""), "other"))
            # Recomputed from this run's data every time: a changed link or ad group must be able to clear the tag
            dest = dest_for(x, goal=ads["t" + x["ad_id"]]["goal"])
            if dest:
                ads["t" + x["ad_id"]]["dest"] = dest

    new, days = [], set()
    if excluded_pull:
        a.days = []
    for path in a.days:
        d = payload(path)
        if (d.get("page_info") or {}).get("total_page", 1) != 1:
            raise SystemExit(f"{path}: more than one page, fetch with page_size 1000 or split the dates")
        for r in d.get("list", []):
            day = r["dimensions"]["stat_time_day"][:10]; days.add(day)
            m = r["metrics"]; sp, im = round(float(m.get("spend") or 0), 2), int(float(m.get("impressions") or 0))
            if sp or im:
                ad_id = str(r["dimensions"]["ad_id"])
                if ad_id in skipped:
                    continue
                new.append(["t" + ad_id, day, sp, im, int(float(m.get("clicks") or 0)), float(m.get("conversion") or 0), conversations(m)])
    rows = [r for r in prev.get("rows", []) if r[1] not in days] + new
    rows.sort(key=lambda r: (r[1], r[0]))
    missing = sorted({r[0] for r in rows} - set(ads))
    if missing:
        print("تنبيه: إعلانات لها أرقام بدون تفاصيل:", missing)

    organic = prev.get("organic")
    if a.organic:
        organic = json.load(open(a.organic, encoding="utf-8"))
    now = datetime.now(timezone(timedelta(hours=3))).isoformat(timespec="minutes")
    out = {"generated_at": now, "source": "TikTok for Business connector (Claude)", "objectives": obj, "ads": ads, "rows": rows}
    if not excluded_pull and (a.advertiser_id or a.advertiser_name):
        out["advertiser_id"] = a.advertiser_id
        out["advertiser_name"] = a.advertiser_name
    elif not excluded_pull:
        if prev.get("advertiser_id"):
            out["advertiser_id"] = prev.get("advertiser_id")
        if prev.get("advertiser_name"):
            out["advertiser_name"] = prev.get("advertiser_name")
    if organic:
        out["organic"] = organic
    json.dump(out, open(a.out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    if a.covers:
        print(f"أغلفة: {len(covers)} جديدة | {sum(1 for v in ads.values() if v.get('thumb'))} من {len(ads)} إعلان لها صورة")
    # Public Actions log (also the last line tiktok/mcp.py repeats): spend and leads only with PIPELINE_DEBUG=1
    figures = f" | صرف {sum(r[2] for r in rows):.2f} | ليدز {sum(r[5] for r in rows):.0f}" if os.environ.get("PIPELINE_DEBUG") == "1" else ""
    print(f"tiktok: {len(ads)} إعلان ({sum(v['live'] for v in ads.values())} نشط) | {len(rows)} صف{figures} | "
          f"{rows[0][1] if rows else '-'} → {rows[-1][1] if rows else '-'}")


if __name__ == "__main__":
    main()
