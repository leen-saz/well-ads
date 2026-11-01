#!/usr/bin/env python3
"""قراءة وكتابة لوحة الإعلانات في Supabase.

المفتاح السرّي (service role) يبقى على السيرفر وGitHub Actions فقط.
الواجهة الثابتة تُبنى من data.json بعد القراءة هنا، ولا يصل المفتاح للمتصفح.
إذا غاب SUPABASE_URL أو SUPABASE_SERVICE_ROLE_KEY ترجع الدوال None ويتابع السحب على الملف المحلي.
"""
import json, os, urllib.error, urllib.request

PAGE = 1000
CHUNK_BYTES = 1_500_000


def _dotenv():
    here = os.path.dirname(os.path.abspath(__file__))
    found = {}
    for path in (os.path.join(here, ".env"), os.path.join(os.path.dirname(here), ".env")):
        if not os.path.exists(path):
            continue
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            found.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    return found


def credentials():
    """(url, service_role_key) أو (None, None). لا يطبع المفتاح."""
    env = _dotenv()
    url = (os.environ.get("SUPABASE_URL") or env.get("SUPABASE_URL") or "").strip().rstrip("/")
    key = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or env.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not url or not key:
        return None, None
    return url, key


def enabled():
    url, key = credentials()
    return bool(url and key)


def _chunks(rows, limit=CHUNK_BYTES):
    batch, size = [], 2
    for row in rows:
        raw = json.dumps(row, ensure_ascii=False, separators=(",", ":")).encode()
        if batch and size + len(raw) > limit:
            yield batch
            batch, size = [], 2
        batch.append(row)
        size += len(raw) + 1
    if batch:
        yield batch


