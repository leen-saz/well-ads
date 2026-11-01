"""العضوي: صفحات فيسبوك، إنستغرام wellcare.sa، تيك توك إن وُجد، وGA4 إن وُجد حساب خدمة.

أي صلاحية أو سر ناقص يُسجَّل كقسم «بانتظار» مع قائمة المطلوب، بدون إيقاف سحب الإعلانات.
"""
import base64, json, os, re, subprocess, tempfile, time, urllib.parse
from datetime import datetime, timedelta, timezone

from classify import classify_pair
from common import http

GRAPH = "https://graph.facebook.com/v23.0"
FB_PAGES = ("Well Care.",)
HIDDEN_FB_PAGES = ("Well Home Care", "Well Women Health")
IG_USER = "wellcare.sa"
PAGE_PERMS = (
    "pages_show_list",
    "pages_read_engagement",
    "pages_read_user_content",
    "read_insights",
    "مهمة ANALYZE على الصفحة",
)
IG_PERMS = ("instagram_basic", "instagram_manage_insights", "pages_show_list", "pages_read_engagement", "read_insights")
GA4_NEEDS = (
    "GA4_PROPERTY_ID في GitHub Environment production",
    "GA4_SERVICE_ACCOUNT_JSON (JSON حساب خدمة له صلاحية Viewer على خاصية GA4). أسرار Google Ads لا تكفي لأنها OAuth للإعلانات وليست حساب خدمة.",
)
TT_NEEDS = (
    "فرع tiktok-data يوفّر الإعلانات المدفوعة فقط (ad_get و report_integrated_get) ولا يوجد سر API لتيك توك.",
    "لعرض العضوي: مفتاح organic داخل tiktok.json فيه followers و reach و views و engagement و posts (caption و permalink والمقاييس)، أو صلاحية محتوى الحساب (user.info.stats و video.list) وهي غير متاحة في الموصّل الحالي.",
)

PAGE_METRICS = (
    "page_media_view",
    "page_total_media_view_unique",
    "page_post_engagements",
    "page_follows",
    "page_daily_follows_unique",
    "page_daily_unfollows_unique",
)
POST_METRICS = ("post_media_view", "post_total_media_view_unique")
IG_USER_METRICS = ("reach", "views", "accounts_engaged")
IG_MEDIA_METRICS = ("views", "reach", "saved", "shares", "total_interactions")
RIYADH = timezone(timedelta(hours=3))


def riyadh_day(stamp):
    """يوم التقويم بتوقيت الرياض. النص بلا ساعة يبقى كما هو."""
    if not stamp or len(stamp) < 10:
        return None
    if len(stamp) == 10 and stamp[4] == "-" and stamp[7] == "-":
        return stamp
    text = stamp.strip().replace("Z", "+00:00")
    if re.search(r"[+-]\d{4}$", text):
        text = text[:-2] + ":" + text[-2:]
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return stamp[:10]
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=RIYADH)
    return dt.astimezone(RIYADH).strftime("%Y-%m-%d")


def _riyadh_unix(day):
    return int(datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=RIYADH).timestamp())


