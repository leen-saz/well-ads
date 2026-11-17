#!/usr/bin/env python3
"""Well CRM leads (Marketing API v1) into Supabase `crm_leads`. Read-only on the CRM (GET only).

First run: backfill from the first day of the ads history (the oldest day in `ad_metrics`) by created_at. Every run after: rows changed since the largest
`updated_at` stored (`crm_sync_state`), following cursors, upserted by `lead_id`.
Once a day it also re-pulls every lead created in the last 92 days, ignoring `updated_at`:
a payment recorded in the CRM without a new `updated_at` would otherwise never reach us.
That full pass is chunked (a few pages per hourly run; its cursor is kept in `crm_sync_state.full_pass_cursor`) and counts as done
(`last_full_pass_at`) only when it finishes. Progress is saved after every page, a run stops by itself after a time budget (below the
workflow step timeout), and a rate-limited CRM (429) pauses the run instead of failing it: the next hourly run resumes where it stopped.
Before migration 037 the new columns do not exist: the code then falls back to the old once-a-day logic and says so in the log.
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
RUN_BUDGET_S = 6 * 60        # stop cleanly before the 8-minute step timeout in refresh.yml
PAGE_PAUSE_S = 1.0           # pause between two page requests (the CRM rate-limits)
FULL_PASS_PAGES_PER_RUN = 6  # of ~25 pages (~12,000 leads) per full pass, so a pass takes ~4-5 hourly runs
FULL_PASS_PAGES_GUESS = 25   # until a first pass has finished and recorded the real number


class RateLimited(RuntimeError):
    """The CRM kept answering 429 after the allowed waits."""


class _Stop(Exception):
    """Internal: end this run cleanly (reason: 'budget' or 'chunk')."""


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


def http_get(url, key, retries=3, sleep=None, opener=None, deadline=None, clock=None):
    """GET with the bearer key; waits on 429 (Retry-After as seconds or a date), retries 5xx and network errors.
    With a `deadline` (on `clock`, default time.monotonic) it never starts a wait that would end after it."""
    sleep = sleep or time.sleep   # looked up at call time so a test can patch either
    clock = clock or time.monotonic
    opener = opener or urllib.request.urlopen

    def wait(seconds, rate_limited):
        if deadline is not None and clock() + seconds > deadline:
            raise RateLimited("crm HTTP 429 rate_limited") if rate_limited else RuntimeError("crm: out of time while retrying")
        sleep(seconds)
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, headers={"Authorization": "Bearer " + key, "Accept": "application/json"})
        try:
            with opener(req, timeout=60) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as ex:
            if ex.code in RETRY_CODES and attempt < retries:
                wait(retry_after(ex.headers.get("Retry-After")) if ex.code == 429 else 2 ** attempt, ex.code == 429)
                continue
            try:
                code = json.loads(ex.read()).get("error", {}).get("code", "")
            except Exception:  # noqa: BLE001 - body may not be JSON
                code = ""
            raise (RateLimited if ex.code == 429 else RuntimeError)(f"crm HTTP {ex.code} {code}".strip()) from None
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt < retries:
                wait(2 ** attempt, False)
                continue
            raise RuntimeError("crm network error") from None
    raise RuntimeError("crm: retries exhausted")


def iter_pages(params, key, get=http_get, cursor=None):
    """Yield (rows, next_cursor) per page for one filter set, following next_cursor (optionally resuming from one)."""
    while True:
        q = dict(params, limit=LIMIT, **({"cursor": cursor} if cursor else {}))
        body = get(API + "?" + urllib.parse.urlencode(q), key)
        cursor = (body.get("page") or {}).get("next_cursor") or None
        yield body.get("data") or [], cursor
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


def _dt(value):
    """A timestamp string (Z or offset; naive = UTC) as an aware datetime, or None."""
    try:
        d = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


class _Run:
    """One hourly run. Everything it learns is saved as it goes, so a killed run loses at most one page."""

    def __init__(self, key, now, get, transport, sleep, clock, budget, max_full_pages, page_pause, log):
        self.key, self.now, self.transport, self.log = key, now, transport, log
        self.clock = clock or time.monotonic
        self.deadline = self.clock() + budget
        self.sleep = sleep or time.sleep
        self.max_full_pages, self.page_pause = max_full_pages, page_pause
        if get is http_get:
            get = lambda url, k: http_get(url, k, sleep=sleep, deadline=self.deadline, clock=self.clock)  # noqa: E731
        self.get = get
        self.total = self.pages = self.fetched = 0
        self.newest = None
        self.newest_dt = None
        self.left = 0
        self.migrated = True
        self.row = {}

    # -- state --------------------------------------------------------------------------------------------------
    def put(self, rec):
        supabase_store._request(
            "POST", "/rest/v1/crm_sync_state?on_conflict=id", [dict(rec, id=1)],
            extra_headers={"Prefer": "resolution=merge-duplicates,return=minimal"}, transport=self.transport)

    def load(self):
        state = supabase_store._request("GET", "/rest/v1/crm_sync_state?id=eq.1&select=*", transport=self.transport) or []
        self.row = state[0] if state else {}
        if state:
            self.migrated = "last_full_pass_at" in self.row
        else:  # no row yet: ask for the new column to learn whether migration 037 was applied
            try:
                supabase_store._request("GET", "/rest/v1/crm_sync_state?select=last_full_pass_at&limit=1", transport=self.transport)
            except RuntimeError:
                self.migrated = False
        if not self.migrated:
            self.log("crm: migration 037 not applied yet, using the old once-a-day logic (progress inside a full pass is not kept)")
        self.newest = self.row.get("last_updated_at")
        self.newest_dt = _dt(self.newest)

    # -- pages --------------------------------------------------------------------------------------------------
    def fetch(self, params, cursor=None):
        """(rows, next_cursor) per page, paced; raises _Stop('budget') before a request once the time is up."""
        for rows, nxt in iter_pages(params, self.key, self._paced_get, cursor):
            yield rows, nxt

    def _paced_get(self, url, k):
        if self.clock() >= self.deadline:
            raise _Stop("budget")
        if self.fetched:
            self.sleep(self.page_pause)
        self.fetched += 1
        return self.get(url, k)

    def upsert(self, rows):
        if rows:
            supabase_store._request(
                "POST", "/rest/v1/crm_leads?on_conflict=lead_id", [record(r) for r in rows],
                extra_headers={"Prefer": "resolution=merge-duplicates,return=minimal"}, transport=self.transport)
        self.total += len(rows)
        self.pages += 1
        for r in rows:  # `newest` only ever moves forward
            d = _dt(r.get("updated_at"))
            if d and (self.newest_dt is None or d > self.newest_dt):
                self.newest_dt, self.newest = d, r["updated_at"]

    # -- the three kinds of pull ----------------------------------------------------------------------------------
    def incremental(self, since):
        """Rows changed since the largest updated_at stored. The checkpoint moves after every page, but only while the API hands rows
        out in ascending updated_at order (otherwise a half-done pull could skip older rows; the daily full pass covers those)."""
        ascending, prev = True, None
        for rows, nxt in self.fetch({"updated_since": since.isoformat()}):
            self.upsert(rows)
            for r in rows:
                d = _dt(r.get("updated_at"))
                if d and prev and d < prev:
                    ascending = False
                prev = d or prev
            if ascending and nxt and self.newest:
                self.put({"last_updated_at": self.newest})

    def est_left(self, cur):
        """Pages of the full pass still to do (an estimate: the size of the last finished pass), at least 1 while it is unfinished."""
        done = cur.get("pages", 0) if isinstance(cur, dict) else 0
        return max(1, (self.row.get("full_pass_pages_last") or FULL_PASS_PAGES_GUESS) - done)

    def full_pass(self):
        """The last 92 days by created_at, at most `max_full_pages` per run; raises _Stop('chunk') when the chunk is used up."""
        cur = self.row.get("full_pass_cursor") if self.migrated else None
        if not (isinstance(cur, dict) and cur.get("from") and cur.get("to")):
            cur = {"from": (self.now - timedelta(days=FULL_PASS_DAYS)).isoformat(), "to": self.now.isoformat(), "cursor": None, "pages": 0}
        self.left = self.est_left(cur)
        took, restarted = 0, False
        while True:
            try:
                for rows, nxt in self.fetch({"created_from": cur["from"], "created_to": cur["to"]}, cur["cursor"]):
                    self.upsert(rows)
                    took += 1
                    cur["pages"] += 1
                    cur["cursor"] = nxt
                    if nxt:
                        self.left = self.est_left(cur)
                        if self.migrated:
                            self.put({"full_pass_cursor": cur})
                        if took >= self.max_full_pages:
                            raise _Stop("chunk")
                break
            except (RateLimited, _Stop):
                raise
            except RuntimeError as ex:  # a resumed cursor the CRM refuses (4xx): start the pass over once
                if cur["cursor"] and not restarted and str(ex).startswith("crm HTTP 4"):
                    self.log("crm: the saved full-pass cursor was refused, restarting the pass")
                    cur.update(cursor=None, pages=0)
                    restarted = True
                    continue
                raise
        self.left = 0
        return {"last_full_pass_at": self.now.isoformat(), "full_pass_cursor": None, "full_pass_pages_last": cur["pages"]}

    def created_windows(self, since, transport):
        """First run, or a gap longer than the API allows: created_at windows from the start. All-or-nothing, because updated_at is
        not a valid checkpoint here (a later window holds older rows)."""
        for params in list(windows(self.now, start=since or ads_start(transport))):
            for rows, _ in self.fetch(params):
                self.upsert(rows)

    # -- one run ---------------------------------------------------------------------------------------------------
    def run(self):
        self.load()
        status, done = "complete", {}
        final = {}   # what to save at the end of a run that got as far as it could
        try:
            since = _dt(self.row.get("last_updated_at"))
            if since and self.now - since < timedelta(days=91):
                prior = self.row.get("last_full_pass_at") if self.migrated else self.row.get("last_run_at")
                due = (self.migrated and bool(self.row.get("full_pass_cursor"))) or full_pass_due(self.now, prior)
                if due:
                    self.left = self.est_left(self.row.get("full_pass_cursor") if self.migrated else None)
                self.incremental(since)
                if due:
                    done = self.full_pass()
                else:
                    done = {"_not_due": True}
            else:
                self.created_windows(since, self.transport)
                done = {"last_full_pass_at": self.now.isoformat(), "full_pass_cursor": None}
        except _Stop as stop:
            status = "budget" if stop.args[0] == "budget" else "complete"
            if stop.args[0] == "chunk":
                status = "chunk"
        except RateLimited:
            status = "rate_limited"
        # Save what we have. last_updated_at only moves forward. The new columns are written only once migration 037 is there.
        if self.newest:
            final["last_updated_at"] = self.newest
        finished_pass = bool(done)  # a pass finished, or none was due
        if self.migrated:
            final.update({k: v for k, v in done.items() if not k.startswith("_")})
            final.update(last_run_at=self.now.isoformat(), rows_last_run=self.total)
        elif finished_pass:  # old behaviour: last_run_at moves only when the whole run completed
            final.update(last_run_at=self.now.isoformat(), rows_last_run=self.total)
        if final:
            self.put(final)
        return {"total": self.total, "newest": self.newest, "pages": self.pages, "left": self.left, "status": status}


def sync_detailed(key, now=None, get=http_get, transport=None, sleep=None, clock=None, budget=None,
                  max_full_pages=None, page_pause=None, log=print):
    """One hourly run: dict with total (rows upserted), newest, pages (fetched), left (full-pass pages still to do) and
    status ('complete' | 'chunk' (this run's share of the full pass is done) | 'budget' | 'rate_limited').
    A real error (not 429, not out of time) is raised, after the progress made so far has been saved."""
    now = now or datetime.now(timezone.utc)
    return _Run(key, now, get, transport, sleep, clock, RUN_BUDGET_S if budget is None else budget,
                FULL_PASS_PAGES_PER_RUN if max_full_pages is None else max_full_pages,
                PAGE_PAUSE_S if page_pause is None else page_pause, log).run()


def sync(key, now=None, get=http_get, transport=None, **kw):
    res = sync_detailed(key, now=now, get=get, transport=transport, **kw)
    return res["total"], res["newest"]


def main():
    key = (os.environ.get("CRM_API_KEY") or "").strip()
    if not key:
        print("crm: CRM_API_KEY missing, skipped")
        return 0
    if not supabase_store.enabled():
        print("crm: Supabase missing, skipped")
        return 0
    res = sync_detailed(key)
    print(f"crm: {res['total']} leads upserted, {res['left']} pages left")
    if res["status"] == "budget":
        print("crm: time budget reached, progress saved, the next hourly run resumes")
    elif res["status"] == "rate_limited":
        print("crm: the CRM is rate-limiting (429), progress saved, the next hourly run resumes")
        if not res["pages"]:
            return 1  # nothing moved at all: a real failure, show it
    elif res["status"] == "chunk":
        print("crm: this run's share of the daily full pass is done, the rest follows in the next runs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
