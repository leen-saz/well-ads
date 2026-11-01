"""مقاييس الفيديو في fetch_data.vid_doc. لا شبكة."""
import os, sys, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from fetch_data import vid_doc


class VidDocTests(unittest.TestCase):
    def test_counts_and_average(self):
        self.assertEqual(vid_doc("1000", 300, ["200", 150, 120, 90], 90, 4.26),
                         {"i": 1000, "v": 300, "q": [200, 150, 120, 90], "c": 90, "t": 4.3})

    def test_no_views_is_none(self):
        self.assertIsNone(vid_doc(1000, 0, [0, 0, 0, 0], 0))
        self.assertIsNone(vid_doc(1000, None, [], None))

    def test_missing_average_left_out(self):
        self.assertNotIn("t", vid_doc(10, 5, [1, 1, 1, 1], 1, 0))


if __name__ == "__main__":
    unittest.main()
