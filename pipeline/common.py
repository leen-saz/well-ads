import json, os, urllib.parse, urllib.request, urllib.error
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def env():
    """محلياً: ملف .env في مجلد ads-manager. في السحابة: متغيرات البيئة."""
    prefixes = ("META_", "GOOGLE_ADS_", "SNAP_", "TIKTOK_", "GA4_")
    extra = {"GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_APPLICATION_CREDENTIALS_JSON"}
    e = {k: v for k, v in os.environ.items() if k.startswith(prefixes) or k in extra}
    here = os.path.dirname(os.path.abspath(__file__))
    for path in (os.path.join(ROOT, ".env"), os.path.join(here, ".env")):
        if not os.path.exists(path):
            continue
        for l in open(path, encoding="utf-8"):
            l = l.strip()
            if l and not l.startswith("#") and "=" in l:
                k, v = l.split("=", 1); e.setdefault(k.strip(), v.strip())
    # صفحة الربط تكتب V_NAME في GITHUB_ENV. القيمة دي تغلب سر GitHub لنفس الاسم، والفارغ يتجاهل.
    for key, value in os.environ.items():
        if not key.startswith("V_"):
            continue
        name = key[2:]
        if name.startswith("TIKTOK_"):  # TikTok stays on MCP (tiktok-data branch), never the API token
            continue
        if (name.startswith(prefixes) or name in extra) and str(value).strip():
            e[name] = value
    return e
def http(url, data=None, headers=None, method=None, timeout=60):
    req = urllib.request.Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r)
    except urllib.error.HTTPError as ex:
        body = ex.read().decode(errors="replace")[:400]
        raise RuntimeError(f"HTTP {ex.code}: {body}") from None


GOOGLE_ADS_TOKEN_MISSING = "مفتاح المطوّر لقوقل (GOOGLE_ADS_DEVELOPER_TOKEN) غير موجود، فما نقدر نسحب من قوقل. أضفه في أسرار البيئة production"


def google_ads_headers(E, access_token):
    """Headers for every googleAds:search call. Google rejects a call without developer-token, so a missing one fails early with a clear message."""
    dev = (E.get("GOOGLE_ADS_DEVELOPER_TOKEN") or "").strip()
    if not dev:
        raise RuntimeError(GOOGLE_ADS_TOKEN_MISSING)
    h = {"Authorization": f"Bearer {access_token}", "developer-token": dev, "Content-Type": "application/json"}
    login = (E.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID") or "").strip()
    if login:
        h["login-customer-id"] = login
    return h
