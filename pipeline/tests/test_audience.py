"""تفاصيل المشاهدين من ردود واجهة مصغرة بنفس شكل الردود الحقيقية. لا شبكة."""
import os, sys, unittest
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import audience
from fetch_data import audience_due, keep_audience

RIYADH = timezone(timedelta(hours=3))
NOW = datetime(2026, 10, 31, tzinfo=RIYADH)
act = lambda acts, t: next((int(a["value"]) for a in acts or [] if a["action_type"] == t), 0)


class MetaTests(unittest.TestCase):
    def test_breakdowns_become_sorted_rows_in_riyals(self):
        rows = {
            "age,gender": [{"ad_id": "1", "age": "25-34", "gender": "female", "impressions": "100", "inline_link_clicks": "4", "spend": "2", "actions": [{"action_type": "lead", "value": "1"}]},
                           {"ad_id": "1", "age": "35-44", "gender": "female", "impressions": "300", "inline_link_clicks": "3", "spend": "4"}],
            "region": [{"ad_id": "1", "region": "Riyadh Region", "impressions": "400", "inline_link_clicks": "7", "spend": "6"}],
            "impression_device": [], "publisher_platform": [],
            "hourly_stats_aggregated_by_audience_time_zone": [{"ad_id": "1", "hourly_stats_aggregated_by_audience_time_zone": "21:00:00 - 21:59:59", "impressions": "50", "inline_link_clicks": "1", "spend": "1"}],
        }
        got = audience.meta({"META_AD_ACCOUNT_ID": "act_1"}, lambda p, **q: rows[q["breakdowns"]], act, 3.75, NOW)["1"]
        self.assertEqual(got["age"][0], ["35-44", 300, 3, 15.0, 0.0])          # الأكثر ظهور أول، والصرف بالريال
        self.assertEqual(got["gender"], [["female", 400, 7, 22.5, 1.0]])        # العمر والجنس من نفس الطلب
        self.assertEqual(got["hour"], [[21, 50, 1, 3.75, 0.0]])
        self.assertEqual(got["lvl"], "ad")


class SnapTests(unittest.TestCase):
    def test_dimensions_and_hours_with_no_leads(self):
        def g(path, **q):
            if q["granularity"] == "HOUR":
                return {"timeseries_stats": [{"timeseries_stat": {"breakdown_stats": {"ad": [{"id": "a", "timeseries": [
                    {"start_time": "2026-10-30T18:00:00.000-00:00", "stats": {"impressions": 9, "swipes": 1, "spend": 2000000}}]}]}}}]}
            stats = {"age": {"age_bucket": "25-34"}, "gender": {"gender": "female"}, "region": {"region": "sa/Riyadh"}, "os": {"operating_system": "ios"}}[q["report_dimension"]]
            return {"total_stats": [{"total_stat": {"breakdown_stats": {"ad": [{"id": "a", "dimension_stats": [{"impressions": 10, "swipes": 2, "spend": 5000000, **stats}]}]}}}]}
        got = audience.snap(g, ["c1"], NOW)["a"]
        self.assertEqual(got["region"], [["Riyadh", 10, 2, 5.0, None]])          # بدون "sa/"، والليدز None
        self.assertEqual(got["device"][0][0], "ios")
        self.assertEqual(got["hour"], [[21, 9, 1, 2.0, None]])                   # 18:00 UTC = 21:00 الرياض


class GoogleTests(unittest.TestCase):
    def test_group_level_dimensions_reach_every_ad_in_the_group(self):
        m = {"impressions": "10", "clicks": "2", "costMicros": "3000000", "conversions": 1}
        def q(query):
            if "FROM ad_group_ad" in query:
                return [{"adGroup": {"id": "g1"}, "adGroupAd": {"ad": {"id": "x"}}, "segments": {"device": "MOBILE"}, "metrics": m}]
            if "age_range_view" in query:
                return [{"adGroup": {"id": "g1"}, "adGroupCriterion": {"ageRange": {"type": "AGE_RANGE_25_34"}}, "metrics": m}]
            if "user_location_view" in query:
                return [{"adGroup": {"id": "g1"}, "segments": {"geoTargetRegion": "geoTargetConstants/20987"}, "metrics": m}]
            if "geo_target_constant" in query:
                return [{"geoTargetConstant": {"resourceName": "geoTargetConstants/20987", "name": "Riyadh Province"}}]
            return []
        got = audience.google(q, NOW)["x"]
        self.assertEqual(got["device"], [["mobile", 10, 2, 3.0, 1.0]])
        self.assertEqual(got["age"][0][0], "25-34")
        self.assertEqual(got["region"][0][0], "Riyadh Province")
        self.assertEqual(got["lvl"], "group")


class PlumbingTests(unittest.TestCase):
    def test_attach_covers_meta_placement_keys(self):
        ads = {"m1|instagram": {}, "m1|facebook": {}, "m2": {}, "s1": {}}
        self.assertEqual(audience.attach(ads, "m", {"1": {"age": [["25-34", 1, 0, 0, 0]], "lvl": "ad"}}), 2)
        self.assertIn("aud", ads["m1|facebook"]); self.assertNotIn("aud", ads["m2"])

    def test_refresh_every_six_hours_and_keep_last_copy(self):
        self.assertTrue(audience_due({}, NOW))
        self.assertFalse(audience_due({"aud_at": (NOW - timedelta(hours=2)).isoformat()}, NOW))
        self.assertTrue(audience_due({"aud_at": (NOW - timedelta(hours=7)).isoformat()}, NOW))
        ads = {"m1": {"name": "x"}}
        keep_audience({"m1": {"aud": {"lvl": "ad"}}}, ads)
        self.assertEqual(ads["m1"]["aud"], {"lvl": "ad"})


if __name__ == "__main__":
    unittest.main()
