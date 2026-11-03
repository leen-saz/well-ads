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

    def test_campaign_spend_stays_out_of_the_public_log(self):
        # The notes go to the public Actions log and step summary: no amount unless PIPELINE_DEBUG=1
        d = {"platforms": {}, "ads": {"m1": {"dept": "brand", "campaign": "META_X"}}, "rows": [["m1", "2026-10-27", 1234.0, 1, 1, 0, 0]]}
        os.environ.pop("PIPELINE_DEBUG", None)
        self.assertNotIn("1234", health.check(d, NOW)[1][0])
        os.environ["PIPELINE_DEBUG"] = "1"
        try:
            self.assertIn("1234", health.check(d, NOW)[1][0])
        finally:
            del os.environ["PIPELINE_DEBUG"]


if __name__ == "__main__":
    unittest.main()
