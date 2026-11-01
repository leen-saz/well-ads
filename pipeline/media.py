"""معاينات الكرييتف قبل بناء الصفحة.

الصورة تُضمَّن كـ data URI حتى لا تنكسر روابط شبكة التوصيل.
فيديو تيك توك يُشغَّل من رابط التضمين، وصورته تُجلب من oEmbed إن غابت.
لا يغيّر هذا الملف حالة أي إعلان على المنصة.
"""
import json, os, re, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

from channels import google_platform
from organic import _embed_thumb

_VIDEO_ID = re.compile(r"tiktok\.com/(?:embed(?:/v2)?|player(?:/v1)?)/(\d+)")
_FILE_VIDEO = re.compile(r"\.(?:mp4|webm|mov)(?:\?|$)", re.I)


def media_kind(item):
    thumb = item.get("thumb") or ""
    video = item.get("video") or ""
    link = item.get("link") or ""
    image = isinstance(thumb, str) and thumb.startswith("data:image")
    playable = bool(video) or bool(_VIDEO_ID.search(link) or _FILE_VIDEO.search(link) or _FILE_VIDEO.search(video or ""))
    if image and playable:
        return "both"
    if image:
        return "image"
    if playable:
        return "video"
    return "none"


def media_counts(items):
    out = {"image": 0, "video": 0, "both": 0, "none": 0, "total": len(items)}
    for item in items:
        out[media_kind(item)] += 1
    out["working"] = out["total"] - out["none"]
    return out


def organic_posts(data):
    org = data.get("organic") or {}
    posts = []
    for page in org.get("facebook") or []:
        posts.extend(page.get("posts") or [])
    for page in org.get("instagram") or []:
        posts.extend(page.get("posts") or [])
    tt = org.get("tiktok") or {}
    posts.extend(tt.get("posts") or [])
    return posts


def _tiktok_blob():
    here = os.path.dirname(os.path.abspath(__file__))
    for path in (
        os.environ.get("TIKTOK_DATA") or "",
        os.path.join(here, "tiktok-data", "tiktok.json"),
        os.path.join(here, "tiktok.json"),
    ):
        if path and os.path.exists(path):
            try:
                return json.load(open(path, encoding="utf-8"))
            except Exception:
                return None
    return None


def _oembed(video_id):
    """صورة الغلاف ورابط المشاهدة العام. رابط التضمين يبقى للتشغيل داخل النافذة."""
    url = "https://www.tiktok.com/oembed?url=" + urllib.parse.quote(
        f"https://www.tiktok.com/@well/video/{video_id}", safe="")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=20) as r:
            payload = json.load(r)
    except Exception:
        return {}
    author = payload.get("author_unique_id") or ""
    watch = f"https://www.tiktok.com/@{author}/video/{video_id}" if author else None
    return {"thumb": _embed_thumb(payload.get("thumbnail_url")), "watch": watch}


def _valid_data_image(uri):
    try:
        import base64, io
        from PIL import Image
        raw = base64.b64decode(uri.split(",", 1)[1])
        Image.open(io.BytesIO(raw)).convert("RGB").load()
        return True
    except Exception:
        return False


def _refresh_http_thumb(item):
    """يثبّت الصورة داخل الصفحة. رابط http المنتهي يُستبدل، والصورة التالفة تُحذف حتى لا تُكسر البطاقة."""
    thumb = item.get("thumb")
    if isinstance(thumb, str) and thumb.startswith("data:image"):
        if not _valid_data_image(thumb):
            item["thumb"] = None
        return
    if not isinstance(thumb, str) or not thumb.startswith(("http://", "https://")):
        return
    embedded = _embed_thumb(thumb)
    item["thumb"] = embedded or None


def browser_media_url(url):
    """رابط يفتح في المتصفح. معاينة سناب على adsapi تطلب ترويسة ولا تُعرض."""
    if not isinstance(url, str) or not url.startswith(("http://", "https://")):
        return None
    if "adsapi.snapchat.com" in url:
        return None
    return url


def pick_preview(ad):
    """أفضل رابط لمشاهدة الكرييتف نفسه: منشور، ثم ملف فيديو، ثم صورة."""
    if not isinstance(ad, dict):
        return None
    for key in ("preview_url", "permalink"):
        url = browser_media_url(ad.get(key))
        if url:
            return url
    video = browser_media_url(ad.get("video"))
    if video:
        return video
    image = browser_media_url(ad.get("image_url"))
    if image:
        return image
    return None


def label_unsplit_google(ad):
    """حملة بحث بلا نوع قناة في اللقطة تُسمّى بحث. نوع القناة من الواجهة يبقى كما هو."""
    if (ad.get("platform") or "") != "google":
        return
    blob = f"{ad.get('name') or ''} {ad.get('campaign') or ''} {ad.get('channel') or ''}"
    if re.search(r"(?<![A-Za-z])SRCH(?![A-Za-z])|\bSEARCH\b", blob, re.I):
        ad["platform"] = google_platform("SEARCH")
        ad["channel"] = ad.get("channel") or "SEARCH"
        ad["format"] = ad.get("format") or "بحث نصي"


def enrich(data):
    """يرجع (قبل، بعد) لعدد المعاينات العاملة."""
    ads = list((data.get("ads") or {}).values())
    posts = organic_posts(data)
    before = {"paid": media_counts(ads), "organic": media_counts(posts)}
    blob = _tiktok_blob() or {}
    for key, src in (blob.get("ads") or {}).items():
        ad = (data.get("ads") or {}).get(key)
        if not ad:
            continue
        for field in ("text", "format", "status", "group", "link"):
            if src.get(field) and not ad.get(field):
                ad[field] = src[field]
        if "live" in src and ad.get("live") is None:
            ad["live"] = bool(src["live"])
        link = ad.get("link") or ""
        match = _VIDEO_ID.search(link)
        if match:
            # player/v1 يجيب 200 حتى عندما embed/v2 يرجع 400
            ad["video"] = f"https://www.tiktok.com/player/v1/{match.group(1)}"
    for ad in (data.get("ads") or {}).values():
        label_unsplit_google(ad)
        link = ad.get("link") or ""
        if _FILE_VIDEO.search(link) and not ad.get("video"):
            ad["video"] = link
        preview = pick_preview(ad)
        if preview:
            ad["preview_url"] = preview
        elif not browser_media_url(ad.get("preview_url")):
            ad.pop("preview_url", None)
        _refresh_http_thumb(ad)
    for post in posts:
        _refresh_http_thumb(post)
        link = post.get("permalink") or post.get("link") or ""
        video = post.get("video") or ""
        if _FILE_VIDEO.search(video or "") or _FILE_VIDEO.search(link):
            post["video"] = video or link
    need = []
    for ad in (data.get("ads") or {}).values():
        link = ad.get("link") or ""
        match = _VIDEO_ID.search(link)
        if match and not (isinstance(ad.get("thumb"), str) and ad["thumb"].startswith("data:image")):
            need.append((ad, match.group(1)))
    if need:
        def one(pair):
            ad, vid = pair
            info = _oembed(vid)
            if info.get("thumb"):
                ad["thumb"] = info["thumb"]
            if info.get("watch"):
                ad["link"] = info["watch"]
            ad["video"] = f"https://www.tiktok.com/player/v1/{vid}"
        with ThreadPoolExecutor(6) as pool:
            list(pool.map(one, need))
    ads = list((data.get("ads") or {}).values())
    posts = organic_posts(data)
    after = {"paid": media_counts(ads), "organic": media_counts(posts)}
    return before, after
