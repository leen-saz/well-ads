"""فحص صحة البيانات. لا شبكة."""
import os, sys, unittest
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import health

NOW = datetime(2026, 10, 29, 13, 5, tzinfo=timezone(timedelta(hours=3)))


class Health(unittest.TestCase):
    def test_clean(self):
        d = {"platforms": {"meta": {"ok": True, "coverage_end": "2026-10-29"}, "tiktok": {"ok": True, "synced_at": "2026-10-29T12:00+03:00"}}, "ads": {}, "rows": []}
        self.assertEqual(health.check(d, NOW), ([], []))

    def test_failures_and_stale(self):
        d = {"platforms": {"snap": {"ok": False, "error": "HTTP 503"}, "google": {"ok": True, "coverage_end": "2026-10-26"},
                           "tiktok": {"ok": True, "synced_at": "2026-10-28T13:00+03:00"}}, "ads": {}, "rows": []}
        p, _ = health.check(d, NOW)
        self.assertEqual(len(p), 3)

    def test_unclassified_campaigns(self):
        d = {"platforms": {}, "ads": {"m1": {"dept": "brand", "campaign": "META_X"}, "m2": {"dept": "iv", "campaign": "IV"}},
             "rows": [["m1", "2026-10-27", 50.0, 1, 1, 0, 0], ["m2", "2026-10-27", 50.0, 1, 1, 0, 0]]}
        _, n = health.check(d, NOW)
        self.assertEqual(len(n), 1)
        self.assertIn("META_X", n[0])


if __name__ == "__main__":
    unittest.main()
