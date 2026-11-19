"""طبقة التسليم: مرفوض، مجدول، منتهي، بلا صرف، يصرف، إعفاء الإعلان الجديد، وحقول ناقصة. بيانات وهمية كلها."""
import os, sys, unittest
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import delivery
from tiktok.merge import tiktok_live

R = timezone(timedelta(hours=3))
NOW = datetime(2026, 11, 19, 12, 0, tzinfo=R)


def day(n):
    return (NOW - timedelta(days=n)).strftime("%Y-%m-%d")


def iso(hours_ago):
    return (NOW - timedelta(hours=hours_ago)).isoformat()


def row(key, n, spend=5, impr=100):
    return [key, day(n), spend, impr, 1, 0, 0]


class PlatformStates(unittest.TestCase):
    def test_meta_variants(self):
        base = {"effective_status": "ACTIVE", "adset": {"effective_status": "ACTIVE"}, "campaign": {}}
        self.assertEqual(delivery.meta_state({**base, "effective_status": "DISAPPROVED"}, False, NOW)[0], "rejected")
        self.assertEqual(delivery.meta_state({**base, "effective_status": "PENDING_REVIEW"}, False, NOW)[0], "in_review")
        self.assertEqual(delivery.meta_state(base, True, NOW), (None, "", True))
        fut = {**base, "adset": {"effective_status": "ACTIVE", "start_time": "2026-11-25T00:00:00+0300"}}
        self.assertEqual(delivery.meta_state(fut, True, NOW)[0], "scheduled")
        past = {**base, "campaign": {"stop_time": "2026-11-10T00:00:00+0300"}}
        self.assertEqual(delivery.meta_state(past, True, NOW)[0], "ended")
        life = {**base, "adset": {"effective_status": "ACTIVE", "lifetime_budget": "50000", "budget_remaining": "0"}}
        self.assertEqual(delivery.meta_state(life, True, NOW)[0], "budget")
        daily = {**base, "adset": {"effective_status": "ACTIVE", "daily_budget": "5000", "budget_remaining": "0"}}
        self.assertIsNone(delivery.meta_state(daily, True, NOW)[0])

    def test_snap_rejected_review_and_schedule(self):
        self.assertEqual(delivery.snap_state({"review_status": "REJECTED"}, {}, {}, True, NOW)[0], "rejected")
        self.assertEqual(delivery.snap_state({"review_status": "PENDING_REVIEW"}, {}, {}, True, NOW)[0], "in_review")
        ok = {"review_status": "APPROVED"}
        self.assertEqual(delivery.snap_state(ok, {}, {"start_time": "2026-12-01T00:00:00.000Z"}, True, NOW)[0], "scheduled")
        self.assertEqual(delivery.snap_state(ok, {"end_time": "2026-11-01T00:00:00.000Z"}, {}, True, NOW)[0], "ended")
        self.assertEqual(delivery.snap_state(ok, {}, {}, True, NOW), (None, "", True))

    def test_google(self):
        self.assertEqual(delivery.google_state("DISAPPROVED", "NOT_ELIGIBLE", "ELIGIBLE", "SERVING", True)[0], "rejected")
        self.assertEqual(delivery.google_state("APPROVED", "ELIGIBLE", "ENDED", "ENDED", True)[0], "ended")
        self.assertEqual(delivery.google_state("APPROVED", "ELIGIBLE", "PENDING", "PENDING", True)[0], "scheduled")
        self.assertEqual(delivery.google_state("APPROVED", "ELIGIBLE", "ELIGIBLE", "SERVING", True), (None, "", True))

    def test_tiktok(self):
        for st, want in (("AD_STATUS_AUDIT_DENY", "rejected"), ("AD_STATUS_AUDIT", "in_review"),
                         ("AD_STATUS_SCHEDULE_NOT_START", "scheduled"), ("AD_STATUS_SCHEDULE_DONE", "ended"),
                         ("AD_STATUS_BUDGET_EXCEED", "budget")):
            self.assertEqual(delivery.tiktok_state({"secondary_status": st}, None, True, NOW)[0], want, st)
        grp = {"schedule_end_time": "2026-11-01 00:00:00"}
        self.assertEqual(delivery.tiktok_state({"secondary_status": "AD_STATUS_DELIVERY_OK"}, grp, True, NOW)[0], "ended")

    def test_missing_fields_are_not_known(self):
        self.assertEqual(delivery.meta_state({}, True, NOW), (None, "", False))
        self.assertFalse(delivery.snap_state({}, {}, {}, True, NOW)[2])
        self.assertFalse(delivery.google_state(None, None, None, None, True)[2])
        self.assertFalse(delivery.tiktok_state({}, None, True, NOW)[2])

    def test_live_semantics_unchanged(self):
        # tiktok_live still means "switched on" even when the ad is rejected
        x = {"operation_status": "ENABLE", "campaign_operation_status": "ENABLE", "adgroup_operation_status": "ENABLE",
             "secondary_status": "AD_STATUS_AUDIT_DENY"}
        self.assertTrue(tiktok_live(x))


