import json, os, random, re, socket, time, urllib.parse, urllib.request, urllib.error
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
    except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError) as ex:
        # network trouble has no status code: a stable prefix lets retry() and error_code() recognise it
        raise RuntimeError(f"HTTP 0: network {type(ex).__name__}") from None


# ---- errors: one short code for the public log / data.json, and one transient test shared by every caller ----
_META_THROTTLE = ("1", "2", "4", "17", "32", "613", "80000", "80001", "80002", "80003", "80004")


def error_code(ex):
    """A short stable code for an upstream failure: auth, rate_limit, http_5xx, network, http_4xx or error.

    The raw text of an upstream error can carry account ids, so it never goes to data.json or the public Actions log."""
    msg = str(ex)
    m = re.search(r"HTTP (\d{3})", msg)
    code = int(m.group(1)) if m else None
    if code == 0 or "network" in msg[:24]:
        return "network"
    if code == 429 or "request limit" in msg.lower() or "RESOURCE_EXHAUSTED" in msg:
        return "rate_limit"
    if code in (401, 403) or '"code":190' in msg.replace(" ", "") or "invalid_grant" in msg or "OAuth" in msg[:80]:
        return "auth"
    if code and 500 <= code <= 599:
        return "http_5xx"
    if code:
        return "http_4xx"
    return "error"


def is_transient(ex):
    """Worth another try: rate limits, 5xx, network errors and Meta's throttle / temporary codes."""
    if error_code(ex) in ("rate_limit", "http_5xx", "network"):
        return True
    flat = str(ex).replace(" ", "")
    return any(f'"code":{c},' in flat or f'"code":{c}}}' in flat for c in _META_THROTTLE)


class RetryBudget:
    """Total seconds a run may spend sleeping between retries, so a few throttled calls cannot eat the job timeout."""
    def __init__(self, seconds=None):
        self.left = float(os.environ.get("RETRY_BUDGET_SECONDS", 1200) if seconds is None else seconds)

    def take(self, wait):
        if wait > self.left:
            return False
        self.left -= wait
        return True


BUDGET = RetryBudget()


def retry_call(fn, *a, tries=6, sleep=time.sleep, budget=None, log=None, **k):
    """Calls fn, retrying transient errors with exponential backoff, jitter and the run-wide time budget."""
    budget = BUDGET if budget is None else budget
    wait = 30
    for n in range(tries):
        try:
            return fn(*a, **k)
        except RuntimeError as ex:
            if not is_transient(ex) or n == tries - 1:
                raise
            # server / network blips are short; throttles need a real pause
            base = 5 * (2 ** n) if error_code(ex) in ("http_5xx", "network") else wait
            pause = min(base, 600) * (0.75 + random.random() * 0.5)
            if not budget.take(pause):
                raise
            if log:
                log(f"  إعادة المحاولة بعد {pause:.0f} ثانية ({error_code(ex)})")
            sleep(pause)
            wait = min(wait * 2, 600)


# ---- currency: every figure is in SAR, so each platform's account currency is read and checked ----
USD_SAR = 3.75


def sar_factor(currency, assumed):
    """Multiplier to SAR for an account currency. currency None = the lookup failed, so the old assumption stays
    (assumed) with a note; any other currency than SAR/USD fails the platform instead of mixing currencies."""
    cur = (currency or "").strip().upper()
    if not cur:
        return USD_SAR if assumed == "USD" else 1.0
    if cur == "SAR":
        return 1.0
    if cur == "USD":
        return USD_SAR
    raise RuntimeError(f"currency mismatch: account currency is {cur}, expected SAR or USD")


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


def google_search_all(customer_id, headers, query, request=http, max_pages=200):
    """Every row of a googleAds:search query: follows nextPageToken (a page holds about 10k rows at most),
    so a long window or a busy account is never cut silently."""
    out, token = [], None
    for _ in range(max_pages):
        body = {"query": query, **({"pageToken": token} if token else {})}
        res = request(f"https://googleads.googleapis.com/v24/customers/{customer_id}/googleAds:search",
                      data=json.dumps(body).encode(), method="POST", headers=headers)
        out += res.get("results", [])
        token = res.get("nextPageToken")
        if not token:
            return out
    raise RuntimeError("google search: too many pages")
