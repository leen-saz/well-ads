"""`live` = مفتاح التشغيل، ولا تغيّره طبقة delivery أبداً. يشغّل snap() وmeta() الحقيقيتين بواجهات وهمية بنفس الشكل الحقيقي (بيانات مختلقة).
الانحدار اللي صار (2026-11-20): دالة snap المحلية delivery() غطّت وحدة delivery، فانفجر build() وابتلعه safe()،
فما بقي إعلان سناب طازج، وcarry_forward حوّل كل إعلانات سناب النشطة السابقة إلى متوقفة."""
import os, sys, unittest
from datetime import datetime, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import fetch_data as F

NOW = datetime.now(F.RIYADH)
DAY = F.ds(F.TODAY)
STAMP = lambda d: (NOW + timedelta(days=d)).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def snap_api(url, **kw):
    u = url.split("?")[0]
    if u.endswith("/adaccounts/acc"):
        return {"adaccounts": [{"adaccount": {"currency": "SAR"}}]}
    if u.endswith("/campaigns"):
        return {"campaigns": [{"campaign": {"id": "c1", "name": "Camp", "status": "ACTIVE", "objective": "LEADS",
                                            "created_at": STAMP(-30), "start_time": STAMP(-30)}}]}
    if u.endswith("/adsquads"):
        return {"adsquads": [{"adsquad": {"id": "q1", "name": "Squad", "status": "ACTIVE", "campaign_id": "c1"}}]}
    if u.endswith("/ads"):
        return {"ads": [{"ad": {"id": f"a{i}", "name": f"Ad {i}", "status": st, "ad_squad_id": "q1", "creative_id": "cr",
                                **({"review_status": rv} if rv else {}), "created_at": STAMP(-30), "updated_at": STAMP(-30)}}
                        for i, (st, rv) in enumerate([("ACTIVE", "APPROVED"), ("ACTIVE", "REJECTED"), ("PAUSED", "APPROVED"), ("ACTIVE", None)])]}
    if "/stats" in u:
        return {"timeseries_stats": [{"timeseries_stat": {"breakdown_stats": {"ad": [
            {"id": "a0", "timeseries": [{"start_time": DAY + "T00:00:00.000+03:00", "stats": {"spend": 5_000_000, "impressions": 100, "swipes": 3}}]},
            {"id": "a2", "timeseries": [{"start_time": DAY + "T00:00:00.000+03:00", "stats": {"spend": 1_000_000, "impressions": 10, "swipes": 1}}]}]}}}],
                "total_stats": [{"total_stat": {"breakdown_stats": {"ad": []}}}]}
    raise AssertionError("unexpected " + url)


