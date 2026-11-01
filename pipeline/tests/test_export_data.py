import json, os, sys, tempfile, unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import export_data  # noqa: E402


def fake_transport(calls):
    def transport(method, url, data, headers):
        calls.append((method, url))
        if "/ads?" in url:
            return [{"ad_key": "m1", "platform": "meta", "status": "active", "live": True,
                     "doc": {"name": "A", "platform": "meta"}}]
        if "/ad_metrics?" in url:
            return [{"ad_key": "m1", "day": "2026-10-30", "spend": 10, "impressions": 100,
                     "clicks": 5, "leads": 1, "conversations": 0}]
        if "/dashboard_state?" in url:
            return [{"id": 1, "doc": {"generated_at": "2026-10-31T10:00+03:00", "schema": 3}}]
        raise AssertionError("unexpected " + url)
    return transport


class ExportTests(unittest.TestCase):
    def setUp(self):
        self.env = mock.patch.dict(os.environ, {"SUPABASE_URL": "https://x.supabase.co",
                                                "SUPABASE_SERVICE_ROLE_KEY": "k"})
        self.env.start()

    def tearDown(self):
        self.env.stop()

    def test_writes_full_bundle_and_only_reads(self):
        calls = []
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "data.json")
            export_data.export(out, transport=fake_transport(calls))
            data = json.load(open(out, encoding="utf-8"))
        self.assertEqual(data["generated_at"], "2026-10-31T10:00+03:00")
        self.assertEqual(data["ads"]["m1"]["name"], "A")
        self.assertEqual(data["rows"], [["m1", "2026-10-30", 10.0, 100, 5, 1.0, 0]])
        self.assertEqual({m for m, _ in calls}, {"GET"})

    def test_inline_thumbs_become_files(self):
        png = "data:image/png;base64,iVBORw0KGgo="

        def transport(method, url, data, headers):
            if "/ads?" in url:
                return [{"ad_key": "m1", "platform": "meta", "live": True, "doc": {"thumb": png}},
                        {"ad_key": "m2", "platform": "meta", "live": True, "doc": {"thumb": "https://x/y.jpg"}}]
            if "/ad_metrics?" in url:
                return [{"ad_key": "m1", "day": "2026-10-30"}]
            return [{"id": 1, "doc": {"organic": {"instagram": [{"posts": [{"thumb": png}]}]}}}]

        with tempfile.TemporaryDirectory() as tmp:
            thumbs = os.path.join(tmp, "thumbs")
            data = export_data.export(os.path.join(tmp, "data.json"), transport=transport, thumbs_dir=thumbs)
            files = os.listdir(thumbs)
        self.assertEqual(len(files), 1)
        self.assertTrue(files[0].endswith(".png"))
        self.assertEqual(data["ads"]["m1"]["thumb"], "/thumbs/" + files[0])
        self.assertEqual(data["ads"]["m2"]["thumb"], "https://x/y.jpg")
        self.assertEqual(data["organic"]["instagram"][0]["posts"][0]["thumb"], "/thumbs/" + files[0])

    def test_empty_database_fails(self):
        def empty(method, url, data, headers):
            return []
        with tempfile.TemporaryDirectory() as tmp, self.assertRaises(RuntimeError):
            export_data.export(os.path.join(tmp, "data.json"), transport=empty)

    def test_normalize_url(self):
        for raw in ("https://x.supabase.co", "https://x.supabase.co/", "https://x.supabase.co/rest/v1",
                    "https://x.supabase.co/rest/v1/", " https://x.supabase.co "):
            self.assertEqual(export_data.normalize_url(raw), "https://x.supabase.co")


if __name__ == "__main__":
    unittest.main()
