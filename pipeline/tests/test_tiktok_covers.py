"""أغلفة إعلانات تيك توك في merge.py. لا شبكة: التحميل مستبدل."""
import json, os, subprocess, sys, tempfile, unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import organic
from tiktok import merge

IMG = "data:image/jpeg;base64,AAAA"


def _write(folder, name, blob):
    path = os.path.join(folder, name)
    json.dump(blob, open(path, "w", encoding="utf-8"))
    return path


class CoverTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.items = [
            {"ad_id": "1", "ad_name": "video ad", "video_id": "v1", "operation_status": "ENABLE", "secondary_status": "AD_STATUS_DELIVERY_OK"},
            {"ad_id": "2", "ad_name": "image ad", "image_ids": ["i9"], "operation_status": "DISABLE"},
            {"ad_id": "3", "ad_name": "no cover", "video_id": "v3", "operation_status": "DISABLE"},
        ]

    def test_cover_urls_maps_video_image_and_direct(self):
        videos = _write(self.dir, "v.json", {"code": 0, "data": {"list": [{"video_id": "v1", "video_cover_url": "https://x/v1.jpg"}]}})
        images = _write(self.dir, "i.json", {"list": [{"image_id": "i9", "image_url": "https://x/i9.jpg"}]})
        direct = _write(self.dir, "d.json", {"3": "https://x/direct.jpg"})
        got = merge.cover_urls([videos, images, direct], self.items)
        self.assertEqual(got, {"1": "https://x/v1.jpg", "2": "https://x/i9.jpg", "3": "https://x/direct.jpg"})

    def test_merge_embeds_new_covers_and_keeps_old_ones(self):
        out = _write(self.dir, "tiktok.json", {"ads": {"t3": {"thumb": IMG + "old"}}, "rows": []})
        ads = _write(self.dir, "ads.json", {"code": 0, "data": {"list": self.items}})
        days = _write(self.dir, "days.json", {"list": [], "page_info": {"total_page": 1}})
        covers = _write(self.dir, "c.json", {"list": [{"video_id": "v1", "poster_url": "https://x/v1.jpg"}]})
        argv = ["merge.py", out, "--ads", ads, "--days", days, "--covers", covers]
        with mock.patch.object(organic, "_embed_thumb", lambda url: IMG + url[-6:]), mock.patch.object(sys, "argv", argv):
            merge.main()
        got = json.load(open(out, encoding="utf-8"))["ads"]
        self.assertEqual(got["t1"]["thumb"], IMG + "v1.jpg")
        self.assertIsNone(got["t2"]["thumb"])
        self.assertEqual(got["t3"]["thumb"], IMG + "old")

    def test_script_runs_from_repo_root(self):
        out = subprocess.run([sys.executable, "tiktok/merge.py", "--help"], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(out.returncode, 0, out.stderr)
        self.assertIn("--covers", out.stdout)


if __name__ == "__main__":
    unittest.main()
