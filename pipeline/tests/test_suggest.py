"""قواعد اقتراحات لوحة القرارات. لا شبكة ولا Supabase."""
import os, sys, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import suggest


def data(rows, ads):
    return {"range": {"today": "2026-10-28"}, "ads": ads, "rows": rows}


class Rules(unittest.TestCase):
    def setUp(self):
        # هدف سناب آخر 30 يوم: 100 ريال / 20 ليد = 5
        self.base_rows = [["s0", "2026-10-10", 100.0, 1000, 10, 20.0, 0]]
        self.ads = {"s0": {"platform": "snap", "goal": "lead", "live": False, "name": "old", "campaign": "C"}}

    def kinds(self, rows, ads):
        return {(s["target_id"], s["kind"]) for s in suggest.build(data(self.base_rows + rows, {**self.ads, **ads}))}

    def test_pause_when_twice_target_and_no_leads(self):
        got = self.kinds([["s1", "2026-10-25", 12.0, 500, 5, 0.0, 0]], {"s1": {"platform": "snap", "goal": "lead", "live": True, "name": "a", "campaign": "C"}})
        self.assertIn(("1", "pause"), got)

    def test_no_pause_under_twice_target_or_when_stopped(self):
        got = self.kinds([["s1", "2026-10-25", 9.0, 500, 5, 0.0, 0], ["s2", "2026-10-25", 50.0, 500, 5, 0.0, 0]],
                         {"s1": {"platform": "snap", "goal": "lead", "live": True, "name": "a"},
                          "s2": {"platform": "snap", "goal": "lead", "live": False, "name": "b"}})
        self.assertFalse({k for k in got if k[1] == "pause"})

    def test_budget_up_for_cheap_winners(self):
        got = suggest.build(data(self.base_rows + [["s3", "2026-10-26", 30.0, 900, 9, 10.0, 0]],
                                 {**self.ads, "s3": {"platform": "snap", "goal": "lead", "live": True, "name": "w"}}))
        up = [s for s in got if s["kind"] == "budget_up"]
        self.assertEqual(up[0]["params"], {"pct": 20, "scope": "adset"})

    def test_traffic_campaign(self):
        got = self.kinds([["t9", "2026-10-26", 5.0, 100, 1, 0.0, 0]], {"t9": {"platform": "tiktok", "goal": "traffic", "live": True, "name": "x", "campaign": "WA_Traffic"}})
        self.assertIn(("WA_Traffic", "pause_campaign"), got)

    def test_meta_placements_count_together(self):
        rows = [["m5|facebook", "2026-10-25", 7.0, 300, 3, 0.0, 0], ["m5|instagram", "2026-10-25", 7.0, 300, 3, 0.0, 0]]
        ads = {k: {"platform": "facebook", "goal": "lead", "live": True, "name": "m"} for k in ("m5|facebook", "m5|instagram")}
        ads["m0"] = {"platform": "facebook", "goal": "lead", "live": False, "name": "o"}
        got = suggest.build(data([["m0", "2026-10-10", 50.0, 900, 9, 10.0, 0]] + rows, ads))
        self.assertEqual([(s["target_id"], s["kind"]) for s in got], [("5", "pause")])


if __name__ == "__main__":
    unittest.main()


class Chats(unittest.TestCase):
    def test_messages_ads_get_pause_and_budget_up_by_cost_per_chat(self):
        from modules.suggest.run import build
        ads = {"m1": {"goal": "messages", "live": True, "name": "dead", "campaign": "WP"},
               "m2": {"goal": "messages", "live": True, "name": "cheap", "campaign": "WP"},
               "m3": {"goal": "messages", "live": True, "name": "avg", "campaign": "WP"}}
        rows = []
        for i in range(10):
            d = f"2026-10-{18 + i:02d}"
            rows += [["m1", d, 20.0, 100, 1, 0.0, 0], ["m2", d, 5.0, 100, 1, 0.0, 2], ["m3", d, 30.0, 100, 1, 0.0, 2]]
        out = {s["target_name"]: s for s in build({"range": {"today": "2026-10-28"}, "ads": ads, "rows": rows}, "2026-10-28")}
        self.assertEqual(out["dead"]["kind"], "pause")
        self.assertEqual(out["dead"]["evidence"]["metric"], "chats")
        self.assertEqual(out["cheap"]["kind"], "budget_up")
        self.assertNotIn("avg", out)


class FakeDb:
    def __init__(self, open_rows):
        self.open_rows, self.calls = open_rows, []
    def req(self, path, method="GET", body=None, prefer=None):
        self.calls.append((method, path, body))
        if method == "GET":
            return self.open_rows if "status=eq.open" in path else []


class Sync(unittest.TestCase):
    def test_open_row_without_digest_gets_plan_and_new_review(self):
        from modules.suggest.run import plan, sync
        s = plan({"platform": "snap", "level": "ad", "target_id": "1", "kind": "pause", "params": {}, "evidence": {"spend": 50}})
        db = FakeDb([{"id": 7, "platform": "snap", "target_id": "1", "kind": "pause", "digest": None, "revision": 1}])
        self.assertEqual(sync([s], db), (0, 0, 1, 1))
        patch = [b for m, p, b in db.calls if m == "PATCH"][0]
        self.assertEqual(patch["digest"], s["digest"])
        self.assertIsNone(patch["critic"])
        self.assertEqual(patch["revision"], 1)

    def test_same_digest_is_left_alone(self):
        from modules.suggest.run import plan, sync
        s = plan({"platform": "snap", "level": "ad", "target_id": "1", "kind": "pause", "params": {}, "evidence": {"spend": 50}})
        db = FakeDb([{"id": 7, "platform": "snap", "target_id": "1", "kind": "pause", "digest": s["digest"], "revision": 1}])
        self.assertEqual(sync([s], db), (0, 0, 1, 0))
        self.assertFalse([c for c in db.calls if c[0] == "PATCH"])
