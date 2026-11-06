import os, sys, unittest
from unittest import mock
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import supabase_store as store


class FullSave(unittest.TestCase):
    def setUp(self):
        p = mock.patch.object(store, "credentials", return_value=("https://sb.example", "k"))
        p.start(); self.addCleanup(p.stop)

    def data(self, n):
        return {"ads": {f"m1{i}": {"platform": "meta", "name": "a"} for i in range(n)}, "rows": [[f"m1{i}", "2026-10-01", 5, 100, 3, 1, 0] for i in range(n)], "range": {}}

    def test_failed_chunk_deletes_nothing(self):
        calls = []

        def transport(method, url, data, headers):
            calls.append(method)
            if method == "POST" and "ad_metrics" in url:
                raise RuntimeError("supabase HTTP 502")
        with self.assertRaises(RuntimeError):
            store.save_bundle(self.data(3), full=True, transport=transport)
        self.assertNotIn("DELETE", calls)       # history stays when a write fails

    def test_full_replaces_after_writing(self):
        calls = []

        def transport(method, url, data, headers):
            calls.append((method, url))
            if method == "GET":
                return [{"ad_key": "m10", "day": "2026-10-01"}, {"ad_key": "gone", "day": "2026-09-01"}]
        store.save_bundle(self.data(1), full=True, transport=transport)
        deletes = [u for m, u in calls if m == "DELETE"]
        self.assertEqual(len(deletes), 1)
        self.assertIn("ad_key=eq.gone", deletes[0])
        first_delete = next(i for i, (m, _) in enumerate(calls) if m == "DELETE")
        last_post = max(i for i, (m, u) in enumerate(calls) if m == "POST" and "ad_metrics" in u)
        self.assertLess(last_post, first_delete)

    def test_empty_fetch_never_wipes_history(self):
        calls = []

        def transport(method, url, data, headers):
            calls.append(method)
            return [{"ad_key": "m10", "day": "2026-10-01"}] if method == "GET" else None
        store.save_bundle({"ads": {}, "rows": [], "range": {}}, full=True, transport=transport)
        self.assertNotIn("DELETE", calls)
        self.assertNotIn("GET", calls)


if __name__ == "__main__":
    unittest.main()
