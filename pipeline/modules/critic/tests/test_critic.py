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


class RiyadhDay(unittest.TestCase):
    def test_today_is_riyadh_not_utc(self):
        from datetime import datetime, timezone
        from modules.core.clock import riyadh_today
        # 21:07 UTC on the 27th is 00:07 on the 28th in Riyadh
        self.assertEqual(riyadh_today(datetime(2026, 10, 27, 21, 7, tzinfo=timezone.utc)), date(2026, 10, 28))
        self.assertEqual(riyadh_today(datetime(2026, 10, 27, 20, 59, tzinfo=timezone.utc)), date(2026, 10, 27))

    def test_critic_default_day_follows_riyadh(self):
        from unittest import mock
        s = {"kind": "pause", "digest": "x", "evidence": {"first_day": "2026-10-25"}}   # 3 days on the 28th (Riyadh), 2 on the 27th
        with mock.patch("modules.critic.run.riyadh_today", return_value=date(2026, 10, 28)):
            self.assertTrue(review(s)["ok"])
        with mock.patch("modules.critic.run.riyadh_today", return_value=date(2026, 10, 27)):
            self.assertFalse(review(s)["ok"])
