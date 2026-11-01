#!/usr/bin/env python3
"""يسحب أداء كل إعلان يوم بيوم من Meta وGoogle وSnap وTikTok، مع بيانات الكرييتف وصورة مصغرة.

الأوضاع:
  python3 fetch_data.py            سحب كامل من بداية الحسابات (أول حملة) إلى اليوم الحالي (جزئي)
  RECENT=8 python3 fetch_data.py   تحديث سريع: يعيد سحب آخر 8 أيام + اليوم، ويحتفظ بالباقي من data.json
  RECENT=3 ...                     مع Supabase: كل ساعة تعيد آخر 3 أيام (الإحالة المتأخرة) وتحدّث القاعدة فقط
  RECENT=90 ...                    التحديث اليومي: يعيد آخر 90 يوم (التحويلات المتأخرة) ويحتفظ بالتاريخ الأقدم
  START=2025-01-01 ...             يفرض بداية السحب الكامل بدل الاكتشاف التلقائي

المخرجات: data.json  {ads: {key: meta}, rows: [[key, date, spend, impr, clicks, leads], ...]}
- كل المبالغ بالريال (Meta بالدولار × 3.75، وتيك توك كذلك إذا كانت عملة الحساب الدولار).
- النقرات: ميتا = نقرات الرابط، جوجل = النقرات، سناب = السوايب، تيك توك = clicks.
- الليدز: ميتا = action_type "lead"، جوجل = conversions، سناب = native_leads، تيك توك = conversion.
- تيك توك من Marketing API إن وُجد TIKTOK_ACCESS_TOKEN و TIKTOK_ADVERTISER_IDS، وإلا من فرع tiktok-data.
- إذا فشلت منصة، تبقى آخر بيانات كاملة لها مع علامة stale_from. لا يطبع أي توكن.
"""
import json, os, re, sys, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from channels import GOOGLE_FORMAT, annotate, family_of, google_platform, meta_key, placement_platform
from classify import apply_all, public_config
from common import env, http
from organic import collect_organic, clip as clip_err
from tiktok.fetch import ingest_tiktok

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(HERE, "data.json")
CACHE_PATH = os.path.join(HERE, "cache_ads.json")
RIYADH = timezone(timedelta(hours=3))
USD_SAR = 3.75
SCHEMA = 3   # 3: يعيد السحب الكامل إذا اللقطة بلا publisher_platform أو بلا نوع حملة جوجل
E = env()

TODAY = datetime.now(RIYADH).replace(hour=0, minute=0, second=0, microsecond=0)   # اليوم الحالي (جزئي)
LAST_FULL = TODAY - timedelta(days=1)                                              # آخر يوم مكتمل
ds = lambda d: d.strftime("%Y-%m-%d")


def tiktok_coverage_end(generated_at, row_dates):
    """آخر يوم يغطيه ملف تيك توك: تاريخ السحب، أو آخر صف إذا كان أحدث."""
    synced = generated_at or ""
    synced_day = synced[:10] if len(synced) >= 10 and synced[4] == "-" else ""
    row_end = max(row_dates, default="")
    return max(synced_day, row_end)
PREV = None
RECENT = 0
FROM = None
RANGE_START = None
TO = TODAY
CACHE = {}

STATUS_AR = {"ACTIVE": "نشط", "ENABLED": "نشط", "PAUSED": "متوقف", "ADSET_PAUSED": "المجموعة متوقفة",
             "CAMPAIGN_PAUSED": "الحملة متوقفة", "DISAPPROVED": "مرفوض", "PENDING_REVIEW": "قيد المراجعة",
             "WITH_ISSUES": "فيه مشكلة", "ARCHIVED": "مؤرشف", "DELETED": "محذوف", "REMOVED": "محذوف",
             "IN_PROCESS": "قيد المعالجة", "PREAPPROVED": "موافق مبدئياً",
             # حالة الفوترة لا تُعرض: المالك طلب إخفاء أي تنبيه رصيد أو سداد أو شحن
             "PENDING_BILLING_INFO": "متوقف"}

def retry(fn, *a, tries=6, **k):
    """يعيد المحاولة عند تجاوز حد الطلبات (ميتا 4/17/32/613، سناب وجوجل 429)."""
    wait = 30
    for n in range(tries):
        try:
            return fn(*a, **k)
        except RuntimeError as ex:
            msg = str(ex)
            limited = ("HTTP 429" in msg or '"code":4,' in msg or '"code":17,' in msg or '"code":32,' in msg
                       or '"code":613,' in msg or "request limit" in msg.lower())
            if not limited or n == tries - 1: raise
            print(f"  حد الطلبات: انتظار {wait} ثانية", file=sys.stderr, flush=True)
            time.sleep(wait); wait = min(wait * 2, 600)

def windows(start, end, size=30):
    """يقسم الفترة [start, end] لقطع حجمها size يوم كحد أقصى."""
    s = start
    while s <= end:
        e = min(s + timedelta(days=size - 1), end)
        yield s, e
        s = e + timedelta(days=1)

