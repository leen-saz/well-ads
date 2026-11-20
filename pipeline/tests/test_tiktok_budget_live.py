"""تيك توك: إعلان مفعّل وصل حد الصرف (AD_STATUS_*_EXCEED) يبقى live=true وdelivery=budget، ما يصير off. بيانات مختلقة بأسماء القيم الحقيقية.
المسارين: Marketing API (حالة الحملة والمجموعة معروفة) والموصّل/ad_get (غير معروفة، نستنتج من secondary_status)."""
import os, sys, unittest
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from tiktok.fetch import _describe
from tiktok.merge import tiktok_live
import delivery

CASES = [  # secondary_status, live, delivery
    ("AD_STATUS_DELIVERY_OK", True, "delivering"),
    ("AD_STATUS_CAMPAIGN_EXCEED", True, "budget"),
    ("AD_STATUS_BUDGET_EXCEED", True, "budget"),
    ("AD_STATUS_AUDIT", True, "in_review"),
    ("AD_STATUS_REAUDIT", True, "in_review"),
    ("AD_STATUS_AUDIT_DENY", True, "rejected"),
    ("AD_STATUS_SCHEDULE_NOT_START", True, "scheduled"),
    ("AD_STATUS_SCHEDULE_DONE", True, "ended"),
    ("AD_STATUS_ADGROUP_DISABLE", False, "off"),
    ("AD_STATUS_CAMPAIGN_DISABLE", False, "off"),
    ("AD_STATUS_DISABLE", False, "off"),
    ("AD_STATUS_DELETE", False, "off"),
]


def item(st, op="ENABLE"):
    return {"ad_id": "1", "ad_name": "x", "campaign_id": "c", "adgroup_id": "g", "operation_status": op, "secondary_status": st}


class TikTokBudgetLive(unittest.TestCase):
    def test_connector_path_without_campaign_and_group_status(self):
        for st, live, want in CASES:
            self.assertEqual(tiktok_live(item(st)), live, st)
            out = _describe(item(st), {}, {}, {})
            self.assertEqual((out["live"], out["delivery"]), (live, want), st)

    def test_api_path_with_campaign_and_group_status(self):
        for st, _live, want in CASES:
            on = not st.endswith("_DISABLE") and "DELETE" not in st
            out = _describe(item(st), {}, {"c": "ENABLE" if on else "DISABLE"}, {"g": "ENABLE" if on else "DISABLE"})
            self.assertEqual(out["live"], on, st)
            self.assertEqual(out["delivery"], want, st)

    def test_exceeded_budget_reads_as_switched_on_not_off(self):
        out = _describe(item("AD_STATUS_CAMPAIGN_EXCEED"), {}, {}, {})
        self.assertTrue(out["live"]); self.assertEqual(out["delivery_reason"], delivery.REASON["budget"])

    def test_invariant_spend_today_and_operation_enable_is_never_off(self):
        for st, _live, _want in CASES:
            if st.endswith("_DISABLE") or "DELETE" in st:
                continue                              # a disabled ancestor or a deleted ad is off for real
            for camp, grp in ((None, None), ("ENABLE", "ENABLE")):
                out = _describe(item(st), {}, {"c": camp} if camp else {}, {"g": grp} if grp else {})
                self.assertNotEqual(out["delivery"], "off", (st, camp))
                self.assertTrue(out["live"], (st, camp))

    def test_unknown_status_without_ancestors_stays_off_and_unknown(self):
        out = _describe(item("AD_STATUS_SOMETHING_NEW"), {}, {}, {})
        self.assertFalse(out["live"]); self.assertEqual(out["delivery"], "unknown")   # live False: the old rule; the verdict is not guessed
        ads = {"t1": out}; delivery.finalize(ads, [], datetime.now(delivery.RIYADH))
        self.assertEqual(ads["t1"]["delivery"], "off")                                # not switched on, so the final verdict is off

    def test_operation_disable_is_off(self):
        out = _describe(item("AD_STATUS_DELIVERY_OK", op="DISABLE"), {}, {"c": "ENABLE"}, {"g": "ENABLE"})
        ads = {"t1": out}; delivery.finalize(ads, [], datetime.now(delivery.RIYADH))
        self.assertEqual((ads["t1"]["live"], ads["t1"]["delivery"]), (False, "off"))


if __name__ == "__main__":
    unittest.main()
