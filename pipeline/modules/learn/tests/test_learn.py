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


class FakeDb:
    def __init__(self, old, fail_post=False):
        self.old, self.calls, self.fail_post = old, [], fail_post

    def req(self, path, method="GET", body=None, prefer=None):
        self.calls.append((method, path, body))
        if method == "GET":
            return self.old
        if method == "POST" and self.fail_post:
            raise RuntimeError("down")


class Refresh(unittest.TestCase):
    NEW = [{"platform": "meta", "kind": "pause", "lesson": "A"}, {"platform": "snap", "kind": "budget_up", "lesson": "B"}]

    def test_decided_lessons_stay_and_are_not_written_again(self):
        from modules.learn.run import refresh_lessons
        old = [{"id": 1, "platform": "meta", "kind": "pause", "lesson": "A", "status": "approved"},
               {"id": 2, "platform": "snap", "kind": "x", "lesson": "old", "status": "new"},
               {"id": 3, "platform": "snap", "kind": "y", "lesson": "old2", "status": "reviewed"}]
        db = FakeDb(old)
        wrote = refresh_lessons(db, self.NEW)
        self.assertEqual([l["lesson"] for l in wrote], ["B"])
        patch = [c for c in db.calls if c[0] == "PATCH"]
        self.assertEqual(len(patch), 1)
        self.assertIn("id=in.(2,3)", patch[0][1])          # only undecided ones, never the approved id 1
        self.assertNotIn("module=eq.ads&active", patch[0][1])
        self.assertTrue(db.calls[1][0] == "POST" and db.calls[2][0] == "PATCH")   # new first, then deactivate

    def test_a_failed_write_deactivates_nothing(self):
        from modules.learn.run import refresh_lessons
        db = FakeDb([{"id": 2, "platform": "p", "kind": "k", "lesson": "old", "status": "new"}], fail_post=True)
        with self.assertRaises(RuntimeError):
            refresh_lessons(db, self.NEW)
        self.assertFalse([c for c in db.calls if c[0] == "PATCH"])

    def test_reads_only_wells_ads_lessons(self):
        from modules.learn.run import refresh_lessons, WELL
        db = FakeDb([])
        refresh_lessons(db, [])
        self.assertIn(f"company_id=eq.{WELL}", db.calls[0][1])
