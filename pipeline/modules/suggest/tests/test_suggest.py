"""قواعد الاقتراح على سيناريوهات اصطناعية: لكل قاعدة حالة نجاح وحالة رفض (عيّنة صغيرة، أيام تشغيل قليلة، منصة مستثناة).
أرقام وهمية بالكامل. لا شبكة ولا Supabase."""
import os, sys, unittest
from datetime import date, timedelta
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
sys.path.insert(0, ROOT)
from modules.core import rules
from modules.suggest import run as S
from modules.targets import run as T

TODAY = date(2026, 11, 10)


def day(n):
    """اليوم قبل TODAY بـ n أيام."""
    return (TODAY - timedelta(days=n)).isoformat()


def ad(goal="lead", **kw):
    return {"live": True, "goal": goal, "name": "اختبار", "campaign": "حملة اختبار", **kw}


def build(ads, rows, written=None):
    data = {"ads": ads, "rows": rows, "range": {"today": TODAY.isoformat()}}
    with mock.patch.object(T, "written", return_value=written if written is not None else {"meta": {"cpl": 10, "chat": 10}, "snap": {"cpl": 10}, "tiktok": {"cpl": 10}}):
        return S.build(data, TODAY.isoformat())


def kinds(found):
    return sorted(s["kind"] for s in found)


class Pause(unittest.TestCase):
    def test_pause_zero_leads_double_target(self):
        found = build({"m1": ad()}, [["m1", day(i), 5.0, 100, 2, 0, 0] for i in range(1, 6)])
        self.assertEqual(kinds(found), ["pause"])

    def test_no_pause_below_double_target(self):
        found = build({"m1": ad()}, [["m1", day(i), 3.0, 100, 2, 0, 0] for i in range(1, 6)])
        self.assertEqual(found, [])

    def test_no_pause_when_running_under_min_days(self):
        # الصرف كله خلال يومين: أقل من MIN_DAYS_BEFORE_PAUSE
        found = build({"m1": ad()}, [["m1", day(1), 15.0, 100, 2, 0, 0], ["m1", day(2), 15.0, 100, 2, 0, 0]])
        self.assertEqual(found, [])

    def test_no_pause_when_it_has_leads(self):
        found = build({"m1": ad()}, [["m1", day(i), 5.0, 100, 2, 1 if i == 1 else 0, 0] for i in range(1, 6)])
        self.assertEqual(found, [])

    def test_whatsapp_destination_judged_on_clicks(self):
        ads = {"t1": ad(dest="whatsapp")}
        no_clicks = build(ads, [["t1", day(i), 5.0, 100, 0, 0, 0] for i in range(1, 6)])
        self.assertEqual(kinds(no_clicks), ["pause"])
        self.assertEqual(no_clicks[0]["evidence"]["metric"], "clicks")
        with_clicks = build(ads, [["t1", day(i), 5.0, 100, 3, 0, 0] for i in range(1, 6)])
        self.assertEqual(with_clicks, [])

    def test_not_live_ad_gets_no_suggestion(self):
        found = build({"m1": ad(live=False)}, [["m1", day(i), 5.0, 100, 2, 0, 0] for i in range(1, 6)])
        self.assertEqual(found, [])


class BudgetUp(unittest.TestCase):
    def rows(self, key, leads_per_day, spend=4.0):
        return [[key, day(i), spend, 100, 5, leads_per_day, 0] for i in range(1, 8)]

    def test_budget_up_needs_ten_leads(self):
        # 7 أيام * 1 ليد = 7: عيّنة صغيرة
        self.assertEqual(build({"m1": ad()}, self.rows("m1", 1)), [])
        # 7 أيام * 2 ليد = 14 بتكلفة أقل من 80% من الهدف
        found = build({"m1": ad()}, self.rows("m1", 2))
        self.assertEqual(kinds(found), ["budget_up"])
        self.assertEqual(found[0]["params"]["pct"], rules.MAX_BUDGET_CHANGE_PCT)

    def test_no_budget_up_when_cpl_near_target(self):
        self.assertEqual(build({"m1": ad()}, self.rows("m1", 2, spend=18.0)), [])

    def test_snap_never_gets_budget_up(self):
        self.assertEqual(build({"s1": ad()}, self.rows("s1", 2)), [])

    def test_messages_budget_up_needs_ten_chats(self):
        mk = lambda per: [["m2", day(i), 4.0, 100, 5, 0, per] for i in range(1, 8)]
        self.assertEqual(build({"m2": ad("messages")}, mk(1)), [])
        self.assertEqual(kinds(build({"m2": ad("messages")}, mk(2))), ["budget_up"])


class Others(unittest.TestCase):
    def test_traffic_campaign_pause(self):
        found = build({"m1": ad("traffic")}, [["m1", day(1), 5.0, 100, 2, 0, 0]])
        self.assertEqual(kinds(found), ["pause_campaign"])

    def test_refresh_creative_needs_enough_impressions(self):
        def rows(im):
            return [["m1", day(14 - i), 1.0, im, c, 0, 0] for i, c in enumerate([10] * 7 + [3] * 7)]
        self.assertEqual(kinds(build({"m1": ad()}, rows(200))), ["refresh_creative"])
        # أقل من 1000 ظهور في النافذة: ما نحكم بتعب المادة
        self.assertEqual(build({"m1": ad()}, rows(100)), [])


class Contract(unittest.TestCase):
    """كل اقتراح: القاعدة والدليل والثقة (digest) وخطة قياس وتراجع، ويعدّي فحص قواعد لين."""

    def all_found(self):
        ads = {"m1": ad(), "m2": ad(), "m3": ad("traffic", campaign="حملة ترافيك")}
        rows = [["m1", day(i), 5.0, 100, 2, 0, 0] for i in range(1, 6)]
        rows += [["m2", day(i), 4.0, 100, 5, 2, 0] for i in range(1, 8)]
        rows += [["m3", day(1), 5.0, 100, 2, 0, 0]]
        return build(ads, rows)

    def test_required_fields_and_rules_check(self):
        found = self.all_found()
        self.assertEqual(kinds(found), ["budget_up", "pause", "pause_campaign"])
        for s in found:
            self.assertTrue(s["reason"] and s["evidence"] and s["digest"] and s["measure_plan"] and s["reversal_plan"], s["kind"])
            self.assertTrue(s["evidence"].get("days"), s["kind"])
            self.assertEqual(rules.check(s, TODAY.isoformat()), [], s["kind"])
            self.assertEqual(s["requested_by"], "rule:suggest")

    def test_digest_changes_with_content(self):
        s = dict(self.all_found()[0])
        d0 = S.digest(s)
        s["after"] = {"status": "something-else"}
        self.assertNotEqual(d0, S.digest(s))


if __name__ == "__main__":
    unittest.main()
