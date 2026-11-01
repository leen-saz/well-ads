import json, os, sys, unittest
from unittest import mock
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
sys.path.insert(0, ROOT)
from modules.targets import run as T


class Targets(unittest.TestCase):
    data = {"range": {"today": "2026-10-28"}, "ads": {"s1": {"goal": "lead"}, "m1": {"goal": "lead"}},
            "rows": [["s1", "2026-10-20", 100.0, 1, 1, 20.0, 0], ["m1", "2026-10-20", 90.0, 1, 1, 3.0, 0], ["s1", "2026-08-01", 999.0, 1, 1, 1.0, 0]]}

    def test_avg30_fallback(self):
        with mock.patch.object(T, "written", return_value={}):
            t = T.compute(self.data)
        self.assertEqual((t["snap"]["cpl"], t["snap"]["source"]), (5.0, "avg30"))
        self.assertEqual(t["meta"]["cpl"], 30.0)
        self.assertEqual(t["google"], {"cpl": None, "source": None, "chat": None, "chat_source": None})

    def test_written_wins(self):
        with mock.patch.object(T, "written", return_value={"snap": {"cpl": 4}}):
            t = T.compute(self.data)["snap"]
        self.assertEqual((t["cpl"], t["source"]), (4.0, "written"))

    def test_chat_target_from_messages_ads(self):
        data = {"range": {"today": "2026-10-28"}, "ads": {"m2": {"goal": "messages"}},
                "rows": [["m2", "2026-10-20", 120.0, 1, 1, 0.0, 12], ["m2", "2026-10-21", 80.0, 1, 1, 0.0, 8]]}
        with mock.patch.object(T, "written", return_value={}):
            t = T.compute(data)["meta"]
        self.assertEqual((t["chat"], t["chat_source"], t["cpl"]), (10.0, "avg30", None))


if __name__ == "__main__":
    unittest.main()
