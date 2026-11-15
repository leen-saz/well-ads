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

    def tearDown(self):
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
