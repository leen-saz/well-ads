import os, sys, unittest
from datetime import date
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
sys.path.insert(0, ROOT)
from modules.critic.run import review

T = date(2026, 10, 28)


class Critic(unittest.TestCase):
    def test_pause_before_three_days_is_blocked(self):
        c = review({"kind": "pause", "digest": "x", "evidence": {"first_day": "2026-10-27"}}, T)
        self.assertFalse(c["ok"]); self.assertIn("3", c["issues"][0])

    def test_pause_after_three_days_ok(self):
        self.assertTrue(review({"kind": "pause", "digest": "x", "evidence": {"first_day": "2026-10-20"}}, T)["ok"])

    def test_budget_over_limit(self):
        self.assertFalse(review({"kind": "budget_up", "digest": "x", "params": {"pct": 35}}, T)["ok"])
        self.assertTrue(review({"kind": "budget_up", "digest": "x", "params": {"pct": 20}}, T)["ok"])

    def test_traffic_pause_skips_age_rule(self):
        self.assertTrue(review({"kind": "pause_campaign", "digest": "x", "evidence": {"objective": "traffic"}}, T)["ok"])

    def test_new_campaign_needs_leen_and_rules(self):
        c = review({"kind": "new_campaign", "digest": "x", "params": {"objective": "traffic", "advantage_plus": True, "age_min": 18}}, T)
        self.assertFalse(c["ok"]); self.assertEqual(len(c["issues"]), 4)

    def test_lessons_block(self):
        c = review({"kind": "budget_up", "platform": "snap", "digest": "x", "params": {"pct": 20}}, T, [{"kind": "budget_up", "platform": "snap", "block": True, "lesson": "رفع سناب ما جاب ليدز"}])
        self.assertFalse(c["ok"])


if __name__ == "__main__":
    unittest.main()
