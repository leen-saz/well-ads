import json, os, sys, unittest, urllib.error, urllib.parse
from datetime import datetime, timezone
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from crm import fetch  # noqa: E402

NOW = datetime(2026, 11, 1, 12, 0, tzinfo=timezone.utc)


def row(i, updated):
    return {"lead_id": f"L-{i}", "created_at": "2026-10-01T00:00:00Z", "updated_at": updated, "source_platform": "meta_form",
            "status": "booked", "ad_id": "123", "amount_paid_sar": 500, "extra_field": "kept in doc"}


class Db:
    def __init__(self, state):
        self.state, self.writes = state, []

    def __call__(self, method, url, data, headers):
        if method == "GET":
            return self.state
        self.writes.append((url, json.loads(data)))
        return None


class SyncTests(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(os.environ, {"SUPABASE_URL": "https://db.test", "SUPABASE_SERVICE_ROLE_KEY": "k"})
        self.env.start()
        self.pause = mock.patch.object(fetch, "PAGE_PAUSE_S", 0)
        self.pause.start()

    def tearDown(self):
        self.pause.stop()
        self.env.stop()

    def test_first_run_starts_at_the_first_ads_day(self):
        seen = []

        def get(url, key):
            seen.append(urllib.parse.parse_qs(urllib.parse.urlparse(url).query))
            return {"data": [], "page": {"next_cursor": None}}

        class StartDb(Db):
            def __call__(self, method, url, data, headers):
                if method == "GET" and "ad_metrics" in url:
                    return [{"day": "2025-12-01"}]
                return super().__call__(method, url, data, headers)

        fetch.sync("k", now=NOW, get=get, transport=StartDb([]))
        self.assertTrue(seen[0]["created_from"][0].startswith("2025-12-01T00:00:00+03:00"))
        self.assertEqual(len(seen), 4)  # 2025-12-01 → 2026-11-01 in windows of 92 days
        self.assertEqual(seen[-1]["created_to"], [NOW.isoformat()])

    def test_first_run_backfills_90_days_and_follows_cursors(self):
        calls = []

        def get(url, key):
            calls.append(urllib.parse.parse_qs(urllib.parse.urlparse(url).query))
            if "cursor" not in calls[-1]:
                return {"data": [row(1, "2026-10-30T10:00:00Z")], "page": {"next_cursor": "c2"}}
            return {"data": [row(2, "2026-10-31T09:00:00Z")], "page": {"next_cursor": None}}

        db = Db([])
        total, newest = fetch.sync("mk_live_x", now=NOW, get=get, transport=db)
        self.assertEqual(total, 2)
        self.assertEqual(newest, "2026-10-31T09:00:00Z")
        self.assertIn("created_from", calls[0])
        self.assertEqual(calls[0]["limit"], ["500"])
        self.assertEqual(calls[1]["cursor"], ["c2"])
        leads = [w for w in db.writes if "crm_leads" in w[0]]
        self.assertEqual(len(leads), 2)
        self.assertIn("on_conflict=lead_id", leads[0][0])
        self.assertEqual(leads[0][1][0]["doc"]["extra_field"], "kept in doc")
        state = [w for w in db.writes if "crm_sync_state" in w[0]][0][1][0]
        self.assertEqual(state["last_updated_at"], "2026-10-31T09:00:00Z")

    def test_next_runs_use_updated_since(self):
        seen = []

        def get(url, key):
            seen.append(urllib.parse.parse_qs(urllib.parse.urlparse(url).query))
            return {"data": [], "page": {"next_cursor": None}}

        fetch.sync("k", now=NOW, get=get, transport=Db([{"last_updated_at": "2026-10-31T09:00:00+00:00"}]))
        self.assertEqual(seen[0]["updated_since"], ["2026-10-31T09:00:00+00:00"])
        self.assertNotIn("created_from", seen[0])

    def test_daily_full_pass_picks_up_a_payment_without_new_updated_at(self):
        """The CRM records a payment but leaves updated_at alone: only the created-window pass can see it."""
        crm = {"L-1": dict(row(1, "2026-10-20T10:00:00Z"), amount_paid_sar=0, payment_status="pending")}
        seen = []

        def get(url, key):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
            seen.append(q)
            if "updated_since" in q:  # updated_at never moved, so the incremental pull returns nothing
                return {"data": [], "page": {"next_cursor": None}}
            return {"data": list(crm.values()), "page": {"next_cursor": None}}

        state = [{"last_updated_at": "2026-10-31T09:00:00+00:00", "last_run_at": "2026-10-31T23:07:00+00:00"}]
        crm["L-1"].update(amount_paid_sar=750, payment_status="paid")  # paid later, same updated_at
        db = Db(state)
        total, _ = fetch.sync("k", now=NOW, get=get, transport=db)
        self.assertEqual(total, 1)
        self.assertEqual(seen[0].get("updated_since"), ["2026-10-31T09:00:00+00:00"])
        full = seen[1]
        span = datetime.fromisoformat(full["created_to"][0]) - datetime.fromisoformat(full["created_from"][0])
        self.assertEqual(span.days, 92)
        self.assertEqual(full["limit"], ["500"])
        leads = [w for w in db.writes if "crm_leads" in w[0]]
        self.assertEqual(leads[0][1][0]["payment_status"], "paid")
        self.assertEqual(leads[0][1][0]["amount_paid_sar"], 750)

    def test_full_pass_runs_once_a_day_only(self):
        seen = []

        def get(url, key):
            seen.append(urllib.parse.parse_qs(urllib.parse.urlparse(url).query))
            return {"data": [], "page": {"next_cursor": None}}

        state = [{"last_updated_at": "2026-11-01T09:00:00+00:00", "last_run_at": "2026-11-01T08:07:00+00:00"}]
        fetch.sync("k", now=NOW, get=get, transport=Db(state))  # same UTC day: incremental only
        self.assertEqual(len(seen), 1)
        self.assertIn("updated_since", seen[0])

    def test_full_pass_due(self):
        self.assertTrue(fetch.full_pass_due(NOW, None))
        self.assertTrue(fetch.full_pass_due(NOW, "garbage"))
        self.assertTrue(fetch.full_pass_due(NOW, "2026-10-31T23:59:00Z"))
        self.assertFalse(fetch.full_pass_due(NOW, "2026-11-01T00:01:00Z"))

    def test_full_pass_retries_on_503_and_429(self):
        calls = []

        def flaky(req, timeout=60):
            calls.append(1)
            import io
            if len(calls) == 1:
                raise urllib.error.HTTPError("u", 429, "x", {"Retry-After": "0"}, io.BytesIO(b"{}"))
            if len(calls) == 2:
                raise urllib.error.HTTPError("u", 503, "x", {}, io.BytesIO(b"{}"))
            r = mock.MagicMock()
            r.__enter__.return_value.read.return_value = b'{"data": [], "page": {}}'
            return r

        with mock.patch("urllib.request.urlopen", flaky), mock.patch("time.sleep") as sl:
            fetch.http_get(fetch.API + "?created_from=x", "k")
        self.assertEqual(len(calls), 3)
        self.assertEqual(sl.call_count, 2)

    def test_backfill_windows_never_exceed_92_days(self):
        ws = list(fetch.windows(NOW, days=200))
        for w in ws:
            span = datetime.fromisoformat(w["created_to"]) - datetime.fromisoformat(w["created_from"])
            self.assertLessEqual(span.days, 92)
        self.assertEqual(ws[-1]["created_to"], NOW.isoformat())

    def test_only_get_requests_reach_the_crm(self):
        with mock.patch("urllib.request.urlopen") as op:
            op.return_value.__enter__.return_value.read.return_value = b'{"data": [], "page": {}}'
            fetch.http_get(fetch.API + "?created_from=2026-10-01", "mk_live_x")
            req = op.call_args[0][0]
            self.assertEqual(req.get_method(), "GET")
            self.assertEqual(req.headers["Authorization"], "Bearer mk_live_x")


if __name__ == "__main__":
    unittest.main()


class RetryHardening(unittest.TestCase):
    def test_retry_after_accepts_seconds_dates_and_garbage(self):
        from email.utils import format_datetime
        from datetime import datetime, timedelta, timezone
        retry_after = fetch.retry_after
        self.assertEqual(retry_after("7"), 7)
        self.assertEqual(retry_after("9999"), 60)
        self.assertEqual(retry_after("garbage"), 5)
        self.assertEqual(retry_after(None), 5)
        when = format_datetime(datetime.now(timezone.utc) + timedelta(seconds=30), usegmt=True)
        self.assertTrue(1 <= retry_after(when) <= 30)

    def _http_error(self, code):
        import io, urllib.error
        return urllib.error.HTTPError("u", code, "x", {}, io.BytesIO(b"{}"))

    def test_retries_a_500_and_a_network_error_then_succeeds(self):
        import io, urllib.error
        http_get = fetch.http_get
        seq = [self._http_error(502), urllib.error.URLError("down"), None]

        def opener(req, timeout):
            item = seq.pop(0)
            if item is not None:
                raise item

            class R(io.BytesIO):
                def __enter__(s): return s
                def __exit__(s, *a): return False
            return R(b'{"ok": 1}')
        self.assertEqual(http_get("http://x", "k", sleep=lambda s: None, opener=opener), {"ok": 1})

    def test_a_4xx_is_not_retried(self):
        http_get = fetch.http_get
        calls = []

        def opener(req, timeout):
            calls.append(1)
            raise self._http_error(403)
        with self.assertRaises(RuntimeError):
            http_get("http://x", "k", sleep=lambda s: None, opener=opener)
        self.assertEqual(len(calls), 1)


class StateDb:
    """A fake Supabase: keeps crm_sync_state like PostgREST would. `migrated=False` refuses the new columns."""
    def __init__(self, row=None, migrated=True):
        self.row, self.migrated, self.state_writes, self.lead_batches = dict(row or {}), migrated, [], []

    def __call__(self, method, url, data, headers):
        if method == "GET":
            if "select=last_full_pass_at" in url and not self.migrated:
                raise RuntimeError("supabase HTTP 400: column does not exist")
            return [self.row] if self.row else []
        body = json.loads(data)
        if "crm_sync_state" in url:
            if not self.migrated and any(k in body[0] for k in ("last_full_pass_at", "full_pass_cursor", "full_pass_pages_last")):
                raise RuntimeError("supabase HTTP 400: column does not exist")
            self.row.update(body[0])
            self.state_writes.append(body[0])
        elif "crm_leads" in url:
            self.lead_batches.append([r["lead_id"] for r in body])
        return None


class FakeCrm:
    """Pages of the 92-day pass (n pages) and an incremental feed; records every request."""
    def __init__(self, full_pages=0, incr=None, fail_at=None, fail=None):
        self.full_pages, self.incr, self.fail_at, self.fail, self.requests = full_pages, incr or [], fail_at, fail, []

    def __call__(self, url, key):
        q = {k: v[0] for k, v in urllib.parse.parse_qs(urllib.parse.urlparse(url).query).items()}
        self.requests.append(q)
        if self.fail_at is not None and len(self.requests) >= self.fail_at:
            raise self.fail
        if "updated_since" in q:
            return {"data": list(self.incr), "page": {"next_cursor": None}}
        n = int(q.get("cursor", "0"))
        rows = [row(f"p{n}-{i}", "2026-10-01T00:00:00Z") for i in range(2)]
        return {"data": rows, "page": {"next_cursor": str(n + 1) if n + 1 < self.full_pages else None}}


class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t

    def sleep(self, s):
        self.t += s


LAST = "2026-11-01T09:00:00+00:00"
YESTERDAY = "2026-10-31T23:07:00+00:00"


class ResilientSync(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(os.environ, {"SUPABASE_URL": "https://db.test", "SUPABASE_SERVICE_ROLE_KEY": "k"})
        self.env.start()
        self.clock = Clock()

    def tearDown(self):
        self.env.stop()

    def run_sync(self, crm, db, **kw):
        kw.setdefault("page_pause", 0)
        return fetch.sync_detailed("k", now=NOW, get=crm, transport=db, sleep=self.clock.sleep, clock=self.clock, log=lambda *_: None, **kw)

    def test_full_pass_is_chunked_and_resumes_from_the_saved_cursor(self):
        db = StateDb({"last_updated_at": LAST, "last_full_pass_at": YESTERDAY, "full_pass_cursor": None})
        crm = FakeCrm(full_pages=5)
        r1 = self.run_sync(crm, db, max_full_pages=2)
        self.assertEqual((r1["status"], r1["pages"]), ("chunk", 3))  # 1 incremental + 2 full pages
        self.assertEqual(db.row["full_pass_cursor"]["cursor"], "2")
        self.assertGreater(r1["left"], 0)
        self.assertEqual(db.row["last_full_pass_at"], YESTERDAY)  # not done yet: not marked
        crm2 = FakeCrm(full_pages=5)
        r2 = self.run_sync(crm2, db, max_full_pages=2)
        self.assertEqual(r2["status"], "chunk")
        self.assertEqual(crm2.requests[1]["cursor"], "2")  # resumed, did not start over
        self.assertEqual(crm2.requests[1]["created_from"], crm.requests[1]["created_from"])  # same window
        r3 = self.run_sync(FakeCrm(full_pages=5), db, max_full_pages=2)
        self.assertEqual((r3["status"], r3["left"]), ("complete", 0))
        self.assertEqual(db.row["last_full_pass_at"], NOW.isoformat())
        self.assertIsNone(db.row["full_pass_cursor"])
        self.assertEqual(db.row["full_pass_pages_last"], 5)
        seen = [l for b in db.lead_batches for l in b]
        self.assertEqual(len(seen), len(set(seen)))  # no page was pulled twice across the three runs
        # finished today: the next run is incremental only
        crm4 = FakeCrm(full_pages=5)
        self.run_sync(crm4, db)
        self.assertEqual(len(crm4.requests), 1)

    def test_a_killed_run_resumes_without_repeating(self):
        """The process dies (an exception that is not caught) after two full-pass pages; the next run continues after them."""
        db = StateDb({"last_updated_at": LAST, "last_full_pass_at": YESTERDAY})
        crm = FakeCrm(full_pages=6, fail_at=4, fail=KeyboardInterrupt())
        with self.assertRaises(KeyboardInterrupt):
            self.run_sync(crm, db)
        self.assertEqual(db.row["full_pass_cursor"]["cursor"], "2")
        crm2 = FakeCrm(full_pages=6)
        self.run_sync(crm2, db)
        self.assertEqual(crm2.requests[1]["cursor"], "2")
        pulled = [l for b in db.lead_batches for l in b]
        self.assertEqual(len(pulled), len(set(pulled)))

    def test_incremental_checkpoints_after_each_page_and_never_moves_back(self):
        pages = [{"data": [row(1, "2026-11-01T10:00:00Z")], "page": {"next_cursor": "c"}},
                 {"data": [row(2, "2026-11-01T11:00:00Z")], "page": {"next_cursor": "d"}}]

        def crm(url, key):
            if len(pages) == 0:
                raise KeyboardInterrupt()
            return pages.pop(0)
        db = StateDb({"last_updated_at": LAST, "last_full_pass_at": NOW.isoformat()})
        with self.assertRaises(KeyboardInterrupt):
            self.run_sync(crm, db)
        self.assertEqual(db.row["last_updated_at"], "2026-11-01T11:00:00Z")
        # a later, older-looking batch must not pull the checkpoint back
        db.row["last_updated_at"] = "2026-11-02T00:00:00Z"
        crm2 = FakeCrm(incr=[row(3, "2026-11-01T12:00:00Z")])
        self.run_sync(crm2, db)
        self.assertEqual(db.row["last_updated_at"], "2026-11-02T00:00:00Z")

    def test_unordered_incremental_is_not_checkpointed_midway(self):
        pages = [{"data": [row(1, "2026-11-01T12:00:00Z"), row(2, "2026-11-01T10:00:00Z")], "page": {"next_cursor": "c"}}]

        def crm(url, key):
            if pages:
                return pages.pop(0)
            raise KeyboardInterrupt()
        db = StateDb({"last_updated_at": LAST, "last_full_pass_at": NOW.isoformat()})
        with self.assertRaises(KeyboardInterrupt):
            self.run_sync(crm, db)
        self.assertEqual(db.row["last_updated_at"], LAST)

    def test_429_keeps_the_checkpoint_and_ends_cleanly(self):
        db = StateDb({"last_updated_at": LAST, "last_full_pass_at": YESTERDAY})
        crm = FakeCrm(full_pages=5, fail_at=3, fail=fetch.RateLimited("crm HTTP 429 rate_limited"))
        r = self.run_sync(crm, db)
        self.assertEqual(r["status"], "rate_limited")
        self.assertEqual(r["pages"], 2)
        self.assertEqual(db.row["full_pass_cursor"]["cursor"], "1")
        self.assertEqual(db.row["last_full_pass_at"], YESTERDAY)

    def test_main_exit_codes(self):
        with mock.patch.dict(os.environ, {"CRM_API_KEY": "k"}), mock.patch.object(fetch.supabase_store, "enabled", return_value=True):
            def fake(status, pages):
                return mock.patch.object(fetch, "sync_detailed", return_value={"total": 7, "left": 3, "status": status, "pages": pages, "newest": None})
            with fake("budget", 4), mock.patch("builtins.print") as pr:
                self.assertEqual(fetch.main(), 0)
                self.assertEqual(pr.call_args_list[0][0][0], "crm: 7 leads upserted, 3 pages left")
            with fake("rate_limited", 2):
                self.assertEqual(fetch.main(), 0)
            with fake("rate_limited", 0):
                self.assertEqual(fetch.main(), 1)  # nothing moved: a real failure
            with mock.patch.object(fetch, "sync_detailed", side_effect=RuntimeError("crm HTTP 500")):
                with self.assertRaises(RuntimeError):
                    fetch.main()

    def test_time_budget_saves_and_stops_before_the_next_request(self):
        db = StateDb({"last_updated_at": LAST, "last_full_pass_at": YESTERDAY})
        crm = FakeCrm(full_pages=10)
        r = self.run_sync(crm, db, budget=10, page_pause=4)  # 1 + pause 4 + pause 4 + pause 4 > 10
        self.assertEqual(r["status"], "budget")
        self.assertLess(len(crm.requests), 6)
        self.assertEqual(db.row["full_pass_cursor"]["cursor"], str(len(crm.requests) - 1))
        self.assertEqual(db.row["last_run_at"], NOW.isoformat())

    def test_http_get_does_not_start_a_wait_past_the_deadline(self):
        import io

        def opener(req, timeout):
            raise urllib.error.HTTPError("u", 429, "x", {"Retry-After": "30"}, io.BytesIO(b"{}"))
        clock = Clock()
        slept = []
        with self.assertRaises(fetch.RateLimited):
            fetch.http_get("http://x", "k", sleep=slept.append, opener=opener, deadline=10, clock=clock)
        self.assertEqual(slept, [])

    def test_before_the_migration_the_old_behaviour_is_kept(self):
        logs = []
        db = StateDb({"last_updated_at": LAST, "last_run_at": YESTERDAY}, migrated=False)
        crm = FakeCrm(full_pages=3)
        r = fetch.sync_detailed("k", now=NOW, get=crm, transport=db, sleep=self.clock.sleep, clock=self.clock, page_pause=0, log=logs.append)
        self.assertTrue(any("migration 036" in l for l in logs))
        self.assertEqual(r["status"], "complete")  # whole pass in one go, like before
        self.assertEqual(db.row["last_run_at"], NOW.isoformat())
        self.assertTrue(all("full_pass_cursor" not in w and "last_full_pass_at" not in w for w in db.state_writes))
        # a run cut short does not claim the daily pass is done
        db2 = StateDb({"last_updated_at": LAST, "last_run_at": YESTERDAY}, migrated=False)
        r2 = fetch.sync_detailed("k", now=NOW, get=FakeCrm(full_pages=10, fail_at=3, fail=fetch.RateLimited("429")), transport=db2,
                                 sleep=self.clock.sleep, clock=self.clock, page_pause=0, log=lambda *_: None)
        self.assertEqual(r2["status"], "rate_limited")
        self.assertEqual(db2.row["last_run_at"], YESTERDAY)

    def test_a_refused_saved_cursor_restarts_the_pass(self):
        cur = {"from": "2026-08-01T00:00:00+00:00", "to": "2026-10-31T00:00:00+00:00", "cursor": "stale", "pages": 4}
        db = StateDb({"last_updated_at": LAST, "last_full_pass_at": YESTERDAY, "full_pass_cursor": cur})

        def crm(url, key):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
            if q.get("cursor") == ["stale"]:
                raise RuntimeError("crm HTTP 400 invalid_cursor")
            return {"data": [row(1, "2026-10-01T00:00:00Z")], "page": {"next_cursor": None}}
        r = self.run_sync(crm, db)
        self.assertEqual(r["status"], "complete")
        self.assertEqual(db.row["last_full_pass_at"], NOW.isoformat())

    def test_a_real_error_is_raised_but_progress_stays_saved(self):
        db = StateDb({"last_updated_at": LAST, "last_full_pass_at": YESTERDAY})
        crm = FakeCrm(full_pages=5, fail_at=3, fail=RuntimeError("crm HTTP 500"))
        with self.assertRaises(RuntimeError):
            self.run_sync(crm, db)
        self.assertEqual(db.row["full_pass_cursor"]["cursor"], "1")
