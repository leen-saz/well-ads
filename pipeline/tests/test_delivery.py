"""طبقة التسليم: الحكم من حقول المنصة فقط، بأسماء القيم الحقيقية للـAPI، لكل منصة كل حكم. الصرف ملاحظة ثانوية ولا يقرر. بيانات مختلقة."""
import os, sys, unittest
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import delivery
from delivery import REASON, UNKNOWN

R = timezone(timedelta(hours=3))
NOW = datetime(2026, 11, 19, 12, 0, tzinfo=R)
PAST, FUTURE = "2026-11-01T00:00:00+0300", "2026-12-25T00:00:00+0300"


def day(n):
    return (NOW - timedelta(days=n)).strftime("%Y-%m-%d")


def row(key, n, spend=5, impr=100):
    return [key, day(n), spend, impr, 1, 0, 0]


def verdict(state):
    return state[0]


class MetaStates(unittest.TestCase):
    def ad(self, st="ACTIVE", adset=None, camp=None):
        return {"effective_status": st,
                "adset": {"effective_status": "ACTIVE", "start_time": PAST, **(adset or {})},
                "campaign": {"effective_status": "ACTIVE", "start_time": PAST, **(camp or {})}}

    def test_every_verdict(self):
        cases = [
            (self.ad(), "delivering"),
            (self.ad("DISAPPROVED"), "rejected"),
            (self.ad("PENDING_REVIEW"), "in_review"),
            (self.ad("IN_PROCESS"), "in_review"),
            (self.ad("PREAPPROVED"), "scheduled"),
            (self.ad(adset={"start_time": FUTURE}), "scheduled"),
            (self.ad(adset={"end_time": "2026-11-10T00:00:00+0300"}), "ended"),
            (self.ad(camp={"stop_time": "2026-11-10T00:00:00+0300"}), "ended"),
            (self.ad(adset={"lifetime_budget": "50000", "budget_remaining": "0"}), "budget"),
            (self.ad("PAUSED"), "off"), (self.ad("ADSET_PAUSED"), "off"), (self.ad("CAMPAIGN_PAUSED"), "off"),
            (self.ad("WITH_ISSUES"), "off"), (self.ad("ARCHIVED"), "off"),
            (self.ad(adset={"effective_status": "PAUSED"}), "off"),
        ]
        for a, want in cases:
            self.assertEqual(verdict(delivery.meta_state(a, NOW)), want, a)

    def test_daily_budget_at_zero_is_still_delivering(self):
        self.assertEqual(verdict(delivery.meta_state(self.ad(adset={"daily_budget": "5000", "budget_remaining": "0"}), NOW)), "delivering")

    def test_missing_fields_are_unknown_not_a_guess(self):
        self.assertEqual(delivery.meta_state({}, NOW), UNKNOWN)
        a = self.ad(); del a["adset"]["start_time"]; del a["campaign"]["start_time"]
        self.assertEqual(delivery.meta_state(a, NOW), UNKNOWN)       # schedule fields did not come back
        a = self.ad(); del a["adset"]["effective_status"]
        self.assertEqual(delivery.meta_state(a, NOW), UNKNOWN)


class SnapStates(unittest.TestCase):
    def go(self, review="APPROVED", ad="ACTIVE", squad=None, camp=None):
        return verdict(delivery.snap_state({"review_status": review, "status": ad},
                                           {"status": "ACTIVE", **(squad or {})}, {"status": "ACTIVE", **(camp or {})}, NOW))

    def test_every_verdict(self):
        self.assertEqual(self.go(), "delivering")
        self.assertEqual(self.go("REJECTED"), "rejected")
        self.assertEqual(self.go("PENDING_REVIEW"), "in_review")
        self.assertEqual(self.go(squad={"start_time": "2026-12-25T00:00:00.000Z"}), "scheduled")
        self.assertEqual(self.go(camp={"start_time": "2026-12-25T00:00:00.000Z"}), "scheduled")
        self.assertEqual(self.go(squad={"end_time": "2026-11-01T00:00:00.000Z"}), "ended")
        self.assertEqual(self.go(ad="PAUSED"), "off")
        self.assertEqual(self.go(squad={"status": "PAUSED"}), "off")
        self.assertEqual(self.go(camp={"status": "PAUSED"}), "off")

    def test_missing_fields_are_unknown(self):
        self.assertEqual(delivery.snap_state({"status": "ACTIVE"}, {}, {}, NOW), UNKNOWN)               # no review_status
        self.assertEqual(delivery.snap_state({"review_status": "APPROVED", "status": "ACTIVE"}, {}, {}, NOW), UNKNOWN)   # no squad/campaign status


