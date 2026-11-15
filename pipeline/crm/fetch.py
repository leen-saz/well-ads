#!/usr/bin/env python3
"""Well CRM leads (Marketing API v1) into Supabase `crm_leads`. Read-only on the CRM (GET only).

First run: backfill from the first day of the ads history (the oldest day in `ad_metrics`) by created_at. Every run after: rows changed since the largest
`updated_at` stored (`crm_sync_state`), following cursors, upserted by `lead_id`.
Once a day (the first run of each UTC day) it also re-pulls every lead created in the last 92 days, ignoring `updated_at`:
a payment recorded in the CRM without a new `updated_at` would otherwise never reach us.
The key (CRM_API_KEY) is never printed. Docs: the Marketing API v1 document from the CRM owner.
"""
import json, os, sys, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import supabase_store  # noqa: E402

API = "https://mgmgyezmrmhxmvtegupb.supabase.co/functions/v1/marketing-leads"
LIMIT = 500
BACKFILL_DAYS = 90
FULL_PASS_DAYS = 92  # the API allows at most 92 days per created_from/created_to window
COLUMNS = (
    "lead_id customer_id created_at platform_created_at updated_at source_platform attribution_tier "
    "campaign_id campaign_name adset_id adset_name ad_id ad_id_quality ad_name form_id status crm_stage "
    "lost_reason booking_id booked_at service_date department service city booking_value_sar "
    "amount_paid_sar paid_at payment_status is_returning customer_lead_seq"
).split()


RETRY_CODES = (429, 500, 502, 503, 504)


def retry_after(value, default=5, cap=60):
    """Seconds to wait from a Retry-After header: a number of seconds or an HTTP date; anything else is the default."""
    v = (value or "").strip()
    try:
        return min(max(int(v), 1), cap)
    except ValueError:
        pass
    try:
        from email.utils import parsedate_to_datetime
        dt = parsedate_to_datetime(v)
        return min(max(int((dt - datetime.now(dt.tzinfo)).total_seconds()), 1), cap)
    except Exception:  # noqa: BLE001 - not a date either
        return default


def http_get(url, key, retries=3, sleep=None, opener=None):
    """GET with the bearer key; waits on 429 (Retry-After as seconds or a date), retries 5xx and network errors."""
    sleep = sleep or time.sleep   # looked up at call time so a test can patch either
    opener = opener or urllib.request.urlopen
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, headers={"Authorization": "Bearer " + key, "Accept": "application/json"})
        try:
            with opener(req, timeout=60) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as ex:
            if ex.code in RETRY_CODES and attempt < retries:
                sleep(retry_after(ex.headers.get("Retry-After")) if ex.code == 429 else 2 ** attempt)
                continue
            try:
                code = json.loads(ex.read()).get("error", {}).get("code", "")
            except Exception:  # noqa: BLE001 - body may not be JSON
                code = ""
            raise RuntimeError(f"crm HTTP {ex.code} {code}".strip()) from None
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt < retries:
                sleep(2 ** attempt)
                continue
            raise RuntimeError("crm network error") from None
    raise RuntimeError("crm: retries exhausted")


def pages(params, key, get=http_get):
    """Yield every page's rows for one filter set, following next_cursor."""
    cursor = None
    while True:
        q = dict(params, limit=LIMIT, **({"cursor": cursor} if cursor else {}))
        body = get(API + "?" + urllib.parse.urlencode(q), key)
        yield body.get("data") or []
        cursor = (body.get("page") or {}).get("next_cursor")
        if not cursor:
            return


def record(row):
    rec = {c: row.get(c) for c in COLUMNS}
    rec["doc"] = row
    return rec


def ads_start(transport=None):
    """First day of the ads history (oldest ad_metrics day), or None."""
    got = supabase_store._request("GET", "/rest/v1/ad_metrics?select=day&order=day.asc&limit=1", transport=transport) or []
    day = got[0].get("day") if got else None
    return datetime.fromisoformat(str(day)[:10]).replace(tzinfo=timezone(timedelta(hours=3))) if day else None


def windows(now, days=BACKFILL_DAYS, step=92, start=None):
    """created_from/created_to windows from `start` (or the last `days`) to now; the API allows at most 92 days each."""
    start = start or now - timedelta(days=days)
    while start < now:
        end = min(start + timedelta(days=step), now)
        yield {"created_from": start.isoformat(), "created_to": end.isoformat()}
        start = end


def full_pass_due(now, last_run_at):
    """True on the first run of each UTC day (the previous run was on an earlier day, or never)."""
    if not last_run_at:
        return True
    try:
        prev = datetime.fromisoformat(str(last_run_at).replace("Z", "+00:00"))
    except ValueError:
        return True
    if prev.tzinfo is None:
        prev = prev.replace(tzinfo=timezone.utc)
    return prev.astimezone(timezone.utc).date() < now.astimezone(timezone.utc).date()


def sync(key, now=None, get=http_get, transport=None):
    now = now or datetime.now(timezone.utc)
    state = supabase_store._request("GET", "/rest/v1/crm_sync_state?id=eq.1&select=*", transport=transport) or []
    last = state[0].get("last_updated_at") if state else None
    if last:
        # The API accepts at most 92 days back; a longer gap falls back to a backfill window
        since = datetime.fromisoformat(str(last).replace("Z", "+00:00"))
        filters = [{"updated_since": since.isoformat()}] if now - since < timedelta(days=91) else list(windows(now, start=since))
        if full_pass_due(now, state[0].get("last_run_at")):
            filters += list(windows(now, days=FULL_PASS_DAYS, step=FULL_PASS_DAYS))
    else:
        filters = list(windows(now, start=ads_start(transport)))
    total, newest = 0, last
    for params in filters:
        for rows in pages(params, key, get):
            if not rows:
                continue
            supabase_store._request(
                "POST", "/rest/v1/crm_leads?on_conflict=lead_id", [record(r) for r in rows],
                extra_headers={"Prefer": "resolution=merge-duplicates,return=minimal"}, transport=transport)
            total += len(rows)
            tops = [r["updated_at"] for r in rows if r.get("updated_at")]
            if tops:   # a page where no row has updated_at must not crash the whole sync
                top = max(tops)
                newest = top if not newest or top > str(newest) else newest
    supabase_store._request(
        "POST", "/rest/v1/crm_sync_state?on_conflict=id",
        [{"id": 1, "last_updated_at": newest, "last_run_at": now.isoformat(), "rows_last_run": total}],
        extra_headers={"Prefer": "resolution=merge-duplicates,return=minimal"}, transport=transport)
    return total, newest


def main():
    key = (os.environ.get("CRM_API_KEY") or "").strip()
    if not key:
        print("crm: CRM_API_KEY missing, skipped")
        return 0
    if not supabase_store.enabled():
        print("crm: Supabase missing, skipped")
        return 0
    total, newest = sync(key)
    print(f"crm: {total} leads upserted | newest updated_at {newest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