class SnapLiveUnchanged(unittest.TestCase):
    def run_snap(self, prev_ads=None):
        F.E.update({"SNAP_CLIENT_ID": "x", "SNAP_CLIENT_SECRET": "x", "SNAP_REFRESH_TOKEN": "x", "SNAP_AD_ACCOUNT_ID": "acc"})
        keep = (F.http, F.retry, F.CACHE, F.FROM, F.audience_due)
        F.http = lambda *a, **k: {"access_token": "t"}
        F.retry = lambda fn, url, **k: snap_api(url)
        F.CACHE = {k: {"thumb": "data:x", "media_type": "IMAGE", "format": "صورة", "preview_url": "https://cdn.example/p.jpg", "link": "https://cdn.example/p.jpg"} for k in ("sa0", "sa1", "sa2", "sa3")}
        F.FROM = F.TODAY - timedelta(days=2)
        F.audience_due = lambda *a, **k: False
        try:
            P = F.Plat(); F.snap(P)
        finally:
            F.http, F.retry, F.CACHE, F.FROM, F.audience_due = keep
        return P

    def test_snap_ads_survive_and_live_is_the_switch_only(self):
        P = self.run_snap()
        self.assertEqual({k: v["live"] for k, v in P.ads.items()}, {"sa0": True, "sa1": True, "sa2": False, "sa3": True})
        self.assertEqual(P.ads["sa1"]["delivery"], "rejected")        # rejected: still switched on, so live stays True
        self.assertEqual(P.ads["sa0"]["delivery"], "delivering")
        self.assertEqual(P.ads["sa2"]["delivery"], "off")
        self.assertEqual(P.ads["sa3"]["delivery"], "unknown")           # no review_status came back: not a guess
        self.assertEqual(P.ads["sa0"]["status"], "نشط")
        self.assertTrue(P.status_catalog)

    def test_nothing_flips_to_stopped_by_carry_forward(self):
        P = self.run_snap()
        prev = {k: {"live": True, "status": "نشط", "platform": "snap"} for k in ("sa0", "sa1", "sa3")}
        self.assertEqual(F.carry_forward(prev, P.ads, "s"), {}, "an ad that is in the fresh pull must never be carried forward as stopped")

    def test_invariant_spending_and_switched_on_is_live(self):
        """an ad that spent today and the platform says ACTIVE (ad, squad, campaign) must have live=true"""
        P = self.run_snap()
        spent_today = {r[0] for r in P.rows if r[1] == DAY}
        self.assertIn("sa0", spent_today)
        for key in spent_today:
            if key != "sa2":     # sa2 is PAUSED on the platform
                self.assertTrue(P.ads[key]["live"], key)

    def test_a_broken_delivery_layer_cannot_touch_live_or_drop_ads(self):
        import delivery
        keep = delivery.snap_state
        delivery.snap_state = lambda *a, **k: 1 / 0
        try:
            P = self.run_snap()
        finally:
            delivery.snap_state = keep
        self.assertEqual({k: v["live"] for k, v in P.ads.items()}, {"sa0": True, "sa1": True, "sa2": False, "sa3": True})
        self.assertEqual(P.ads["sa0"]["delivery"], "unknown")


class OtherPlatforms(unittest.TestCase):
    def test_tiktok_live_is_the_switch_for_every_secondary_status(self):
        from tiktok.fetch import _describe
        for st in ("AD_STATUS_DELIVERY_OK", "AD_STATUS_CAMPAIGN_EXCEED", "AD_STATUS_BUDGET_EXCEED", "AD_STATUS_AUDIT_DENY",
                   "AD_STATUS_SCHEDULE_NOT_START", "AD_STATUS_SCHEDULE_DONE", "AD_STATUS_AUDIT", "AD_STATUS_NOT_START", ""):
            item = {"ad_id": "1", "ad_name": "x", "campaign_id": "c", "adgroup_id": "g", "operation_status": "ENABLE", "secondary_status": st}
            out = _describe(item, {}, {"c": "ENABLE"}, {"g": "ENABLE"}, {"g": {"schedule_end_time": "2020-01-01 00:00:00"}})
            self.assertTrue(out["live"], st)
            self.assertIn(out["delivery"], ("delivering", "rejected", "in_review", "scheduled", "ended", "budget", "unknown"))
        off = _describe({"ad_id": "2", "operation_status": "DISABLE", "campaign_id": "c", "adgroup_id": "g"}, {}, {"c": "ENABLE"}, {"g": "ENABLE"})
        self.assertFalse(off["live"])

    def test_meta_live_and_google_live_unchanged_by_stamping(self):
        a = {"name": "n", "effective_status": "ACTIVE", "adset": {"name": "s", "effective_status": "ACTIVE", "optimization_goal": "X",
                                                                    "start_time": "2030-01-01T00:00:00+0300"},
             "campaign": {"name": "c", "effective_status": "ACTIVE"}, "creative": {}}
        import delivery
        self.assertEqual(delivery.meta_state(a, NOW)[0], "scheduled")   # scheduled, yet the switch says on
        self.assertEqual(F.google_delivery("ENABLED", "ENABLED", "ENABLED"), ("نشط", True))
        self.assertEqual(F.google_delivery("ENABLED", "PAUSED", "ENABLED"), ("متوقف", False))


if __name__ == "__main__":
    unittest.main()