class GoogleStates(unittest.TestCase):
    def test_every_verdict(self):
        g = delivery.google_state
        self.assertEqual(verdict(g("APPROVED", "ELIGIBLE", "ELIGIBLE", [])), "delivering")
        self.assertEqual(verdict(g("APPROVED_LIMITED", "LIMITED", "LIMITED", ["BUDGET_CONSTRAINED"])), "delivering")
        self.assertEqual(verdict(g("APPROVED", "ELIGIBLE", "LEARNING", ["BIDDING_STRATEGY_LEARNING"])), "delivering")
        self.assertEqual(verdict(g("DISAPPROVED", "NOT_ELIGIBLE", "ELIGIBLE", [])), "rejected")
        self.assertEqual(verdict(g("APPROVED", "PENDING", "ELIGIBLE", [])), "in_review")
        self.assertEqual(verdict(g("APPROVED", "ELIGIBLE", "PENDING", ["CAMPAIGN_PENDING"])), "scheduled")
        self.assertEqual(verdict(g("APPROVED", "ELIGIBLE", "ENDED", ["CAMPAIGN_ENDED"])), "ended")
        self.assertEqual(verdict(g("APPROVED", "PAUSED", "ELIGIBLE", [])), "off")
        self.assertEqual(verdict(g("APPROVED", "ELIGIBLE", "PAUSED", ["CAMPAIGN_PAUSED"])), "off")
        self.assertEqual(verdict(g("APPROVED", "ELIGIBLE", "REMOVED", [])), "off")
        self.assertEqual(verdict(g("APPROVED", "NOT_ELIGIBLE", "NOT_ELIGIBLE", ["HAS_ADS_DISAPPROVED"])), "rejected")
        self.assertEqual(verdict(g("APPROVED", "NOT_ELIGIBLE", "NOT_ELIGIBLE", ["MOST_ADS_UNDER_REVIEW"])), "in_review")
        self.assertEqual(verdict(g("APPROVED", "NOT_ELIGIBLE", "NOT_ELIGIBLE", ["BUDGET_MISCONFIGURED"])), "budget")

    def test_missing_or_unreadable_is_unknown(self):
        self.assertEqual(delivery.google_state(None, None, None, None), UNKNOWN)
        self.assertEqual(delivery.google_state("APPROVED", "ELIGIBLE", "MISCONFIGURED", []), UNKNOWN)
        self.assertEqual(delivery.google_state("APPROVED", "NOT_ELIGIBLE", "NOT_ELIGIBLE", ["SOMETHING_NEW"]), UNKNOWN)


class TikTokStates(unittest.TestCase):
    def test_every_verdict(self):
        want = {"AD_STATUS_DELIVERY_OK": "delivering", "AD_STATUS_AUDIT": "in_review", "AD_STATUS_REAUDIT": "in_review",
                "AD_STATUS_AUDIT_DENY": "rejected", "AD_STATUS_REAUDIT_DENY": "rejected", "AD_STATUS_PARTIAL_AUDIT_DENY": "rejected",
                "AD_STATUS_NOT_START": "scheduled", "AD_STATUS_SCHEDULE_NOT_START": "scheduled",
                "AD_STATUS_DONE": "ended", "AD_STATUS_SCHEDULE_DONE": "ended", "AD_STATUS_TIME_DONE": "ended",
                "AD_STATUS_BUDGET_EXCEED": "budget", "AD_STATUS_CAMPAIGN_EXCEED": "budget",
                "AD_STATUS_DISABLE": "off", "AD_STATUS_CAMPAIGN_DISABLE": "off", "AD_STATUS_ADGROUP_DISABLE": "off",
                "AD_STATUS_DELETE": "off", "AD_STATUS_BALANCE_EXCEED": "off"}
        for st, v in want.items():
            self.assertEqual(verdict(delivery.tiktok_state({"secondary_status": st}, None, NOW)), v, st)

    def test_group_schedule_only_confirms(self):
        ok = {"secondary_status": "AD_STATUS_DELIVERY_OK"}
        self.assertEqual(verdict(delivery.tiktok_state(ok, {"schedule_end_time": "2026-11-01 00:00:00"}, NOW)), "ended")
        self.assertEqual(verdict(delivery.tiktok_state(ok, {"schedule_start_time": "2026-12-25 00:00:00"}, NOW)), "scheduled")
        self.assertEqual(verdict(delivery.tiktok_state(ok, {}, NOW)), "delivering")

    def test_missing_or_new_value_is_unknown(self):
        self.assertEqual(delivery.tiktok_state({}, None, NOW), UNKNOWN)
        self.assertEqual(delivery.tiktok_state({"secondary_status": "AD_STATUS_SOMETHING_NEW"}, None, NOW), UNKNOWN)