class DataRule(unittest.TestCase):
    def ads(self, **kw):
        return {"m1": {"live": True, "status": "نشط", **kw}}

    def test_delivering(self):
        a = self.ads(); delivery.finalize(a, [row("m1", 1)], NOW)
        self.assertEqual(a["m1"]["delivery"], "delivering")
        self.assertEqual(a["m1"]["delivery_reason"], "")

    def test_no_spend_with_days(self):
        a = self.ads(); counts = delivery.finalize(a, [row("m1", 6)], NOW)
        self.assertEqual((a["m1"]["delivery"], a["m1"]["delivery_days"]), ("no_spend", 6))
        self.assertEqual(counts, {"no_spend": 1})
        self.assertTrue(a["m1"]["live"])   # live untouched

    def test_no_spend_never_had_data(self):
        a = self.ads(); delivery.finalize(a, [], NOW)
        self.assertEqual(a["m1"]["delivery"], "no_spend"); self.assertNotIn("delivery_days", a["m1"])

    def test_window_edge_is_three_days(self):
        a = self.ads(); delivery.finalize(a, [row("m1", 2)], NOW); self.assertEqual(a["m1"]["delivery"], "delivering")
        a = self.ads(); delivery.finalize(a, [row("m1", 3)], NOW); self.assertEqual(a["m1"]["delivery"], "no_spend")

    def test_impressions_alone_count(self):
        a = self.ads(); delivery.finalize(a, [row("m1", 0, spend=0, impr=40)], NOW); self.assertEqual(a["m1"]["delivery"], "delivering")

    def test_young_ad_exempt_old_ad_not(self):
        a = self.ads(fresh_at=iso(5)); delivery.finalize(a, [], NOW); self.assertEqual(a["m1"]["delivery"], "delivering")
        a = self.ads(fresh_at=iso(30)); delivery.finalize(a, [], NOW); self.assertEqual(a["m1"]["delivery"], "no_spend")
        self.assertNotIn("fresh_at", a["m1"] if a["m1"]["delivery"] == "x" else {})
        b = self.ads(fresh_at=iso(60)); delivery.finalize(b, [], NOW); self.assertNotIn("fresh_at", b["m1"])

    def test_first_seen_ad_is_young(self):
        a = self.ads(); delivery.finalize(a, [], NOW, prev_ads={"m9": {}}); self.assertEqual(a["m1"]["delivery"], "delivering")

    def test_placements_pool_by_ad(self):
        a = {"m1|facebook": {"live": True}, "m1|instagram": {"live": True}}
        delivery.finalize(a, [row("m1|facebook", 0)], NOW)
        self.assertEqual({v["delivery"] for v in a.values()}, {"delivering"})

    def test_platform_verdict_kept_and_off(self):
        a = {"s1": delivery.stamp({"live": True}, ("rejected", delivery.REASON["rejected"], True)),
             "s2": delivery.stamp({"live": False, "status": "متوقف"}, (None, "", True)),
             "s3": delivery.stamp({"live": True}, ("scheduled", delivery.REASON["scheduled"], True))}
        delivery.finalize(a, [row("s1", 0), row("s3", 0)], NOW)
        self.assertEqual([a[k]["delivery"] for k in ("s1", "s2", "s3")], ["rejected", "off", "scheduled"])
        self.assertEqual(a["s2"]["delivery_reason"], "متوقف")

    def test_fallback_says_so(self):
        a = {"g1": delivery.stamp({"live": True}, (None, "", False))}
        delivery.finalize(a, [], NOW)
        self.assertEqual(a["g1"]["delivery"], "no_spend")
        self.assertIn(delivery.REASON["fallback"], a["g1"]["delivery_reason"])
        b = {"g1": delivery.stamp({"live": True}, (None, "", False))}
        delivery.finalize(b, [row("g1", 0)], NOW)
        self.assertEqual((b["g1"]["delivery"], b["g1"]["delivery_reason"]), ("delivering", delivery.REASON["fallback"]))

    def test_failed_platform_keeps_previous_state(self):
        a = {"t1": {"live": True, "delivery": "delivering", "delivery_reason": ""}}
        delivery.finalize(a, [], NOW, ok_prefixes=("m",))
        self.assertEqual(a["t1"]["delivery"], "delivering")

    def test_carried_forward_stopped_ad_goes_off(self):
        a = {"m1": {"live": False, "status": "متوقف", "delivery": "delivering"}}
        delivery.finalize(a, [row("m1", 0)], NOW); self.assertEqual(a["m1"]["delivery"], "off")

    def test_before_after_counts(self):
        """130 ads shape in miniature: 10 switched on, 3 do not spend."""
        a = {f"m{i}": {"live": True} for i in range(10)}
        rows = [row(f"m{i}", 0) for i in range(7)]
        live_before = sum(1 for v in a.values() if v["live"])
        c = delivery.finalize(a, rows, NOW)
        self.assertEqual((live_before, c.get("delivering"), c.get("no_spend")), (10, 7, 3))


if __name__ == "__main__":
    unittest.main()