def thumb(url):
    """يضمّن الصورة وقت السحب. رابط شبكة التوصيل بدون User-Agent يُرفض فيُعامل كصورة مكسورة."""
    from organic import _embed_thumb
    return _embed_thumb(url)

def keep_thumb(key, fresh_meta, url):
    """يستخدم الصورة المحفوظة إذا موجودة، وإلا ينزّلها."""
    old = CACHE.get(key, {})
    fresh_meta["thumb"] = old.get("thumb") or thumb(url)
    return fresh_meta

def vid_doc(impr, views, quart, done, avg_s=None):
    """مقاييس الفيديو مدى الحياة لكل إعلان: i ظهور، v مشاهدات أول ثواني (ميتا 3ث، سناب 2ث)،
    q ربع/نص/ثلاثة أرباع/كامل، c اكتمال، t متوسط المشاهدة بالثواني. لا شي إذا ما فيه مشاهدات."""
    views = int(float(views or 0))
    if not views:
        return None
    out = {"i": int(float(impr or 0)), "v": views, "q": [int(float(x or 0)) for x in quart], "c": int(float(done or 0))}
    if avg_s:
        out["t"] = round(float(avg_s), 1)
    return out


class Plat:
    """يجمع نتائج منصة وحدة، وما تنضاف للبيانات إلا إذا نجح السحب كامل."""
    def __init__(self):
        self.ads, self.rows = {}, []
        self.status_catalog = False

    def row(self, key, date, spend, impr, clicks, leads, conv=0):
        if spend or impr or clicks or leads or conv:
            self.rows.append([key, date, round(float(spend), 2), int(impr), int(clicks), round(float(leads), 2), int(conv)])


def google_delivery(ad_status, group_status, campaign_status):
    """نشط فقط إذا الإعلان والمجموعة والحملة كلها ENABLED."""
    live = ad_status == "ENABLED" and group_status == "ENABLED" and campaign_status == "ENABLED"
    return ("نشط" if live else "متوقف"), live


def meta_preview(creative, video_url=None):
    """رابط يشاهد الكرييتف: منشور إنستغرام، ثم منشور فيسبوك، ثم ملف الفيديو، ثم الصورة."""
    creative = creative or {}
    ig = creative.get("instagram_permalink_url")
    if isinstance(ig, str) and ig.startswith("http"):
        return ig
    story = creative.get("effective_object_story_id") or creative.get("object_story_id")
    if story:
        return "https://www.facebook.com/" + str(story)
    if isinstance(video_url, str) and video_url.startswith("http"):
        return video_url
    img = creative.get("image_url")
    if isinstance(img, str) and img.startswith("http"):
        return img
    return None


def browser_media_url(url):
    if not isinstance(url, str) or not url.startswith("http") or "adsapi.snapchat.com" in url:
        return None
    return url


def carry_forward(prev_ads, fresh_ads, prefix):
    """إعلان غاب عن سحب ناجح لحالة التسليم. إذا كان نشطاً صار متوقفاً، وغير ذلك تبقى حالته."""
    out = {}
    fresh_ads = fresh_ads or {}
    for key, ad in (prev_ads or {}).items():
        if not key or key[0] != prefix or key in fresh_ads or not isinstance(ad, dict):
            continue
        if ad.get("live") or ad.get("status") == "نشط":
            kept = {**ad, "live": False}
            if kept.get("status") in ("نشط", None, ""):
                kept["status"] = "متوقف"
            out[key] = kept
        else:
            out[key] = ad
    return out

GOALS = {"lead": "ليدز", "messages": "محادثات", "profile": "زيارات البروفايل", "traffic": "زيارات الموقع", "other": "أخرى"}
def meta_goal(opt):
    if opt in ("QUALITY_LEAD", "LEAD_GENERATION", "OFFSITE_CONVERSIONS"): return "lead"
    if opt in ("REPLIES", "CONVERSATIONS"): return "messages"
    if opt == "PROFILE_VISIT": return "profile"
    if opt in ("LINK_CLICKS", "LANDING_PAGE_VIEWS"): return "traffic"
    return "other"

