import os, sys, unittest
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
sys.path.insert(0, ROOT)
from modules.learn.run import lessons


class Learn(unittest.TestCase):
    def test_rejected_rule_becomes_block(self):
        d = [{"id": i, "platform": "snap", "kind": "budget_up", "status": "rejected", "note": "ليدز سناب مو حقيقية"} for i in range(6)]
        out = lessons(d, [], [])
        self.assertTrue(out[0]["block"]); self.assertIn("رفض 6 من 6", out[0]["lesson"])
        self.assertEqual(out[0]["evidence"]["notes"][0], "ليدز سناب مو حقيقية")

    def test_approval_rate_and_outcome(self):
        d = [{"id": i, "platform": "meta", "kind": "pause", "status": "approved", "note": None} for i in range(3)]
        o = [{"suggestion_id": i, "day": 7, "vs_expect": {"cpl_change_pct": c}} for i, c in enumerate([-20, -10, -30])]
        out = lessons(d, o, [])
        txt = " ".join(x["lesson"] for x in out)
        self.assertIn("100%", txt); self.assertIn("نزلت 20%", txt)
        self.assertFalse(any(x["block"] for x in out))

    def test_manual_moves(self):
        a = [{"platform": "meta", "event": "update_ad_set_budget", "actor": "Mayada"}] * 4
        out = lessons([], [], a)
        self.assertEqual(out[0]["kind"], "manual:update_ad_set_budget"); self.assertIn("Mayada (4)", out[0]["lesson"])