def _request(method, path, payload=None, extra_headers=None, transport=None):
    url, key = credentials()
    if not url or not key:
        raise RuntimeError("supabase credentials missing")
    headers = {
        "apikey": key,
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if extra_headers:
        headers.update(extra_headers)
    data = None if payload is None else json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    if transport:
        return transport(method, url + path, data, headers)
    req = urllib.request.Request(url + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            body = res.read()
            return json.loads(body) if body else None
    except urllib.error.HTTPError as ex:
        detail = ex.read().decode(errors="replace")[:300]
        raise RuntimeError(f"supabase HTTP {ex.code}: {detail}") from None


def _paginate(table, order, transport=None):
    rows, start = [], 0
    while True:
        got = _request(
            "GET",
            f"/rest/v1/{table}?select=*&order={order}",
            extra_headers={"Range-Unit": "items", "Range": f"{start}-{start + PAGE - 1}"},
            transport=transport,
        ) or []
        rows.extend(got)
        if len(got) < PAGE:
            return rows
        start += PAGE


def ad_record(key, ad):
    ad = ad or {}
    return {
        "ad_key": key,
        "platform": ad.get("platform") or "",
        "name": ad.get("name") or "",
        "campaign": ad.get("campaign") or "",
        "ad_group": ad.get("group") or "",
        "format": ad.get("format") or "",
        "status": ad.get("status") or "",
        "live": bool(ad.get("live")),
        "goal": ad.get("goal") or "",
        "preview_url": ad.get("preview_url") or None,
        "video": ad.get("video") or None,
        "link": ad.get("link") or None,
        "doc": ad,
    }


def metric_record(row):
    padded = list(row) + [0, 0, 0, 0, 0, 0]
    return {
        "ad_key": padded[0],
        "day": padded[1],
        "spend": round(float(padded[2] or 0), 2),
        "impressions": int(padded[3] or 0),
        "clicks": int(padded[4] or 0),
        "leads": round(float(padded[5] or 0), 2),
        "conversations": int(padded[6] or 0),
    }


def state_record(data):
    keep = {k: v for k, v in data.items() if k not in ("ads", "rows")}
    return {"id": 1, "doc": keep}


def bundle_from_parts(ads_rows, metric_rows, state_rows):
    ads = {}
    for row in ads_rows or []:
        doc = row.get("doc")
        if isinstance(doc, str):
            doc = json.loads(doc)
        if not isinstance(doc, dict):
            doc = {}
        doc.setdefault("platform", row.get("platform"))
        doc["status"] = row.get("status") if row.get("status") not in (None, "") else doc.get("status")
        doc["live"] = bool(row.get("live"))
        if row.get("preview_url"):
            doc["preview_url"] = row["preview_url"]
        if row.get("video"):
            doc["video"] = row["video"]
        ads[row["ad_key"]] = doc
    metrics = []
    for row in metric_rows or []:
        day = row.get("day") or ""
        metrics.append([
            row["ad_key"], str(day)[:10],
            float(row.get("spend") or 0), int(row.get("impressions") or 0), int(row.get("clicks") or 0),
            float(row.get("leads") or 0), int(row.get("conversations") or 0),
        ])
    state = {}
    if state_rows:
        doc = state_rows[0].get("doc") or {}
        if isinstance(doc, str):
            doc = json.loads(doc)
        state = doc if isinstance(doc, dict) else {}
    out = dict(state)
    out["ads"] = ads
    out["rows"] = sorted(metrics, key=lambda r: (r[1], r[0]))
    return out


def load_bundle(transport=None):
    """data.json من القاعدة، أو None إذا القاعدة فاضية."""
    ads = _paginate("ads", "ad_key.asc", transport=transport)
    metrics = _paginate("ad_metrics", "day.asc,ad_key.asc", transport=transport)
    state = _request("GET", "/rest/v1/dashboard_state?id=eq.1&select=*", transport=transport) or []
    if not ads and not metrics and not state:
        return None
    return bundle_from_parts(ads, metrics, state)


def _upsert(table, rows, on_conflict, transport=None):
    if not rows:
        return
    prefer = "resolution=merge-duplicates,return=minimal"
    for batch in _chunks(rows):
        _request(
            "POST",
            f"/rest/v1/{table}?on_conflict={on_conflict}",
            batch,
            extra_headers={"Prefer": prefer},
            transport=transport,
        )


def _delete_window(prefix, start, end, transport=None):
    path = (
        "/rest/v1/ad_metrics"
        f"?ad_key=like.{prefix}*&day=gte.{start}&day=lte.{end}"
    )
    _request("DELETE", path, extra_headers={"Prefer": "return=minimal"}, transport=transport)


def _delete_all_metrics(transport=None):
    _request(
        "DELETE",
        "/rest/v1/ad_metrics?ad_key=not.is.null",
        extra_headers={"Prefer": "return=minimal"},
        transport=transport,
    )


def save_bundle(data, recent_from=None, ok_prefixes=None, full=False, transport=None):
    """يحفظ الإعلانات والحالة. الأيام القديمة تبقى. النافذة المعادة تُستبدل للمنصات التي نجح سحبها.

    full=True (القاعدة فاضية أو التعبئة الأولى أو سحب كامل) يستبدل صفوف الأيام كلها.
    """
    ads = [ad_record(k, v) for k, v in (data.get("ads") or {}).items()]
    _upsert("ads", ads, "ad_key", transport=transport)
    rows = [metric_record(r) for r in (data.get("rows") or []) if r and r[0]]
    if full or not recent_from:
        if full:
            _delete_all_metrics(transport=transport)
        _upsert("ad_metrics", rows, "ad_key,day", transport=transport)
    else:
        prefixes = list(ok_prefixes or [])
        end = (data.get("range") or {}).get("today") or recent_from
        for prefix in prefixes:
            _delete_window(prefix, recent_from, end, transport=transport)
        fresh = [r for r in rows if r["day"] >= recent_from and (not prefixes or r["ad_key"][:1] in prefixes)]
        _upsert("ad_metrics", fresh, "ad_key,day", transport=transport)
    _upsert("dashboard_state", [state_record(data)], "id", transport=transport)
