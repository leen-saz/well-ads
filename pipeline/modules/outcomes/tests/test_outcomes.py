import os, sys, unittest
from datetime import date
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
sys.path.insert(0, ROOT)
from modules.outcomes.run import measure

DATA = {"ads": {"s1": {"campaign": "C"}, "m9|instagram": {"campaign": "M"}},
        "rows": [["s1", f"2026-10-{d:02d}", 10.0, 1, 1, 2.0, 0] for d in range(13, 20)] + [["s1", f"2026-10-{d:02d}", 10.0, 1, 1, 4.0, 0] for d in range(20, 27)]}


class Outcomes(unittest.TestCase):
    def test_before_after_cpl(self):
        s = {"id": 1, "platform": "snap", "level": "ad", "target_id": "1", "status": "approved", "decided_at": "2026-10-20T10:00:00Z"}
        m = measure(DATA, s, 3, date(2026, 10, 28))
        self.assertEqual(m["metrics"]["before"]["cpl"], 5.0)
        self.assertEqual(m["metrics"]["after"]["cpl"], 2.5)
        self.assertEqual(m["vs_expect"]["cpl_change_pct"], -50.0)

    def test_too_early(self):
        s = {"id": 1, "platform": "snap", "level": "ad", "target_id": "1", "status": "approved", "decided_at": "2026-10-27T10:00:00Z"}
        self.assertIsNone(measure(DATA, s, 3, date(2026, 10, 28)))