def _next_day(day):
    return (datetime.strptime(day, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")


def _each_day(start, end):
    cur = datetime.strptime(start, "%Y-%m-%d")
    last = datetime.strptime(end, "%Y-%m-%d")
    while cur <= last:
        yield cur.strftime("%Y-%m-%d")
        cur += timedelta(days=1)


def clip(ex):
    s = re.sub(r"access_token=[^&\s\"']+", "access_token=…", str(ex))
    return s[:400]


def _norm(name):
    return re.sub(r"[\s.]+", " ", (name or "").casefold()).strip()


def _num(v):
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        return int(v)
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, str):
        try:
            return float(v) if "." in v else int(v)
        except ValueError:
            return None
    if isinstance(v, dict):
        total = 0
        ok = False
        for x in v.values():
            n = _num(x)
            if n is not None:
                total += n
                ok = True
        return total if ok else None
    return None


def metric_day(end_time):
    """نهاية اليوم في رؤى ميتا تقع في اليوم التالي، فنُرجع اليوم الذي يقيسه الرقم."""
    if not end_time or len(end_time) < 10:
        return None
    day = datetime.strptime(end_time[:10], "%Y-%m-%d") - timedelta(days=1)
    return day.strftime("%Y-%m-%d")


def _page(name, status="pending", needs=None, error=""):
    return {
        "status": status, "name": name, "id": None, "needs": list(needs or []), "error": error,
        "followers": None, "days": [], "posts": [],
    }


def pending_shell(error=""):
    needs = [
        "META_ACCESS_TOKEN في GitHub Environment production (نفس سر الإعلانات).",
        "صلاحيات التوكن: " + "، ".join(PAGE_PERMS) + ".",
        "الصفحات: " + "، ".join(FB_PAGES) + ".",
        "إنستغرام @" + IG_USER + ": " + "، ".join(IG_PERMS) + "، مع ربط الحساب بصفحة فيسبوك.",
    ]
    if error:
        needs = [error] + needs
    return {
        "facebook": [_page(n, needs=needs, error=error) for n in FB_PAGES],
        "instagram": [_page("@" + IG_USER, needs=needs + list(IG_PERMS), error=error)],
        "tiktok": {"status": "pending", "name": "تيك توك", "needs": list(TT_NEEDS), "error": "", "followers": None, "days": [], "posts": []},
        "ga4": {"status": "pending", "name": "GA4", "needs": list(GA4_NEEDS), "error": "", "days": [], "totals": {}, "channels": []},
    }


def visible_facebook(pages):
    """Well Home Care و Well Women Health لا يظهران في العضوي."""
    hidden = {_norm(n) for n in HIDDEN_FB_PAGES}
    return [p for p in (pages or []) if _norm((p or {}).get("name")) not in hidden]


def _permission(msg):
    m = msg.lower()
    return any(s in m for s in ("permission", "pages_read", "instagram_", "(#200)", "(#10)", "oauthexception", "(#190)"))


def _invalid_metric(msg):
    return "(#100)" in msg and "metric" in msg.lower()


def _unix(day):
    return int(datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp())


def _windows(start, end, size=90):
    s = datetime.strptime(start, "%Y-%m-%d")
    last = datetime.strptime(end, "%Y-%m-%d")
    while s <= last:
        e = min(s + timedelta(days=size - 1), last)
        yield s.strftime("%Y-%m-%d"), e.strftime("%Y-%m-%d")
        s = e + timedelta(days=1)


class Graph:
    def __init__(self, transport, token):
        self.transport = transport
        self.token = token

    def get(self, path, **q):
        url = f"{GRAPH}/{path}?" + urllib.parse.urlencode({**q, "access_token": self.token})
        return self.transport(url)

    def pages(self, first):
        r = first
        while True:
            yield from r.get("data", [])
            nxt = (r.get("paging") or {}).get("next")
            if not nxt:
                return
            r = self.transport(nxt)

    def batch(self, urls):
        out = []
        for i in range(0, len(urls), 40):
            chunk = urls[i:i + 40]
            body = urllib.parse.urlencode({
                "access_token": self.token,
                "batch": json.dumps([{"method": "GET", "relative_url": u} for u in chunk]),
            }).encode()
            res = self.transport(GRAPH + "/", data=body, method="POST")
            if not isinstance(res, list):
                raise RuntimeError("batch: رد غير متوقع")
            for item in res:
                if not isinstance(item, dict) or item.get("code") != 200:
                    body_txt = item.get("body") if isinstance(item, dict) else ""
                    out.append({"error": clip(body_txt)})
                    continue
                try:
                    out.append(json.loads(item.get("body") or "{}"))
                except json.JSONDecodeError:
                    out.append({"error": "json"})
        return out


def _parse_insights(payload):
    """يرجع (يومي, إجمالي النافذة). total_value يُستخدم عندما لا توجد سلسلة يومية."""
    by_day, totals = {}, {}
    for block in payload.get("data", []) or []:
        name = block.get("name")
        if name and isinstance(block.get("total_value"), dict):
            n = _num(block["total_value"].get("value"))
            if n is not None:
                totals[name] = (totals.get(name) or 0) + n
        for v in block.get("values") or []:
            day = metric_day(v.get("end_time") or "")
            if not day or name is None:
                continue
            n = _num(v.get("value"))
            if n is None:
                continue
            by_day.setdefault(day, {})[name] = n
    return by_day, totals


def _fetch_metric_set(graph, path, metrics, start, end, period, extra=None):
    """يسحب المقاييس التي يقبلها الإصدار، على نوافذ ٩٠ يوماً، ويتخطى الاسم غير الصالح."""
    by_day, totals, bad, working = {}, {}, [], list(metrics)
    for ws, we in _windows(start, end, 90):
        params = {"period": period, "since": _unix(ws), "until": _unix(we) + 86400}
        if extra:
            params.update(extra)
        pending = list(working)
        while pending:
            try:
                data = graph.get(path, metric=",".join(pending), **params)
                part, part_totals = _parse_insights(data)
                for day, metrics_map in part.items():
                    by_day.setdefault(day, {}).update(metrics_map)
                for key, val in part_totals.items():
                    totals[key] = (totals.get(key) or 0) + val
                working = pending
                break
            except RuntimeError as ex:
                msg = str(ex)
                if not _invalid_metric(msg):
                    raise
                dropped = next((m for m in pending if m in msg), pending[-1])
                if dropped not in bad:
                    bad.append(dropped)
                pending = [m for m in pending if m != dropped]
        else:
            break
    return by_day, totals, bad


def _day_rows(mapped, fields):
    rows = []
    for day in sorted(mapped):
        src = mapped[day]
        row = {"date": day}
        for key, metric in fields.items():
            if metric in src:
                row[key] = src[metric]
        if len(row) > 1:
            rows.append(row)
    return rows


def _merge_days(old, new, from_day):
    kept = [d for d in (old or []) if d.get("date") and d["date"] < from_day]
    fresh = [d for d in (new or []) if d.get("date") and d["date"] >= from_day]
    return sorted(kept + fresh, key=lambda d: d["date"])


def _merge_posts(old, new):
    by_id = {p.get("id"): p for p in (old or []) if p.get("id")}
    for p in new or []:
        if p.get("id"):
            by_id[p["id"]] = p
    return sorted(by_id.values(), key=lambda p: p.get("date") or "", reverse=True)


def _keep_if_stale(prev, fresh):
    if fresh.get("status") == "ok":
        return fresh
    if prev and prev.get("status") in ("ok", "partial", "stale") and (prev.get("days") or prev.get("posts") or prev.get("followers") is not None):
        kept = dict(prev)
        kept["status"] = "stale"
        kept["needs"] = list(fresh.get("needs") or [])
        kept["error"] = fresh.get("error") or prev.get("error") or ""
        return kept
    return fresh


def _post_type(raw):
    t = (raw or "").upper()
    return {
        "PHOTO": "صورة", "IMAGE": "صورة", "VIDEO": "فيديو", "REEL": "ريل", "REELS": "ريل",
        "CAROUSEL_ALBUM": "كاروسيل", "ALBUM": "كاروسيل", "STORY": "ستوري",
        "LINK": "رابط", "SHARE": "مشاركة",
    }.get(t, raw or "منشور")


_THUMB_UA = "Mozilla/5.0 (compatible; WellAdsDashboard/1.0)"


def _image_mime(raw, ctype):
    if raw[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if len(raw) >= 12 and raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "image/webp"
    if raw[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if ctype.startswith("image/") and "svg" not in ctype:
        return ctype
    return None


def _embed_thumb(url):
    """يصغّر صورة المنشور إلى data URI حتى تظهر داخل جدار الكرييتف (img-src data:).

    روابط شبكة التوصيل تنتهي صلاحيتها، لذلك تُجلب وقت البناء مع متصفح User-Agent.
    إذا تعذّر التصغير تُضمَّن الصورة كما هي بدل إسقاطها.
    """
    if not url or not isinstance(url, str):
        return None
    if url.startswith("data:image/"):
        return url
    if not url.startswith(("http://", "https://")):
        return None
    if re.search(r"\.(mp4|mov|webm)(\?|$)", url, re.I):
        return None
    try:
        import urllib.request
        req = urllib.request.Request(url, headers={
            "User-Agent": _THUMB_UA,
            "Accept": "image/avif,image/webp,image/apng,image/jpeg,image/png,*/*;q=0.8",
        })
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read(2_000_000)
            ctype = (r.headers.get("Content-Type") or "").split(";")[0].strip().lower()
    except Exception:
        return None
    if not raw or len(raw) < 32:
        return None
    try:
        import io
        from PIL import Image
        im = Image.open(io.BytesIO(raw)).convert("RGB")
        im.thumbnail((300, 300))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=68)
        return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
    except Exception:
        mime = _image_mime(raw, ctype)
        if not mime:
            return None
        return f"data:{mime};base64," + base64.b64encode(raw).decode()


def _tokens(page_token, user_token):
    out = []
    for tok in (page_token, user_token):
        if tok and tok not in out:
            out.append(tok)
    return out


def _fb_post(graph, page_token, page_id, start, end, metric_names):
    g = Graph(graph.transport, page_token)
    posts = []
    first, last = None, None
    for edge, fields in (
        ("posts", "id,message,created_time,permalink_url,full_picture,status_type,shares,comments.summary(true),reactions.summary(true)"),
        ("feed", "id,message,created_time,permalink_url,status_type"),
    ):
        try:
            first = g.get(f"{page_id}/{edge}", fields=fields, since=_riyadh_unix(start), until=_riyadh_unix(_next_day(end)), limit=100)
            break
        except RuntimeError as ex:
            last = ex
    if first is None:
        return [], clip(last) if last else "posts"
    for p in g.pages(first):
        if len(posts) >= 200:
            break
        shares = p.get("shares") or {}
        comments = (p.get("comments") or {}).get("summary") or {}
        reactions = (p.get("reactions") or {}).get("summary") or {}
        posts.append({
            "id": p.get("id"),
            "date": riyadh_day(p.get("created_time") or ""),
            "type": _post_type(p.get("status_type")),
            "caption": (p.get("message") or "").strip(),
            "permalink": p.get("permalink_url"),
            "likes": _num(reactions.get("total_count")),
            "comments": _num(comments.get("total_count")),
            "shares": _num(shares.get("count")),
            "saves": None,
            "views": None,
            "reach": None,
            "thumb": _embed_thumb(p.get("full_picture")),
            "network": "facebook",
        })
    if posts and metric_names:
        asked = [p for p in posts if p.get("id")]
        urls = [f"{p['id']}/insights?metric={','.join(metric_names)}" for p in asked]
        try:
            batches = g.batch(urls)
        except RuntimeError:
            batches = []
        for post, res in zip(asked, batches):
            if not isinstance(res, dict) or res.get("error"):
                post["insights"] = "pending"
                continue
            flat = {}
            for block in res.get("data") or []:
                vals = block.get("values") or []
                if vals:
                    flat[block.get("name")] = _num(vals[-1].get("value"))
            if flat.get("post_media_view") is not None:
                post["views"] = flat["post_media_view"]
            if flat.get("post_total_media_view_unique") is not None:
                post["reach"] = flat["post_total_media_view_unique"]
        for post in asked[len(batches):]:
            post["insights"] = "pending"
    for post in posts:
        likes, comments, shares, saves = (post.get(k) or 0 for k in ("likes", "comments", "shares", "saves"))
        post["engagement"] = likes + comments + shares + saves
        dept, src = classify_pair(post.get("caption") or "", "")
        post["dept"] = dept
        post["dsrc"] = src
    return posts, None


def _ig_media(graph, token, ig_id, start, end, metric_names):
    g = Graph(graph.transport, token)
    posts = []
    first = g.get(f"{ig_id}/media",
                  fields="id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count",
                  since=_riyadh_unix(start), until=_riyadh_unix(_next_day(end)), limit=100)
    for p in g.pages(first):
        if len(posts) >= 200:
            break
        kind = p.get("media_product_type") or p.get("media_type")
        media_type = (p.get("media_type") or "").upper()
        pic = p.get("thumbnail_url") if media_type == "VIDEO" else (p.get("thumbnail_url") or p.get("media_url"))
        posts.append({
            "id": p.get("id"),
            "date": riyadh_day(p.get("timestamp") or ""),
            "type": _post_type(kind),
            "caption": (p.get("caption") or "").strip(),
            "permalink": p.get("permalink"),
            "likes": _num(p.get("like_count")),
            "comments": _num(p.get("comments_count")),
            "shares": None,
            "saves": None,
            "views": None,
            "reach": None,
            "thumb": _embed_thumb(pic),
            "video": p.get("media_url") if media_type == "VIDEO" else None,
            "network": "instagram",
        })
    if posts and metric_names:
        asked = [p for p in posts if p.get("id")]
        urls = [f"{p['id']}/insights?metric={','.join(metric_names)}" for p in asked]
        try:
            batches = g.batch(urls)
        except RuntimeError:
            batches = []
        for post, res in zip(asked, batches):
            if not isinstance(res, dict) or res.get("error"):
                post["insights"] = "pending"
                continue
            flat = {}
            for block in res.get("data") or []:
                vals = block.get("values") or []
                if vals:
                    flat[block.get("name")] = _num(vals[-1].get("value"))
            for src, dst in (("views", "views"), ("reach", "reach"), ("saved", "saves"), ("shares", "shares"), ("total_interactions", "engagement")):
                if flat.get(src) is not None:
                    post[dst] = flat[src]
        for post in asked[len(batches):]:
            post["insights"] = "pending"
    for post in posts:
        if post.get("engagement") is None:
            post["engagement"] = (post.get("likes") or 0) + (post.get("comments") or 0) + (post.get("shares") or 0) + (post.get("saves") or 0)
        dept, src = classify_pair(post.get("caption") or "", "")
        post["dept"] = dept
        post["dsrc"] = src
    return posts


def _load_fb_pages(graph, start, end, prev_pages):
    prev_by = {_norm(p.get("name")): p for p in (prev_pages or [])}
    try:
        first = graph.get("me/accounts", fields="id,name,access_token,instagram_business_account{id,username}", limit=100)
        accounts = list(graph.pages(first))
    except RuntimeError as ex:
        msg = clip(ex)
        needs = [msg, "المطلوب على META_ACCESS_TOKEN: " + "، ".join(PAGE_PERMS) + ".",
                 "والصفحات: " + "، ".join(FB_PAGES) + "."]
        pages = [_keep_if_stale(prev_by.get(_norm(n)), _page(n, needs=needs, error=msg)) for n in FB_PAGES]
        return pages, None, needs
    by_name = {_norm(a.get("name")): a for a in accounts}
    visible = "، ".join(a.get("name") or "?" for a in accounts) or "لا توجد صفحات مربوطة بالتوكن"
    out = []
    for name in FB_PAGES:
        acc = by_name.get(_norm(name))
        prev = prev_by.get(_norm(name))
        if not acc:
            needs = [f"الصفحة «{name}» غير مربوطة بالتوكن. الصفحات الظاهرة: {visible}.",
                     "المطلوب: " + "، ".join(PAGE_PERMS) + " ومهمة ANALYZE."]
            out.append(_keep_if_stale(prev, _page(name, needs=needs, error=needs[0])))
            continue
        tokens = _tokens(acc.get("access_token"), graph.token)
        info, info_err = None, None
        for tok in tokens:
            try:
                info = Graph(graph.transport, tok).get(acc["id"], fields="followers_count,fan_count,name")
                info_err = None
                break
            except RuntimeError as ex:
                info_err = clip(ex)
        mapped, bad, insight_err = {}, [], None
        for tok in tokens:
            try:
                mapped, _totals, bad = _fetch_metric_set(Graph(graph.transport, tok), f"{acc['id']}/insights", PAGE_METRICS, start, end, "day")
                insight_err = None
                break
            except RuntimeError as ex:
                insight_err = clip(ex)
                mapped, bad = {}, []
        days = _day_rows(mapped, {
            "views": "page_media_view",
            "reach": "page_total_media_view_unique",
            "engagement": "page_post_engagements",
            "follows": "page_daily_follows_unique",
            "unfollows": "page_daily_unfollows_unique",
            "followers": "page_follows",
        })
        followers = _num((info or {}).get("followers_count"))
        if followers is None:
            followers = _num((info or {}).get("fan_count"))
        if followers is None and days:
            for row in reversed(days):
                if row.get("followers") is not None:
                    followers = row["followers"]
                    break
        posts, posts_err = [], None
        for tok in tokens:
            try:
                posts, posts_err = _fb_post(graph, tok, acc["id"], start, end, list(POST_METRICS))
            except RuntimeError as ex:
                posts, posts_err = [], clip(ex)
            if not posts_err:
                break
        if followers is None and not posts and not days:
            msg = info_err or posts_err or insight_err or "تعذّر قراءة الصفحة"
            needs = [msg]
            if _permission(msg):
                needs.append("المطلوب: " + "، ".join(PAGE_PERMS) + f" على صفحة «{name}».")
            out.append(_keep_if_stale(prev, _page(name, needs=needs, error=msg)))
            continue
        insights = "pending" if insight_err or (bad and not days) else "ok"
        posts_status = "pending" if posts_err else "ok"
        # Well Care. يرجع 200 فارغاً لمنشورات الصفحة ورؤاها عندما تنقص الصلاحية.
        # السلسلة الفارغة ليست صفراً مقاساً، فتبقى «بانتظار الصلاحية».
        if _norm(name) == _norm("Well Care.") and not days and not posts and insights == "ok" and posts_status == "ok":
            insights = "pending"
            posts_status = "pending"
        needs = [f"مقياس غير متاح في هذا الإصدار: {m}" for m in bad]
        for msg in (insight_err, posts_err, info_err):
            if msg:
                needs.append(msg)
        page = {
            "status": "partial" if insights == "pending" or posts_status == "pending" or info_err else "ok",
            "name": (info or {}).get("name") or name, "id": acc["id"], "needs": needs, "error": posts_err or insight_err or info_err or "",
            "followers": followers, "days": days, "posts": posts,
            "insights": insights, "posts_status": posts_status,
        }
        if prev:
            page["days"] = _merge_days(prev.get("days"), page["days"], start)
            if not posts_err:
                page["posts"] = _merge_posts(prev.get("posts"), page["posts"])
        out.append(page)
    return out, accounts, []


def fetch_ig_user_days(graph, ig_id, start, end, metrics=IG_USER_METRICS):
    """رؤى إنستغرام بـ total_value نافذة واحدة لا تُقسَّم على الأيام.

    الوصول والحسابات المتفاعلة أرقام فريدة، فجمع النوافذ يضاعفها. نطلب كل يوم
    بتوقيت الرياض على حدة، ونحتفظ بإجمالي النافذة فقط إذا كانت ٩٠ يوماً أو أقل.
    """
    working = list(metrics)
    bad = []

    def pull(since_day, until_day, names):
        pending = list(names)
        while pending:
            try:
                data = graph.get(
                    f"{ig_id}/insights",
                    metric=",".join(pending),
                    period="day",
                    metric_type="total_value",
                    since=_riyadh_unix(since_day),
                    until=_riyadh_unix(until_day),
                )
                return _parse_insights(data)
            except RuntimeError as ex:
                msg = str(ex)
                if not _invalid_metric(msg):
                    raise
                dropped = next((m for m in pending if m in msg), pending[-1])
                if dropped not in bad:
                    bad.append(dropped)
                pending = [m for m in pending if m != dropped]
        return {}, {}

    span = (datetime.strptime(end, "%Y-%m-%d") - datetime.strptime(start, "%Y-%m-%d")).days
    window_totals = {}
    if span <= 89:
        _, window_totals = pull(start, _next_day(end), working)
        working = [m for m in working if m not in bad]
    mapped = {}
    if working:
        for day in _each_day(start, end):
            try:
                _, totals = pull(day, _next_day(day), working)
            except RuntimeError as ex:
                msg = str(ex).lower()
                if _permission(str(ex)) or "(#190)" in msg or "(#10)" in msg:
                    raise
                continue
            if totals:
                mapped[day] = totals
    return mapped, window_totals, bad


def _load_ig(graph, accounts, start, end, prev_pages, list_error):
    prev = (prev_pages or [None])[0]
    name = "@" + IG_USER
    if accounts is None:
        needs = list_error or ["تعذّر قراءة الصفحات، فتعذّر الوصول لإنستغرام."]
        needs = list(needs) + ["المطلوب لإنستغرام: " + "، ".join(IG_PERMS) + "."]
        return [_keep_if_stale(prev, _page(name, needs=needs, error=needs[0]))]
    match = None
    token = graph.token
    for acc in accounts:
        ig = acc.get("instagram_business_account") or {}
        if (ig.get("username") or "").casefold() == IG_USER.casefold():
            match = ig
            token = acc.get("access_token") or token
            break
    if not match:
        needs = [f"حساب إنستغرام @{IG_USER} غير مربوط بأي صفحة ظاهرة في /me/accounts.",
                 "المطلوب: " + "، ".join(IG_PERMS) + " وربط الحساب الاحترافي بصفحة فيسبوك."]
        return [_keep_if_stale(prev, _page(name, needs=needs, error=needs[0]))]
    tokens = _tokens(token, graph.token)
    info, info_err = None, None
    for tok in tokens:
        try:
            info = Graph(graph.transport, tok).get(match["id"], fields="followers_count,media_count,username")
            info_err = None
            break
        except RuntimeError as ex:
            info_err = clip(ex)
    mapped, totals, bad, insight_err = {}, {}, [], None
    for tok in tokens:
        try:
            mapped, totals, bad = fetch_ig_user_days(Graph(graph.transport, tok), match["id"], start, end)
            insight_err = None
            break
        except RuntimeError as ex:
            insight_err = clip(ex)
            mapped, totals, bad = {}, {}, []
    days = _day_rows(mapped, {"reach": "reach", "views": "views", "engagement": "accounts_engaged"})
    period = None
    if totals:
        period = {"start": start, "end": end, "views": totals.get("views"), "reach": totals.get("reach"),
                  "engagement": totals.get("accounts_engaged")}
    posts, posts_err = [], None
    for tok in tokens:
        try:
            posts = _ig_media(graph, tok, match["id"], start, end, IG_MEDIA_METRICS)
            posts_err = None
            break
        except RuntimeError as ex:
            posts, posts_err = [], clip(ex)
    if info is None and not posts and not days:
        msg = info_err or posts_err or insight_err or "تعذّر قراءة إنستغرام"
        needs = [msg, "المطلوب: " + "، ".join(IG_PERMS) + "."]
        return [_keep_if_stale(prev, _page(name, needs=needs, error=msg))]
    insights = "pending" if insight_err or (bad and not days) else "ok"
    posts_status = "pending" if posts_err else "ok"
    needs = [f"مقياس غير متاح: {m}" for m in bad]
    for msg in (insight_err, posts_err, info_err):
        if msg:
            needs.append(msg)
    page = {
        "status": "partial" if insights == "pending" or posts_status == "pending" or info_err else "ok",
        "name": "@" + ((info or {}).get("username") or IG_USER),
        "id": match["id"],
        "needs": needs,
        "error": insight_err or posts_err or info_err or "",
        "followers": _num((info or {}).get("followers_count")),
        "days": days,
        "period": period,
        "posts": posts,
        "insights": insights,
        "posts_status": posts_status,
    }
    if prev:
        page["days"] = _merge_days(prev.get("days"), page["days"], start)
        if not posts_err:
            page["posts"] = _merge_posts(prev.get("posts"), page["posts"])
    return [page]


def _b64url(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _ga4_token(info, transport):
    now = int(time.time())
    header = _b64url(json.dumps({"alg": "RS256", "typ": "JWT"}).encode())
    claim = _b64url(json.dumps({
        "iss": info["client_email"],
        "scope": "https://www.googleapis.com/auth/analytics.readonly",
        "aud": "https://oauth2.googleapis.com/token",
        "iat": now,
        "exp": now + 3600,
    }).encode())
    signing = f"{header}.{claim}".encode()
    pem = info["private_key"]
    with tempfile.NamedTemporaryFile("w", delete=False) as fh:
        fh.write(pem)
        path = fh.name
    os.chmod(path, 0o600)
    try:
        proc = subprocess.run(["openssl", "dgst", "-sha256", "-sign", path], input=signing, capture_output=True, check=False)
    finally:
        os.unlink(path)
    if proc.returncode != 0:
        raise RuntimeError("openssl: " + proc.stderr.decode(errors="replace")[:200])
    assertion = signing.decode() + "." + _b64url(proc.stdout)
    tok = transport("https://oauth2.googleapis.com/token", data=urllib.parse.urlencode({
        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
        "assertion": assertion,
    }).encode())
    return tok["access_token"]


def _ga4_service_account():
    raw = (os.environ.get("GA4_SERVICE_ACCOUNT_JSON") or os.environ.get("GOOGLE_APPLICATION_CREDENTIALS_JSON") or "").strip()
    path = (os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") or "").strip()
    if raw.startswith("{"):
        try:
            return json.loads(raw), None
        except json.JSONDecodeError:
            return None, "GA4_SERVICE_ACCOUNT_JSON ليس JSON صالح لحساب الخدمة."
    if path and os.path.exists(path):
        try:
            return json.load(open(path, encoding="utf-8")), None
        except json.JSONDecodeError:
            return None, "ملف حساب الخدمة ليس JSON صالح."
    return None, None


def _ga4_oauth_token(transport):
    """زر "اربط" في صفحة الربط: refresh token بتطبيق Google نفسه حق Google Ads."""
    tok = transport("https://oauth2.googleapis.com/token", data=urllib.parse.urlencode({
        "grant_type": "refresh_token",
        "refresh_token": os.environ["GA4_REFRESH_TOKEN"].strip(),
        "client_id": (os.environ.get("GOOGLE_ADS_CLIENT_ID") or "").strip(),
        "client_secret": (os.environ.get("GOOGLE_ADS_CLIENT_SECRET") or "").strip(),
    }).encode())
    return tok["access_token"]


def _load_ga4(transport, start, end, prev):
    info, err = _ga4_service_account()
    oauth = bool((os.environ.get("GA4_REFRESH_TOKEN") or "").strip())
    if oauth:
        info, err = None, None
    prop = (os.environ.get("GA4_PROPERTY_ID") or "").strip().removeprefix("properties/")
    base = {"name": "GA4", "days": [], "totals": {}, "channels": [], "error": "", "needs": []}
    if err:
        base.update(status="pending", needs=[err] + list(GA4_NEEDS), error=err)
        return _keep_if_stale(prev, base)
    if (not info and not oauth) or not prop:
        missing = []
        if not prop:
            missing.append(GA4_NEEDS[0])
        if not info and not oauth:
            missing.append(GA4_NEEDS[1])
        base.update(status="pending", needs=missing or list(GA4_NEEDS))
        return _keep_if_stale(prev, base)
    if not oauth and ("client_email" not in info or "private_key" not in info):
        msg = "JSON حساب الخدمة ينقصه client_email أو private_key."
        base.update(status="pending", needs=[msg], error=msg)
        return _keep_if_stale(prev, base)
    try:
        token = _ga4_oauth_token(transport) if oauth else _ga4_token(info, transport)
        def report(body):
            return transport(
                f"https://analyticsdata.googleapis.com/v1beta/properties/{prop}:runReport",
                data=json.dumps(body).encode(), method="POST",
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
        daily = report({
            "dateRanges": [{"startDate": start, "endDate": end}],
            "dimensions": [{"name": "date"}],
            "metrics": [{"name": "totalUsers"}, {"name": "sessions"}, {"name": "screenPageViews"}, {"name": "engagementRate"}],
        })
        days = []
        for row in daily.get("rows") or []:
            dim = row["dimensionValues"][0]["value"]
            day = f"{dim[:4]}-{dim[4:6]}-{dim[6:8]}" if len(dim) == 8 else dim
            vals = [_num(m.get("value")) for m in row.get("metricValues") or []]
            days.append({"date": day, "users": vals[0], "sessions": vals[1], "views": vals[2], "engagement_rate": vals[3]})
        ch = report({
            "dateRanges": [{"startDate": start, "endDate": end}],
            "dimensions": [{"name": "sessionDefaultChannelGroup"}],
            "metrics": [{"name": "sessions"}, {"name": "totalUsers"}],
            "limit": 12,
        })
        channels = []
        for row in ch.get("rows") or []:
            channels.append({
                "channel": row["dimensionValues"][0]["value"],
                "sessions": _num(row["metricValues"][0]["value"]),
                "users": _num(row["metricValues"][1]["value"]),
            })
        fresh = {**base, "status": "ok", "id": prop, "days": days, "channels": channels,
                 "totals": {}, "window": {"start": start, "end": end}}
        if prev:
            fresh["days"] = _merge_days(prev.get("days"), fresh["days"], start)
        return fresh
    except Exception as ex:
        msg = clip(ex)
        needs = [msg, "تأكد أن حساب الخدمة Viewer على الخاصية " + prop + " وأن GA4 Data API مفعّلة."]
        fresh = {**base, "status": "pending", "needs": needs, "error": msg}
        return _keep_if_stale(prev, fresh)


def _load_tiktok(blob, prev):
    org = (blob or {}).get("organic") if isinstance(blob, dict) else None
    if isinstance(org, dict) and (org.get("posts") or org.get("days") or org.get("followers") is not None or org.get("status") == "ok"):
        out = {
            "status": org.get("status") or "ok",
            "name": org.get("name") or "تيك توك",
            "needs": list(org.get("needs") or []),
            "error": org.get("error") or "",
            "followers": org.get("followers"),
            "days": org.get("days") or [],
            "posts": [],
        }
        for p in org.get("posts") or []:
            post = dict(p)
            dept, src = classify_pair(post.get("caption") or "", "")
            post["dept"] = dept
            post["dsrc"] = src
            post.setdefault("network", "tiktok")
            cover = post.get("thumb") or post.get("cover") or post.get("thumbnail")
            if isinstance(cover, str) and cover.startswith("http"):
                post["thumb"] = _embed_thumb(cover)
            out["posts"].append(post)
        return out
    fresh = {"status": "pending", "name": "تيك توك", "needs": list(TT_NEEDS), "error": "", "followers": None, "days": [], "posts": []}
    return _keep_if_stale(prev, fresh)


def collect_organic(env, start, end, prev=None, tiktok_blob=None, transport=None):
    """يسحب العضوي. لا يرمي استثناءات الشبكة؛ يرجّع أقسام pending بدل ذلك."""
    transport = transport or http
    prev = prev or {}
    token = (env or {}).get("META_ACCESS_TOKEN") or os.environ.get("META_ACCESS_TOKEN") or ""
    shell = pending_shell()
    if not token:
        fb = shell["facebook"]
        ig = shell["instagram"]
    else:
        graph = Graph(transport, token)
        try:
            fb, accounts, list_error = _load_fb_pages(graph, start, end, prev.get("facebook"))
            ig = _load_ig(graph, accounts, start, end, prev.get("instagram"), list_error)
        except Exception as ex:
            msg = clip(ex)
            fb = [_keep_if_stale(None, _page(n, needs=[msg] + list(PAGE_PERMS), error=msg)) for n in FB_PAGES]
            ig = [_keep_if_stale(None, _page("@" + IG_USER, needs=[msg] + list(IG_PERMS), error=msg))]
    # ادمج الأيام السابقة إذا الحالة ok ولم يُدمَج داخل الجالب
    return {
        "facebook": visible_facebook(fb),
        "instagram": ig,
        "tiktok": _load_tiktok(tiktok_blob, prev.get("tiktok")),
        "ga4": _load_ga4(transport, start, end, prev.get("ga4")),
    }