# ---------------- Meta ----------------
def meta(P):
    T, A = E["META_ACCESS_TOKEN"], E["META_AD_ACCOUNT_ID"]
    g = lambda p, **q: retry(http, f"https://graph.facebook.com/v23.0/{p}?" + urllib.parse.urlencode({**q, "access_token": T}))
    def pages(r):
        while True:
            yield from r.get("data", [])
            nxt = r.get("paging", {}).get("next")
            if not nxt: return
            r = retry(http, nxt)
    act = lambda acts, t: next((int(a["value"]) for a in acts or [] if a["action_type"] == t), 0)
    ids, goal = set(), {}
    for s, e in windows(FROM, TO):
        for x in pages(g(f"{A}/insights", level="ad", time_increment=1, limit=500,
                         breakdowns="publisher_platform",
                         time_range=json.dumps({"since": ds(s), "until": ds(e)}),
                         fields="ad_id,spend,impressions,inline_link_clicks,actions")):
            ids.add(x["ad_id"])
            key, _plat = meta_key(x["ad_id"], x.get("publisher_platform"))
            P.row(key, x["date_start"], float(x.get("spend", 0)) * USD_SAR,
                  x.get("impressions", 0), x.get("inline_link_clicks", 0), act(x.get("actions"), "lead"),
                  act(x.get("actions"), "onsite_conversion.messaging_conversation_started_7d"))
    f = ("name,effective_status,adset{name,effective_status,optimization_goal},campaign{name,effective_status},"
         "creative.thumbnail_width(320).thumbnail_height(320){thumbnail_url,image_url,title,body,object_type,video_id,"
         "instagram_permalink_url,effective_object_story_id,object_story_id}")
    def meta_live(a):
        """نشط فقط إذا الإعلان ومجموعته وحملته ACTIVE. effective_status للإعلان يشمل الأهل، والحقل الصريح يُغلِق الحالة إذا رجع غير ACTIVE."""
        st = a.get("effective_status", "")
        adset = (a.get("adset") or {}).get("effective_status")
        camp = (a.get("campaign") or {}).get("effective_status")
        if st != "ACTIVE":
            return False
        if adset not in (None, "ACTIVE") or camp not in (None, "ACTIVE"):
            return False
        return True
    def meta_word(a, live):
        st = a.get("effective_status", "")
        if live:
            return "نشط"
        if st == "ACTIVE":
            if (a.get("adset") or {}).get("effective_status") != "ACTIVE":
                return "المجموعة متوقفة"
            return "الحملة متوقفة"
        return STATUS_AR.get(st, st or "متوقف")
    def build(ad_id, a, platform):
        c = a.get("creative", {})
        live = meta_live(a)
        m = dict(platform=platform, family="meta", name=a["name"].strip("‎ "), campaign=a["campaign"]["name"].strip("‎ "),
                 group=a["adset"]["name"].strip("‎ "),
                 format="فيديو" if (c.get("video_id") or c.get("object_type") == "VIDEO") else "صورة",
                 status=meta_word(a, live), live=live, text=(c.get("body") or c.get("title") or "").strip(),
                 link=f"https://adsmanager.facebook.com/adsmanager/manage/ads?act={A[4:]}&selected_ad_ids={ad_id}")
        m["goal"] = goal.get(ad_id) or meta_goal(a["adset"].get("optimization_goal"))
        # الصورة المحفوظة قد تكون تحت المفتاح القديم m{id} أو تحت موضع واحد.
        old = CACHE.get("m" + ad_id) or next((CACHE[k] for k in CACHE if k.startswith("m" + ad_id + "|") and CACHE[k].get("thumb")), {})
        fresh = keep_thumb("m" + ad_id, m, c.get("image_url") or c.get("thumbnail_url"))
        if not fresh.get("thumb") and old.get("thumb"):
            fresh["thumb"] = old["thumb"]
        vid = c.get("video_id")
        if vid and not fresh.get("video"):
            cached = old.get("video") if isinstance(old, dict) else None
            if cached:
                fresh["video"] = cached
            else:
                try:
                    clip = g(vid, fields="source,picture")
                    if clip.get("source"):
                        fresh["video"] = clip["source"]
                    if not fresh.get("thumb") and clip.get("picture"):
                        fresh["thumb"] = keep_thumb("m" + ad_id, {}, clip["picture"]).get("thumb")
                except Exception:
                    pass
        image = c.get("image_url")
        if isinstance(image, str) and image.startswith("http"):
            fresh["image_url"] = image
        preview = meta_preview(c, fresh.get("video"))
        if preview:
            fresh["preview_url"] = preview
        return fresh
    # الإعلانات النشطة: بيانات حديثة دايماً
    active = {a["id"]: a for a in pages(g(f"{A}/ads", fields=f, limit=100, effective_status=json.dumps(["ACTIVE"])))}
    def place(ad_id, a, live_override=None):
        """نسخة من الإعلان لكل موضع صرف. الإعلان النشط بلا صرف يبقى تحت ميتا غير المفصولة."""
        keys = [k for k in {r[0] for r in P.rows} if k.startswith("m" + ad_id + "|")]
        if not keys:
            if live_override or (a and meta_live(a)):
                P.ads["m" + ad_id] = build(ad_id, a, "meta")
            return
        for key in keys:
            P.ads[key] = build(ad_id, a, meta_key(ad_id, key.split("|", 1)[1])[1])
    for ad_id, a in active.items():
        place(ad_id, a, True)
    # إعلانات صرفت وما هي نشطة الآن. المحفوظة نستخدمها كما هي (حالتها غير نشطة أكيد لأنها مو في قائمة النشطة).
    # الجديدة نطلبها واحد واحد، لأن تطبيق ميتا حدوده منخفضة.
    for ad_id in ids - set(active):
        keys = [k for k in {r[0] for r in P.rows} if k.startswith("m" + ad_id + "|")] or ["m" + ad_id]
        if all(CACHE.get(k) or CACHE.get("m" + ad_id) for k in keys):
            base = CACHE.get("m" + ad_id) or {}
            for key in keys:
                old = CACHE.get(key) or base
                if not old:
                    continue
                plat = meta_key(ad_id, key.split("|", 1)[1])[1] if "|" in key else old.get("platform", "meta")
                P.ads[key] = {**old, "platform": plat, "family": "meta", "live": False,
                              "goal": goal.get(ad_id, old.get("goal", "other")),
                              "status": old["status"] if old.get("status") not in ("نشط", None) else "متوقف"}
            continue
        try:
            a = g(ad_id, fields=f); time.sleep(0.3)
            place(ad_id, a)
        except RuntimeError:
            pass   # يطلع باسم "إعلان محذوف" وأرقامه محسوبة
    P.status_catalog = True
    # مقاييس الفيديو للبرودكشن. اختيارية: فشلها ما يوقف سحب ميتا.
    try:
        first = lambda xs: float((xs or [{}])[0].get("value") or 0)
        got = 0
        for x in pages(g(f"{A}/insights", level="ad", date_preset="maximum", limit=500,
                         fields="ad_id,impressions,actions,video_p25_watched_actions,video_p50_watched_actions,"
                                "video_p75_watched_actions,video_p100_watched_actions,video_avg_time_watched_actions")):
            doc = vid_doc(x.get("impressions"), act(x.get("actions"), "video_view"),
                          [first(x.get(f"video_p{n}_watched_actions")) for n in (25, 50, 75, 100)],
                          first(x.get("video_p100_watched_actions")), first(x.get("video_avg_time_watched_actions")))
            if not doc:
                continue
            for key in [k for k in P.ads if k == "m" + x["ad_id"] or k.startswith("m" + x["ad_id"] + "|")]:
                P.ads[key]["vid"] = doc; got += 1
        print(f"meta: مقاييس فيديو لـ {got} إعلان", file=sys.stderr)
    except Exception as ex:
        print("meta: مقاييس الفيديو ما انسحبت —", str(ex)[:160], file=sys.stderr)