class Finalize(unittest.TestCase):
    def test_no_spend_is_a_note_and_never_the_verdict(self):
        a = {"m1": delivery.stamp({"live": True}, ("delivering", ""))}
        c = delivery.finalize(a, [row("m1", 6)], NOW)
        self.assertEqual(a["m1"]["delivery"], "delivering")            # the platform says delivering: it stays
        self.assertEqual(a["m1"]["delivery_days_no_spend"], 6)
        self.assertEqual(c, {"delivering": 1})
        self.assertTrue(a["m1"]["live"])

    def test_note_window_young_ad_and_never_spent(self):
        a = {"m1": {"live": True, "delivery": "delivering", "delivery_reason": ""}}
        delivery.finalize(a, [row("m1", 2)], NOW); self.assertNotIn("delivery_days_no_spend", a["m1"])
        delivery.finalize(a, [row("m1", 3)], NOW); self.assertEqual(a["m1"]["delivery_days_no_spend"], 3)
        a = {"m1": {"live": True, "delivery": "delivering", "delivery_reason": ""}}
        delivery.finalize(a, [], NOW); self.assertEqual(a["m1"]["delivery_days_no_spend"], delivery.WINDOW_DAYS)
        a["m1"]["fresh_at"] = (NOW - timedelta(hours=5)).isoformat()
        delivery.finalize(a, [], NOW); self.assertNotIn("delivery_days_no_spend", a["m1"])
        a["m1"]["fresh_at"] = (NOW - timedelta(hours=60)).isoformat()
        delivery.finalize(a, [], NOW); self.assertNotIn("fresh_at", a["m1"])

    def test_impressions_alone_and_placements(self):
        a = {"m1|facebook": {"live": True, "delivery": "delivering"}, "m1|instagram": {"live": True, "delivery": "delivering"}}
        delivery.finalize(a, [row("m1|facebook", 0, spend=0, impr=40)], NOW)
        self.assertTrue(all("delivery_days_no_spend" not in v for v in a.values()))

    def test_missing_verdict_is_unknown_when_on_and_off_when_not(self):
        a = {"s1": {"live": True}, "s2": {"live": False, "status": "متوقف"}}
        delivery.finalize(a, [], NOW)
        self.assertEqual((a["s1"]["delivery"], a["s1"]["delivery_reason"]), ("unknown", REASON["unknown"]))
        self.assertEqual((a["s2"]["delivery"], a["s2"]["delivery_reason"]), ("off", "متوقف"))

    def test_platform_verdicts_kept_and_carried_stopped_ad_goes_off(self):
        a = {"s1": delivery.stamp({"live": True}, ("rejected", REASON["rejected"])),
             "s3": delivery.stamp({"live": True}, ("scheduled", REASON["scheduled"])),
             "m1": {"live": False, "status": "متوقف", "delivery": "delivering"},
             "m2": {"live": False, "delivery": "rejected", "delivery_reason": REASON["rejected"]}}
        delivery.finalize(a, [row("s1", 0), row("s3", 0)], NOW)
        self.assertEqual([a[k]["delivery"] for k in ("s1", "s3", "m1", "m2")], ["rejected", "scheduled", "off", "rejected"])

    def test_failed_platform_keeps_previous_note(self):
        a = {"t1": {"live": True, "delivery": "delivering", "delivery_reason": "", "delivery_days_no_spend": 4}}
        delivery.finalize(a, [], NOW, ok_prefixes=("m",))
        self.assertEqual(a["t1"]["delivery_days_no_spend"], 4)

    def test_first_seen_ad_is_young(self):
        a = {"m1": {"live": True, "delivery": "delivering"}}
        delivery.finalize(a, [], NOW, prev_ads={"m9": {}})
        self.assertNotIn("delivery_days_no_spend", a["m1"])

    def test_guarded_never_raises_and_gives_unknown(self):
        ad = {"live": True}
        delivery.guarded(ad, lambda: 1 / 0)
        self.assertEqual((ad["delivery"], ad["live"]), ("unknown", True))

    def test_before_after_counts(self):
        a = {f"m{i}": delivery.stamp({"live": True}, ("delivering", "")) for i in range(10)}
        c = delivery.finalize(a, [row(f"m{i}", 0) for i in range(7)], NOW)
        self.assertEqual(c, {"delivering": 10})
        self.assertEqual(sum(1 for v in a.values() if "delivery_days_no_spend" in v), 3)


if __name__ == "__main__":
    unittest.main()
