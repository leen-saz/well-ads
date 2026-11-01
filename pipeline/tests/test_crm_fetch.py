import json, os, sys, unittest, urllib.parse
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
