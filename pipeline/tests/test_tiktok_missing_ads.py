"""An ad that a complete TikTok pull no longer returns is a deleted ad: it must stop showing as active."""
import io, json, os, sys, tempfile, unittest
from contextlib import redirect_stdout
from unittest import mock
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tiktok import merge

AD = lambda i, status="AD_STATUS_DELIVERY_OK", op="ENABLE": {
    "ad_id": i, "ad_name": "Ad " + i, "campaign_name": "Camp", "adgroup_name": "Group", "advertiser_id": "700",
    "operation_status": op, "secondary_status": status, "campaign_operation_status": "ENABLE", "adgroup_operation_status": "ENABLE"}
PREV_AD = lambda name, live=True, status="نشط": {"platform": "tiktok", "name": name, "campaign": "Camp", "group": "Group", "format": "فيديو",
                                                  "status": status, "live": live, "text": "", "thumb": None, "link": None, "goal": "other"}


def run(prev_ads, items):
    d = tempfile.mkdtemp()
    out, ads, day = (os.path.join(d, n) for n in ("out.json", "ads.json", "day.json"))
    json.dump({"ads": prev_ads, "rows": [], "objectives": {}}, open(out, "w", encoding="utf-8"))
    json.dump({"list": items}, open(ads, "w", encoding="utf-8"))
    json.dump({"list": [], "page_info": {"total_page": 1}}, open(day, "w", encoding="utf-8"))
    env = {k: v for k, v in os.environ.items() if not k.startswith("TIKTOK_")}
    with mock.patch.dict(os.environ, env, clear=True), mock.patch.object(sys, "argv", ["merge", out, "--ads", ads, "--days", day]), redirect_stdout(io.StringIO()):
        merge.main()
    return json.load(open(out, encoding="utf-8"))["ads"]


class MissingAds(unittest.TestCase):
    def test_an_ad_missing_from_a_complete_pull_is_deleted_and_off(self):
        ads = run({"t1": PREV_AD("one"), "t2": PREV_AD("two")}, [AD("1")])
        self.assertTrue(ads["t1"]["live"])
        self.assertEqual((ads["t2"]["status"], ads["t2"]["live"]), ("محذوف", False))

    def test_an_empty_pull_never_wipes_the_ads(self):
        ads = run({"t1": PREV_AD("one")}, [])
        self.assertTrue(ads["t1"]["live"])
        self.assertEqual(ads["t1"]["status"], "نشط")

    def test_a_paused_ad_that_vanished_is_deleted_too(self):
        ads = run({"t3": PREV_AD("three", False, "متوقف"), "t4": PREV_AD("four", False, "محذوف")}, [AD("1")])
        self.assertEqual(ads["t3"]["status"], "محذوف")
        self.assertEqual(ads["t4"]["status"], "محذوف")


if __name__ == "__main__":
    unittest.main()