# ---------------- Google ----------------
def google(P):
    tok = http("https://oauth2.googleapis.com/token", data=urllib.parse.urlencode({
        "client_id": E["GOOGLE_ADS_CLIENT_ID"], "client_secret": E["GOOGLE_ADS_CLIENT_SECRET"],
        "refresh_token": E["GOOGLE_ADS_REFRESH_TOKEN"], "grant_type": "refresh_token"}).encode())["access_token"]
    q = lambda query: retry(http, f"https://googleads.googleapis.com/v24/customers/{E['GOOGLE_ADS_CUSTOMER_ID']}/googleAds:search",
        data=json.dumps({"query": query}).encode(), method="POST",
        headers={"Authorization": f"Bearer {tok}", "login-customer-id": E["GOOGLE_ADS_LOGIN_CUSTOMER_ID"],
                 "Content-Type": "application/json"}).get("results", [])
    for r in q("SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.responsive_search_ad.headlines, "
               "ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.ad.final_urls, ad_group_ad.status, "
               "ad_group.status, campaign.status, campaign.advertising_channel_type, campaign.advertising_channel_sub_type, "
               "ad_group.name, campaign.name, segments.date, metrics.cost_micros, "
               "metrics.impressions, metrics.clicks, metrics.conversions FROM ad_group_ad "
               f"WHERE segments.date BETWEEN '{ds(FROM)}' AND '{ds(TO)}'"):
        ad, m, camp = r["adGroupAd"]["ad"], r.get("metrics", {}), r["campaign"]
        key = "g" + ad["id"]
        plat = google_platform(camp.get("advertisingChannelType"), camp.get("advertisingChannelSubType"))
        if key not in P.ads:
            rsa = ad.get("responsiveSearchAd", {})
            heads = [h["text"] for h in rsa.get("headlines", [])]
            desc = [d["text"] for d in rsa.get("descriptions", [])]
            word, live = google_delivery(r["adGroupAd"]["status"], r["adGroup"]["status"], r["campaign"]["status"])
            P.ads[key] = dict(platform=plat, family="google",
                              channel=camp.get("advertisingChannelType") or "",
                              name=ad.get("name") or (heads[0] if heads else ad["id"]),
                              campaign=camp["name"], group=r["adGroup"]["name"], format=GOOGLE_FORMAT.get(plat, "إعلان"),
                              status=word, live=live, text="\n".join(heads[:5] + desc[:2]),
                              thumb=None, link=(ad.get("finalUrls") or [None])[0], goal="lead")
        else:
            word, live = google_delivery(r["adGroupAd"]["status"], r["adGroup"]["status"], r["campaign"]["status"])
            P.ads[key]["status"] = word
            P.ads[key]["live"] = live
        P.row(key, r["segments"]["date"], int(m.get("costMicros", 0)) / 1e6, m.get("impressions", 0),
              m.get("clicks", 0), float(m.get("conversions", 0)))
    # حالة كل إعلان حتى الذي بلا صرف في النافذة. بدونها يُعلَّم النشط خطأً كمتوقف.
    try:
        for r in q("SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.final_urls, ad_group_ad.status, "
                   "ad_group.status, campaign.status, campaign.advertising_channel_type, campaign.advertising_channel_sub_type, "
                   "ad_group.name, campaign.name FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED'"):
            ad, camp = r["adGroupAd"]["ad"], r["campaign"]
            key = "g" + ad["id"]
            word, live = google_delivery(r["adGroupAd"]["status"], r["adGroup"]["status"], camp["status"])
            plat = google_platform(camp.get("advertisingChannelType"), camp.get("advertisingChannelSubType"))
            if key in P.ads:
                P.ads[key]["status"] = word
                P.ads[key]["live"] = live
                continue
            P.ads[key] = dict(platform=plat, family="google", channel=camp.get("advertisingChannelType") or "",
                              name=ad.get("name") or ad["id"], campaign=camp["name"], group=r["adGroup"]["name"],
                              format=GOOGLE_FORMAT.get(plat, "إعلان"), status=word, live=live, text="",
                              thumb=None, link=(ad.get("finalUrls") or [None])[0], goal="lead")
        P.status_catalog = True
    except Exception as ex:
        print("جوجل: تعذر تحديث حالة الإعلانات بلا صرف", str(ex)[:160], file=sys.stderr)

