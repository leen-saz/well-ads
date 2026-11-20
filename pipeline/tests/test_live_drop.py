"""الحارس: السحب اللي ينزّل الإعلانات المفعّلة أكثر من النصف ما يُنشر بدون سبب صريح. بيانات مختلقة."""
import os, sys, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from validate_dash import live_counts, live_drop


def dash(**n):
    ads = {}
    for p, c in n.items():
        for i in range(c[0]):
            ads[f"{p}{i}"] = {"live": True}
        for i in range(c[1]):
            ads[f"{p}x{i}"] = {"live": False}
    return {"ads": ads, "platforms": {"snap": {"ok": True}, "meta": {"ok": True}}}


class LiveDrop(unittest.TestCase):
    def test_counts(self):
        self.assertEqual(live_counts(dash(s=(3, 2), m=(4, 0))), {"s": 3, "m": 4, "*": 7})

    def test_one_platform_collapsing_is_caught(self):
        prev, now = dash(s=(18, 5), m=(45, 3)), dash(s=(0, 23), m=(45, 3))
        self.assertEqual(live_drop(now, prev), ["s"])

    def test_everything_collapsing_is_caught(self):
        self.assertEqual(sorted(live_drop(dash(s=(0, 20), m=(0, 50)), dash(s=(18, 5), m=(45, 3)))), ["*", "m", "s"])

    def test_normal_movement_passes(self):
        self.assertEqual(live_drop(dash(s=(10, 13), m=(40, 8)), dash(s=(18, 5), m=(45, 3))), [])
        self.assertEqual(live_drop(dash(s=(9, 9)), dash(s=(18, 0))), [])        # exactly half is not "more than half"

    def test_small_or_failed_platforms_are_ignored(self):
        self.assertEqual(live_drop(dash(s=(0, 4)), dash(s=(4, 0))), [])          # fewer than 5 before
        now = dash(s=(0, 20), m=(45, 0)); now["platforms"]["snap"] = {"ok": False}
        self.assertEqual(live_drop(now, dash(s=(18, 0), m=(45, 0))), [])          # a failed pull is judged by its previous ads, not here

    def test_no_previous_run(self):
        self.assertEqual(live_drop(dash(s=(0, 5)), None), [])


if __name__ == "__main__":
    unittest.main()
