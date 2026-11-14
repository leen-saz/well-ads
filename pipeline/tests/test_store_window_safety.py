import os, sys, unittest
from unittest import mock
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import supabase_store as store


class WindowSafety(unittest.TestCase):
    def setUp(self):
        p = mock.patch.object(store, "credentials", return_value=("https://sb.example", "k"))
        p.start(); self.addCleanup(p.stop)

    def data(self, rows):
        return {"ads": {r[0]: {"platform": "meta"} for r in rows}, "rows": rows, "range": {"start": "2026-06-30", "today": "2026-11-13"}}

    def test_recent_window_is_written_before_anything_is_deleted(self):
        calls = []

        def transport(method, url, data, headers):
            calls.append((method, url))
            if method == "GET":
                return [{"ad_key": "m1", "day": "2026-11-12"}, {"ad_key": "m1", "day": "2026-11-11"}]
        rows = [["m1", "2026-11-12", 5, 100, 3, 1, 0]]
        store.save_bundle(self.data(rows), recent_from="2026-11-10", ok_prefixes=["m"], transport=transport)
        deletes = [u for m, u in calls if m == "DELETE"]
        self.assertEqual(len(deletes), 1)
        self.assertIn("day=in.(2026-11-11)", deletes[0])
        first_delete = next(i for i, (m, _) in enumerate(calls) if m == "DELETE")
        last_post = max(i for i, (m, u) in enumerate(calls) if m == "POST" and "ad_metrics" in u)
        self.assertLess(last_post, first_delete)

    def test_platform_with_no_fresh_rows_keeps_its_window(self):
        calls = []

        def transport(method, url, data, headers):
            calls.append(method)
            return [{"ad_key": "m1", "day": "2026-11-12"}] if method == "GET" else None
        store.save_bundle(self.data([]), recent_from="2026-11-10", ok_prefixes=["m"], transport=transport)
        self.assertNotIn("DELETE", calls)

    def test_failure_after_write_leaves_no_hole(self):
        def transport(method, url, data, headers):
            if method == "GET":
                raise RuntimeError("supabase HTTP 502")
        rows = [["m1", "2026-11-12", 5, 100, 3, 1, 0]]
        with self.assertRaises(RuntimeError):
            store.save_bundle(self.data(rows), recent_from="2026-11-10", ok_prefixes=["m"], transport=transport)

    def test_full_orphan_delete_skips_days_before_range_start_and_failed_platforms(self):
        calls = []

        def transport(method, url, data, headers):
            calls.append((method, url))
            if method == "GET":
                return [{"ad_key": "m1", "day": "2026-01-01"},      # older than range_start: kept
                        {"ad_key": "g1", "day": "2026-10-01"},      # platform not ok: kept
                        {"ad_key": "m2", "day": "2026-10-01"}]      # in range, ok platform, not returned: deleted
        rows = [["m1", "2026-11-12", 5, 100, 3, 1, 0]]
        store.save_bundle(self.data(rows), full=True, ok_prefixes=["m"], transport=transport)
        deletes = [u for m, u in calls if m == "DELETE"]
        self.assertEqual(len(deletes), 1)
        self.assertIn("ad_key=eq.m2", deletes[0])


if __name__ == "__main__":
    unittest.main()
