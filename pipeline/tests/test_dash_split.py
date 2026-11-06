"""dash.json مقسوم: تفاصيل المشاهدين والعضوي في ملفاتها، وإذا رجعت تندمج يطلع نفس البيانات بالضبط."""
import os, sys, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from dash_split import split


class DashSplitTests(unittest.TestCase):
    data = {
        "range": {"start": "2026-10-01", "end": "2026-10-02"},
        "rows": [["a1", "2026-10-01", 1, 2, 3, 4, 5]],
        "ads": {"a1": {"name": "x", "aud": {"gender": [["male", 1, 2, 3, None]]}}, "a2": {"name": "y"}},
        "organic": {"facebook": [{"name": "Well"}]},
    }

    def test_moves_aud_and_organic_out(self):
        main, aud, organic = split(self.data)
        self.assertNotIn("organic", main)
        self.assertNotIn("aud", main["ads"]["a1"])
        self.assertEqual(aud, {"a1": {"gender": [["male", 1, 2, 3, None]]}})
        self.assertEqual(organic, {"facebook": [{"name": "Well"}]})
        self.assertEqual(main["extra"], ["aud", "organic"])

    def test_merging_back_gives_the_same_data(self):
        main, aud, organic = split(self.data)
        back = {k: v for k, v in main.items() if k != "extra"}
        back["ads"] = {k: ({**v, "aud": aud[k]} if k in aud else v) for k, v in main["ads"].items()}
        back["organic"] = organic
        self.assertEqual(back, self.data)

    def test_leaves_the_input_alone(self):
        split(self.data)
        self.assertIn("aud", self.data["ads"]["a1"])
        self.assertIn("organic", self.data)


if __name__ == "__main__":
    unittest.main()