# ---------------- Snapchat ----------------
def snap(P):
    tok = http("https://accounts.snapchat.com/login/oauth2/access_token", data=urllib.parse.urlencode({
        "grant_type": "refresh_token", "client_id": E["SNAP_CLIENT_ID"], "client_secret": E["SNAP_CLIENT_SECRET"],
        "refresh_token": E["SNAP_REFRESH_TOKEN"]}).encode())["access_token"]
    H = {"Authorization": f"Bearer {tok}"}
    g = lambda p, **q: retry(http, f"https://adsapi.snapchat.com/v1/{p}" + ("?" + urllib.parse.urlencode(q) if q else ""), headers=H)
    A = E["SNAP_AD_ACCOUNT_ID"]
    camps = {c["campaign"]["id"]: c["campaign"] for c in g(f"adaccounts/{A}/campaigns")["campaigns"]}
    squads = {s["adsquad"]["id"]: s["adsquad"] for s in g(f"adaccounts/{A}/adsquads")["adsquads"]}
    ads = {a["ad"]["id"]: a["ad"] for a in g(f"adaccounts/{A}/ads")["ads"]}
    seen = set()
    for cid in camps:
        made = camps[cid].get("created_at")
        c_from = max(FROM, datetime.strptime(made[:10], "%Y-%m-%d").replace(tzinfo=RIYADH)) if made else FROM
        for s, e in windows(c_from, TO):   # سناب يقبل 31 يوم كحد أقصى للتقسيم اليومي. أي خطأ يوقف السحب كامل
            st = g(f"campaigns/{cid}/stats", granularity="DAY", breakdown="ad",
                   fields="impressions,swipes,spend,native_leads",
                   start_time=s.strftime("%Y-%m-%dT00:00:00+03:00"),
                   end_time=(e + timedelta(days=1)).strftime("%Y-%m-%dT00:00:00+03:00"))
            for b in st["timeseries_stats"][0]["timeseries_stat"].get("breakdown_stats", {}).get("ad", []):
                for t in b.get("timeseries", []):
                    x = t.get("stats", {})
                    if x.get("spend") or x.get("impressions"):
                        seen.add(b["id"])
                        P.row("s" + b["id"], t["start_time"][:10], x.get("spend", 0) / 1e6, x.get("impressions", 0),
                              x.get("swipes", 0), x.get("native_leads", 0))
    def is_live(a):
        sq = squads.get(a["ad_squad_id"], {})
        return a["status"] == "ACTIVE" and sq.get("status") == "ACTIVE" and camps.get(sq.get("campaign_id"), {}).get("status") == "ACTIVE"
    def delivery(a):
        """الكلمة والشارة من قاعدة واحدة: الإعلان والمجموعة والحملة كلها ACTIVE. الصرف لا يغيّر الحالة."""
        sq = squads.get(a["ad_squad_id"], {})
        camp = camps.get(sq.get("campaign_id"), {})
        if is_live(a):
            return "نشط", True
        if a.get("status") != "ACTIVE":
            return STATUS_AR.get(a.get("status"), "متوقف"), False
        if sq.get("status") != "ACTIVE":
            return "المجموعة متوقفة", False
        if camp.get("status") != "ACTIVE":
            return "الحملة متوقفة", False
        return "متوقف", False
    def build(a):
        key, sq = "s" + a["id"], squads[a["ad_squad_id"]]
        word, live = delivery(a)
        base = dict(platform="snap", family="snap", name=a["name"], campaign=camps[sq["campaign_id"]]["name"], group=sq["name"],
                    status=word, live=live,
                    goal="lead" if camps[sq["campaign_id"]].get("objective") in ("LEADS", "LEAD_GENERATION") else "other")
        old = CACHE.get(key, {})
        if old.get("thumb") and old.get("media_type"):
            merged = {**old, **base}
            preview = browser_media_url(merged.get("preview_url")) or browser_media_url(merged.get("video"))
            if preview:
                merged["preview_url"] = preview
                return key, merged
            try:
                cr = g(f"creatives/{a['creative_id']}")["creatives"][0]["creative"]
                mid = cr.get("top_snap_media_id")
                info = g(f"media/{mid}")["media"][0]["media"] if mid else {}
                dl = browser_media_url(info.get("download_link"))
                if dl:
                    merged["preview_url"] = dl
                    if (info.get("type") or merged.get("media_type")) == "VIDEO":
                        merged["video"] = dl
            except Exception:
                pass
            return key, merged
        cr = g(f"creatives/{a['creative_id']}")["creatives"][0]["creative"]
        mid = cr.get("top_snap_media_id")
        info = g(f"media/{mid}")["media"][0]["media"] if mid else {}
        mt = info.get("type")
        def link(kind):   # سناب ما يوفر المعاينة إلا للفيديو، وأي خطأ هنا ما يوقف السحب
            if not mid:
                return None
            attempts = 3 if kind == "thumbnail" else 1
            for n in range(attempts):
                try:
                    return g(f"media/{mid}/{kind}").get("link")
                except RuntimeError:
                    if n == attempts - 1:
                        return None
                    time.sleep(0.5)
        def embed_thumb(url):
            """يعيد جلب صورة سناب الناقصة. رابط المعاينة يفشل أحيانًا من أول طلب."""
            if not url:
                return None
            for n in range(3):
                got = thumb(url)
                if got:
                    return got
                if n < 2:
                    time.sleep(0.5)
            return None
        tl = link("thumbnail")
        pv = link("preview") if mt == "VIDEO" else tl
        video = browser_media_url(info.get("download_link")) if mt == "VIDEO" else None
        # رابط المعاينة على adsapi يرجع 403 في المتصفح. إذا التحويل وصل لملف عام نحتفظ به.
        if not video and pv and mt == "VIDEO" and "adsapi.snapchat.com" in pv:
            try:
                req = urllib.request.Request(pv, headers={"Authorization": H["Authorization"], "User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=30) as r:
                    final, ctype = r.geturl(), (r.headers.get("Content-Type") or "").lower()
                if final and "adsapi.snapchat.com" not in final and ("video/" in ctype or re.search(r"\.(mp4|webm|mov)(\?|$)", final, re.I)):
                    video = final
            except Exception:
                video = None
        m = {**base, "format": "فيديو" if mt == "VIDEO" else "صورة", "media_type": mt,
             "text": (cr.get("headline") or "").strip(), "link": video or pv, "video": video}
        preview = browser_media_url(video) or browser_media_url(info.get("download_link"))
        if preview:
            m["preview_url"] = preview
        cached = CACHE.get(key, {}).get("thumb")
        m["thumb"] = cached or embed_thumb(tl)
        return key, m
    def safe(a):   # إعلان واحد بدون تفاصيل ما يلغي أرقام سناب كلها
        try: return build(a)
        except Exception as ex:
            print("سناب: تفاصيل إعلان ناقصة", a["id"], str(ex)[:120], file=sys.stderr)
            return None
    show = [a for a in ads.values() if (a["id"] in seen or is_live(a)) and a.get("ad_squad_id") in squads]
    with ThreadPoolExecutor(6) as ex:
        for r in ex.map(safe, show):
            if r: P.ads[r[0]] = r[1]
    P.status_catalog = True
    # مقاييس الفيديو للبرودكشن، مدى الحياة لكل إعلان. اختيارية: فشلها ما يوقف سحب سناب.
    try:
        got, end = 0, (TO + timedelta(days=1)).strftime("%Y-%m-%dT00:00:00+03:00")
        for cid in {squads[a["ad_squad_id"]]["campaign_id"] for a in show}:
            made = (camps.get(cid) or {}).get("created_at") or ds(FROM)
            st = g(f"campaigns/{cid}/stats", granularity="TOTAL", breakdown="ad",
                   fields="impressions,video_views,quartile_1,quartile_2,quartile_3,view_completion,avg_view_time_millis",
                   start_time=made[:10] + "T00:00:00+03:00", end_time=end)
            for b in st["total_stats"][0]["total_stat"].get("breakdown_stats", {}).get("ad", []):
                x, key = b.get("stats", {}), "s" + b["id"]
                doc = vid_doc(x.get("impressions"), x.get("video_views"),
                              [x.get("quartile_1"), x.get("quartile_2"), x.get("quartile_3"), x.get("view_completion")],
                              x.get("view_completion"), (x.get("avg_view_time_millis") or 0) / 1000)
                if doc and key in P.ads:
                    P.ads[key]["vid"] = doc; got += 1
        print(f"snap: مقاييس فيديو لـ {got} إعلان", file=sys.stderr)
    except Exception as ex:
        print("snap: مقاييس الفيديو ما انسحبت —", str(ex)[:160], file=sys.stderr)

# ---------------- بداية التاريخ ----------------
def history_start():
    """أقدم تاريخ إعلاني: إنشاء حساب ميتا وأول حملة في سناب. جوجل يُسحب من نفس البداية."""
    if os.environ.get("START"):
        return datetime.strptime(os.environ["START"], "%Y-%m-%d").replace(tzinfo=RIYADH)
    found = []
    try:
        acc = retry(http, f"https://graph.facebook.com/v23.0/{E['META_AD_ACCOUNT_ID']}?" + urllib.parse.urlencode(
            {"fields": "created_time", "access_token": E["META_ACCESS_TOKEN"]}))
        found.append(datetime.strptime(acc["created_time"][:10], "%Y-%m-%d"))
    except Exception as ex:
        print("ميتا: تعذر معرفة تاريخ الحساب", str(ex)[:120], file=sys.stderr)
    try:
        tok = http("https://accounts.snapchat.com/login/oauth2/access_token", data=urllib.parse.urlencode({
            "grant_type": "refresh_token", "client_id": E["SNAP_CLIENT_ID"], "client_secret": E["SNAP_CLIENT_SECRET"],
            "refresh_token": E["SNAP_REFRESH_TOKEN"]}).encode())["access_token"]
        cs = retry(http, f"https://adsapi.snapchat.com/v1/adaccounts/{E['SNAP_AD_ACCOUNT_ID']}/campaigns",
                   headers={"Authorization": f"Bearer {tok}"})["campaigns"]
        found += [datetime.strptime(c["campaign"]["created_at"][:10], "%Y-%m-%d") for c in cs if c["campaign"].get("created_at")]
    except Exception as ex:
        print("سناب: تعذر معرفة أول حملة", str(ex)[:120], file=sys.stderr)
    start = min(found) if found else TODAY.replace(tzinfo=None) - timedelta(days=365)
    start = max(start, TODAY.replace(tzinfo=None) - timedelta(days=37 * 30))   # ميتا يحتفظ بـ 37 شهر فقط
    return start.replace(tzinfo=RIYADH)

def load_json(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None


def configure_window(prev, recent_req):
    """يرجع (recent, from, range_start). لقطة قديمة أو بلا تاريخ تُسحب كاملة."""
    if prev and prev.get("schema", 1) < SCHEMA and recent_req:
        print("تحديث البنية: سحب كامل بدل التحديث الجزئي", file=sys.stderr)
        recent_req = 0
    start = (prev or {}).get("range", {}).get("start") if prev else None
    if recent_req and prev and start:
        return recent_req, TODAY - timedelta(days=recent_req), start
    return 0, None, None


def choose_history(file_prev, bundle):
    """القاعدة إذا فيها صفوف وأحدث من الملف. الملف الأحدث يُكتب كاملاً حتى لا يضيع سحب فشل حفظه."""
    has_rows = bool(bundle and (bundle.get("ads") or bundle.get("rows")))
    if not has_rows:
        return file_prev, False, False
    file_at = (file_prev or {}).get("generated_at") or ""
    db_at = bundle.get("generated_at") or ""
    if file_prev and file_at > db_at:
        return file_prev, True, True
    return bundle, True, False


def main():
    global PREV, RECENT, FROM, RANGE_START, CACHE
    file_prev = load_json(DATA_PATH)
    CACHE = load_json(CACHE_PATH) or {}
    supa_on = False
    supa_rows = False
    file_newer = False
    try:
        import supabase_store
        supa_on = supabase_store.enabled()
    except Exception as ex:
        supabase_store = None
        print("supabase: تعذر التحميل —", str(ex)[:200], file=sys.stderr)
    if supa_on:
        try:
            bundle = supabase_store.load_bundle()
            PREV, supa_rows, file_newer = choose_history(file_prev, bundle)
            if supa_rows and not file_newer:
                print("supabase: تمت القراءة", file=sys.stderr)
            elif supa_rows and file_newer:
                print("supabase: الملف المحلي أحدث، سيُكتب التاريخ كامل", file=sys.stderr)
            else:
                PREV = file_prev
                print("supabase: القاعدة فاضية، السحب من الملف أو كامل", file=sys.stderr)
        except Exception as ex:
            PREV = file_prev
            print("supabase: تعذرت القراءة —", str(ex)[:200], file=sys.stderr)
    else:
        PREV = file_prev
        print("supabase: غير مفعّل", file=sys.stderr)

    recent_req = int(os.environ.get("RECENT", "0"))
    RECENT, FROM, RANGE_START = configure_window(PREV, recent_req)
    if FROM is None:
        FROM = history_start()
        RANGE_START = ds(FROM)
        print("سحب كامل من", RANGE_START, file=sys.stderr)

    ADS, ROWS, status, HEALTH = {}, [], {}, {}
    from_s = ds(FROM)
    for name, fn in (("meta", meta), ("google", google), ("snap", snap)):
        p = name[0]
        P = Plat()
        try:
            fn(P)
            old_rows = [(r + [0])[:7] for r in (PREV or {}).get("rows", []) if r[0][0] == p and r[1] < from_s] if RECENT else []
            ROWS += old_rows + P.rows
            if RECENT:
                if P.status_catalog:
                    ADS.update(carry_forward((PREV or {}).get("ads"), P.ads, p))
                else:
                    for key, ad in (PREV or {}).get("ads", {}).items():
                        if key and key[0] == p and key not in P.ads:
                            ADS[key] = ad
            ADS.update(P.ads)
            status[name] = {"ok": True, **HEALTH.get(name, {}), "coverage_start": RANGE_START, "coverage_end": ds(TO)}
            CACHE.update(P.ads)
        except Exception as ex:
            stale = None
            if PREV:
                ROWS += [r for r in PREV.get("rows", []) if r[0][0] == p]
                ADS.update({k: v for k, v in PREV.get("ads", {}).items() if k[0] == p})
                ps = PREV.get("platforms", {}).get(name, {})
                stale = ps.get("stale_from") or (PREV.get("generated_at") if ps.get("ok") else None)
            status[name] = {"ok": False, "error": str(ex)[:300], "stale_from": stale}
            print(f"{name}: فشل — {str(ex)[:200]}" + (f" (نعرض بيانات {stale})" if stale else ""), file=sys.stderr)

    # ---------------- TikTok (Marketing API، والفرع tiktok-data احتياط) ----------------
    TT_PATH = os.environ.get("TIKTOK_DATA", os.path.join(HERE, "tiktok-data", "tiktok.json"))
    pending = [{"platform": "tiktok", "reason": "بيانات تيك توك غير متوفرة"}]
    got = ingest_tiktok(
        E, PREV, RECENT, FROM, TO, ds(TODAY), TT_PATH, http, datetime.now(RIYADH),
        lambda prev_ads, fresh: carry_forward(prev_ads, fresh, "t"),
    )
    if got["ads"]:
        ADS.update(got["ads"])
    if got["rows"]:
        ROWS += got["rows"]
    if got["status"]:
        status["tiktok"] = got["status"]
    tiktok_blob = got["organic_blob"]
    if not got["pending"]:
        pending = []

    _FAM = {"m": "meta", "g": "google", "s": "snap", "t": "tiktok"}
    for k in {r[0] for r in ROWS} - set(ADS):
        fam = _FAM.get(k[0], "meta")
        plat = fam
        if "|" in k and k[0] == "m":
            plat = placement_platform(k.split("|", 1)[1])
        ADS[k] = dict(platform=plat, family=fam, name="إعلان محذوف", campaign="—", group="—",
                      format="", status="محذوف", live=False, text="", thumb=None, link=None, goal="other")
    apply_all(ADS)
    channels = annotate(ADS)
    try:
        organic = collect_organic(E, ds(FROM), ds(TO), (PREV or {}).get("organic"), tiktok_blob)
    except Exception as ex:
        from organic import pending_shell
        organic = pending_shell(clip_err(ex))
        print("العضوي: فشل —", clip_err(ex)[:200], file=sys.stderr)
    schema = SCHEMA if status.get("meta", {}).get("ok") else (PREV or {}).get("schema", 1)
    data = {"generated_at": datetime.now(RIYADH).isoformat(timespec="minutes"),
            "schema": schema,
            "mode": f"recent-{RECENT}" if RECENT else "full",
            "range": {"start": RANGE_START, "end": ds(LAST_FULL), "today": ds(TODAY)},
            "currency": "SAR", "usd_sar": USD_SAR, "goals": GOALS, "platforms": status,
            "departments": public_config(), "channels": channels,
            "ads": ADS, "rows": sorted(ROWS, key=lambda r: (r[1], r[0])),
            "organic": organic, "pending": pending}
    tmp = DATA_PATH + ".tmp"
    json.dump(data, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, DATA_PATH)
    json.dump(CACHE, open(CACHE_PATH, "w", encoding="utf-8"), ensure_ascii=False)
    if supa_on and supabase_store is not None:
        try:
            ok_prefixes = [name[0] for name in ("meta", "google", "snap", "tiktok") if status.get(name, {}).get("ok")]
            supabase_store.save_bundle(
                data,
                recent_from=ds(FROM) if RECENT else None,
                ok_prefixes=ok_prefixes,
                full=(not supa_rows) or file_newer or not RECENT,
            )
            print("supabase: تم الحفظ", file=sys.stderr)
        except Exception as ex:
            print("supabase: تعذر الحفظ —", str(ex)[:200], file=sys.stderr)
    for p in [x for x in ("meta", "google", "snap", "tiktok") if x in status]:
        keys = {k for k, v in ADS.items() if family_of(v.get("platform")) == p}
        rs = [r for r in ROWS if r[0] in keys]
        print(f"{p}: {status[p]['ok'] and 'تم' or 'فشل'} | {len(keys)} إعلان | صرف {round(sum(r[2] for r in rs))} ر.س | ليدز {round(sum(r[5] for r in rs))}")
    print("mode", data["mode"], "| size KB", os.path.getsize(DATA_PATH) // 1024)


if __name__ == "__main__":
    main()
