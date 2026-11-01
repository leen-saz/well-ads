"""قواعد الأقسام، تقسيم المنصات، العضوي المعلّق، وإخفاء الفوترة."""
import json, os, re, subprocess, sys, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from channels import google_platform, meta_key
from media import label_unsplit_google, media_kind
from classify import classify_pair
from organic import collect_organic, metric_day, pending_shell

FIXTURE = os.path.join(ROOT, "tests", "fixtures", "prototype_slim.json")
WIN = ("2026-09-14", "2026-10-11")
EXPECTED = {
    "iv": (25863.75, 1945),
    "midwife": (4387.27, 426),
    "foot": (2907.88, 339),
    "renan": (706.01, 0),
    "brand": (1818.76, 0),
}


class ClassifyTests(unittest.TestCase):
    def test_ad_name_beats_campaign(self):
        self.assertEqual(classify_pair("V| HAIR TONIC", r"META_WP_IV_8\10"), ("iv", "campaign"))
        self.assertEqual(classify_pair("قابلة وِل", "IV campaign"), ("midwife", "ad"))
        self.assertEqual(classify_pair("IMG| Foot Alignment", "IV campaign"), ("foot", "ad"))
        self.assertEqual(classify_pair("Retargeting", "Brand"), ("brand", "ad"))
        self.assertEqual(classify_pair("محاليل وريدية في منزلك", "Competitor"), ("iv", "ad"))
        self.assertEqual(classify_pair("no signal", "nope"), ("brand", "default"))

    def test_hair_vitality_joins_iv(self):
        self.assertEqual(classify_pair("Hair-Vitality serum", "awareness"), ("iv", "ad"))
        self.assertEqual(classify_pair("حيوية الشعر", "brand"), ("iv", "ad"))
        self.assertEqual(classify_pair("V| HAIR TONIC", r"META_WP_IV_8\10"), ("iv", "campaign"))
        self.assertNotEqual(classify_pair("giveaway vitality", "nope")[0], "iv")
        self.assertNotIn("hair", json.load(open(os.path.join(ROOT, "config", "departments.json"), encoding="utf-8"))["departments"])

    def test_prototype_window(self):
        data = json.load(open(FIXTURE, encoding="utf-8"))
        totals = {k: [0.0, 0.0] for k in EXPECTED}
        for ad in data["ads"].values():
            dept, src = classify_pair(ad["name"], ad["campaign"])
            self.assertEqual((dept, src), (ad["dept"], ad["dsrc"]))
            self.assertNotEqual(dept, "hair")
        for key, day, spend, leads in data["rows"]:
            if not (WIN[0] <= day <= WIN[1]):
                continue
            dept = data["ads"][key]["dept"]
            totals[dept][0] += spend
            totals[dept][1] += leads
        for dept, (spend, leads) in EXPECTED.items():
            self.assertAlmostEqual(totals[dept][0], spend, places=2)
            self.assertAlmostEqual(totals[dept][1], leads, places=2)


class ChannelTests(unittest.TestCase):
    def test_google(self):
        self.assertEqual(google_platform("SEARCH"), "google_search")
        self.assertEqual(google_platform("PERFORMANCE_MAX"), "google_pmax")
        self.assertEqual(google_platform("VIDEO"), "google_video")
        self.assertEqual(google_platform("DEMAND_GEN"), "google_demand_gen")
        self.assertEqual(google_platform("DISCOVERY"), "google_demand_gen")
        self.assertEqual(google_platform("DISPLAY"), "google_display")
        self.assertEqual(google_platform("MULTI_CHANNEL", "APP_CAMPAIGN"), "google_app")

    def test_meta_key(self):
        self.assertEqual(meta_key("1", "instagram"), ("m1|instagram", "instagram"))
        self.assertEqual(meta_key("1", "facebook"), ("m1|facebook", "facebook"))

    def test_search_campaign_without_channel_becomes_search(self):
        ad = {"platform": "google", "campaign": "SRCH | Well Services | KSA", "name": "مغذي"}
        label_unsplit_google(ad)
        self.assertEqual(ad["platform"], "google_search")
        kept = {"platform": "google_pmax", "campaign": "SRCH leftover", "name": "x"}
        label_unsplit_google(kept)
        self.assertEqual(kept["platform"], "google_pmax")

    def test_media_kind(self):
        self.assertEqual(media_kind({"thumb": "data:image/jpeg;base64,aa"}), "image")
        self.assertEqual(media_kind({"link": "https://www.tiktok.com/embed/v2/123"}), "video")
        self.assertEqual(media_kind({"thumb": None, "link": None}), "none")


class OrganicTests(unittest.TestCase):
    def test_metric_day(self):
        self.assertEqual(metric_day("2026-09-15T07:00:00+0000"), "2026-09-14")

    def test_pending_without_token_lists_needs(self):
        def boom(*_a, **_k):
            raise AssertionError("organic must not call the network without a token")
        org = collect_organic({}, "2026-09-14", "2026-10-11", transport=boom)
        blob = json.dumps(org, ensure_ascii=False)
        for needle in (
            "pages_read_engagement", "pages_read_user_content", "pages_show_list", "read_insights",
            "instagram_manage_insights", "instagram_basic",
            "Well Care.", "wellcare.sa",
            "GA4_PROPERTY_ID", "GA4_SERVICE_ACCOUNT_JSON",
        ):
            self.assertIn(needle, blob)
        self.assertNotIn("Well Home Care", blob)
        self.assertNotIn("Well Women Health", blob)
        self.assertEqual([p["name"] for p in org["facebook"]], ["Well Care."])
        self.assertTrue(all(p["status"] == "pending" for p in org["facebook"]))
        self.assertEqual(org["ga4"]["status"], "pending")
        self.assertEqual(org["tiktok"]["status"], "pending")
        self.assertEqual(len(pending_shell()["facebook"]), 1)

    def test_insights_permission_keeps_profile_and_media(self):
        import urllib.parse
        from organic import collect_organic
        denied = 'HTTP 400: {"error":{"message":"(#10) Application does not have permission","code":10}}'
        posts_denied = 'HTTP 400: {"error":{"message":"(#200) Requires pages_read_user_content","code":200}}'
        seen = []

        def transport(url, data=None, headers=None, method=None, timeout=None):
            seen.append(url.split("?", 1)[0])
            if method == "POST":
                return [{"code": 400, "body": '{"error":{"message":"(#10) Application does not have permission","code":10}}'}]
            path = urllib.parse.urlparse(url).path
            qs = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
            token = (qs.get("access_token") or [""])[0]
            if path.endswith("/me/accounts"):
                return {"data": [{
                    "id": "111", "name": "Well Care.", "access_token": "PAGE",
                    "instagram_business_account": {"id": "17841423912575723", "username": "wellcare.sa"},
                }]}
            if path.endswith("/111/insights"):
                raise RuntimeError(denied)
            if path.endswith("/111/posts") or path.endswith("/111/feed"):
                raise RuntimeError(posts_denied)
            if path.endswith("/111"):
                self.assertEqual(token, "PAGE")
                return {"name": "Well Care.", "followers_count": 1500, "fan_count": 1500}
            if path.endswith("/17841423912575723/insights"):
                raise RuntimeError(denied)
            if path.endswith("/17841423912575723/media"):
                self.assertEqual(token, "PAGE")
                return {"data": [{
                    "id": "m1", "caption": "عناية في البيت", "media_type": "IMAGE",
                    "permalink": "https://www.instagram.com/p/abc/",
                    "media_url": "data:image/jpeg;base64,aaa",
                    "thumbnail_url": "data:image/jpeg;base64,aaa",
                    "timestamp": "2026-10-10T12:00:00+0000",
                    "like_count": 4, "comments_count": 1,
                }]}
            if path.endswith("/17841423912575723"):
                self.assertEqual(token, "PAGE")
                return {"username": "wellcare.sa", "followers_count": 334, "media_count": 37}
            raise RuntimeError("unexpected " + path)

        org = collect_organic({"META_ACCESS_TOKEN": "USER"}, "2026-09-14", "2026-10-11", transport=transport)
        self.assertEqual([p["name"] for p in org["facebook"]], ["Well Care."])
        care = org["facebook"][0]
        self.assertEqual(care["followers"], 1500)
        self.assertEqual(care["posts"], [])
        self.assertEqual(care["insights"], "pending")
        self.assertEqual(care["posts_status"], "pending")
        self.assertEqual(care["status"], "partial")
        ig = org["instagram"][0]
        self.assertEqual(ig["followers"], 334)
        self.assertEqual(ig["status"], "partial")
        self.assertEqual(ig["insights"], "pending")
        self.assertEqual(ig["posts_status"], "ok")
        self.assertEqual(len(ig["posts"]), 1)
        post = ig["posts"][0]
        self.assertEqual(post["caption"], "عناية في البيت")
        self.assertEqual(post["permalink"], "https://www.instagram.com/p/abc/")
        self.assertEqual(post["likes"], 4)
        self.assertEqual(post["comments"], 1)
        self.assertEqual(post["type"], "صورة")
        self.assertEqual(post["insights"], "pending")
        self.assertIsNone(post["views"])
        self.assertEqual(post["date"], "2026-10-10")
        self.assertEqual(ig.get("days") or [], [])
        self.assertIsNone(ig.get("period"))
        self.assertTrue(any(u.endswith("/17841423912575723/media") for u in seen))

    def test_well_care_empty_body_is_awaiting_permission(self):
        import urllib.parse
        from organic import collect_organic

        def transport(url, data=None, headers=None, method=None, timeout=None):
            path = urllib.parse.urlparse(url).path
            if path.endswith("/me/accounts"):
                return {"data": [{"id": "111", "name": "Well Care.", "access_token": "PAGE"}]}
            if path.endswith("/111/insights") or path.endswith("/111/posts") or path.endswith("/111/feed"):
                return {"data": []}
            if path.endswith("/111"):
                return {"name": "Well Care.", "followers_count": 33, "fan_count": 33}
            raise RuntimeError("unexpected " + path)

        org = collect_organic({"META_ACCESS_TOKEN": "USER"}, "2026-10-06", "2026-10-13", transport=transport)
        care = org["facebook"][0]
        self.assertEqual(care["name"], "Well Care.")
        self.assertEqual(care["followers"], 33)
        self.assertEqual(care["posts"], [])
        self.assertEqual(care["days"], [])
        self.assertEqual(care["insights"], "pending")
        self.assertEqual(care["posts_status"], "pending")
        self.assertEqual(care["status"], "partial")
        self.assertEqual([p["name"] for p in org["facebook"]], ["Well Care."])

    def test_thumb_does_not_fetch_without_url(self):
        from organic import _embed_thumb
        self.assertIsNone(_embed_thumb(None))
        self.assertIsNone(_embed_thumb("https://example.com/v.mp4"))
        self.assertEqual(_embed_thumb("data:image/jpeg;base64,aaa"), "data:image/jpeg;base64,aaa")


class BillingTests(unittest.TestCase):
    def test_template_has_no_billing_copy(self):
        html = open(os.path.join(ROOT, "template.html"), encoding="utf-8").read()
        for phrase in (
            "زيدي الرصيد", "رصيد الحساب", "سددي من", "Billing",
            "account_status", "disable_reason", "شحن الرصيد", "PENDING_BILLING",
        ):
            self.assertNotIn(phrase, html)
        self.assertIn("رصيد|سداد|مستحق|شحن", html)
        self.assertIn('id="mode"', html)
        self.assertIn(">الإعلانات</button>", html)
        self.assertIn(">فعّال</button>", html)
        self.assertIn("ui('فعّال','Active')", html)
        self.assertIn("ui('متوقف','Paused')", html)
        self.assertNotIn("شغال الآن", html)
        self.assertIn("preset:'7'", html)
        self.assertIn("well-ads-ui", html)
        self.assertIn("لوحة أداء الإعلانات", html)
        self.assertIn('id="funnel"', html)
        self.assertIn('id="tCamp"', html)
        self.assertIn('id="cards"', html)
        self.assertNotIn("runGraphWrite", html)
        self.assertNotIn("smart_plus_ad_status_update", html)
        self.assertIn(">العضوي</button>", html)
        self.assertIn("mode=organic", html)
        self.assertIn("function usableLink", html)
        self.assertIn("adsapi\\.snapchat\\.com", html)
        self.assertIn('data-media="frame"', html)
        self.assertIn("media-src https:", open(os.path.join(ROOT, "build.py"), encoding="utf-8").read())
        self.assertIn("wallCard", html)
        for piece in ('id="ocards"', 'id="oq"', 'id="osort"', 'id="omore"', "فتح المنشور", "بانتظار بيانات المنشورات"):
            self.assertIn(piece, html)
        self.assertNotIn('href="/organic/"', html)
        self.assertIn("HIDDEN_PLAT", html)
        self.assertIn("audience_network", html)
        self.assertIn("meta_whatsapp", html)
        self.assertIn("HIDDEN_DEPT", html)
        self.assertNotIn("عبر Claude", html)
        self.assertNotIn("آخر سحب", html)
        self.assertNotIn("console.info(", html)   # ما فيه رسايل داخلية في الكونسول (#38)
        self.assertNotIn("`<li>${esc(n)}</li>`", html)
        self.assertIn('id="lang"', html)
        self.assertIn("well-ads-lang", html)
        self.assertIn("IV Drips", html)
        self.assertIn("Midwifery / Maternity", html)
        self.assertIn("Foot Alignment", html)
        self.assertIn("Renan Child Health", html)
        self.assertIn("يحتاج توكن ميتا بصلاحيات المحتوى", html)
        self.assertIn("Needs a Meta token with content permissions", html)
        self.assertNotIn("أبرز الملاحظات", html)
        self.assertNotIn('id="insights"', html)
        self.assertNotIn("ملاحظات العضوي", html)
        self.assertNotIn("اسم الإعلان أولاً", html)
        self.assertNotIn("Ad name first", html)
        self.assertIn("المنشورات في الفترة", html)
        self.assertNotIn(">منشورات في الفترة<", html)
        self.assertIn(".dbar-row{grid-template-columns:minmax(0,1fr);gap:4px}", html)
        self.assertIn("select{width:100%}", html)
        self.assertIn("--bad:#221196", html)   # بدون ألوان برا الهوية (Palette v2.1)
        self.assertIn("alignDelivery", html)
        self.assertNotIn("applySnapDelivery", html)
        self.assertNotIn("SPENT_LAST", html)
        self.assertNotIn("#120b3f", html)
        self.assertNotIn("prefers-color-scheme:dark", html)
        self.assertIn("ليدز ومحادثات", html)
        self.assertIn("cost per result", html)
        self.assertIn("leads and chats", html)
        self.assertIn("metricText", html)
        self.assertIn("بانتظار الصلاحية", html)
        self.assertIn("Awaiting permission", html)
        self.assertIn("6948010864247046146", html)
        self.assertIn("spring rose0406", html)
        self.assertIn("زهرة الربيع", html)
        self.assertIn("function careBlocked", html)
        self.assertIn("page.name==='Well Care.'", html)
        self.assertIn("ORG_FB_HIDDEN", html)
        self.assertIn("Well Home Care", html)
        self.assertIn("Well Women Health", html)

    def test_build_strips_balance_and_billing_status(self):
        data_path = os.path.join(ROOT, "data.json")
        previous = open(data_path, encoding="utf-8").read() if os.path.exists(data_path) else None
        try:
            payload = {
                "generated_at": "2026-10-12T09:07+03:00",
                "schema": 2,
                "range": {"start": "2026-09-14", "end": "2026-10-11", "today": "2026-10-12"},
                "goals": {"lead": "ليدز"},
                "platforms": {"meta": {"ok": True, "balance": "99991.25", "disable_reason": 3, "account_status": 2, "currency": "USD"}},
                "ads": {"m1": {
                    "name": "قابلة وِل", "campaign": "x", "platform": "facebook", "goal": "lead",
                    "status": "رصيد الحساب مستحق PENDING_BILLING_INFO", "group": "", "text": "", "live": False,
                }},
                "rows": [["m1", "2026-10-01", 10, 0, 0, 1, 0]],
            }
            json.dump(payload, open(data_path, "w", encoding="utf-8"))
            subprocess.check_call([sys.executable, os.path.join(ROOT, "build.py")], cwd=ROOT)
            page = open(os.path.join(ROOT, "web", "public", "index.html"), encoding="utf-8").read()
            organic = open(os.path.join(ROOT, "web", "public", "organic", "index.html"), encoding="utf-8").read()
            vercel = json.load(open(os.path.join(ROOT, "web", "vercel.json"), encoding="utf-8"))
            self.assertNotIn("99991.25", page)
            self.assertNotIn("disable_reason", page)
            self.assertNotIn("account_status", page)
            self.assertNotIn("PENDING_BILLING", page)
            self.assertNotIn("رصيد الحساب", page)
            self.assertIn("القبالة", page)
            self.assertIn("pages_read_engagement", page)
            self.assertIn('id="ocards"', page)
            self.assertIn('id="mode"', page)
            self.assertIn("?mode=organic", organic)
            self.assertNotIn("pages_read_engagement", organic)
            self.assertNotIn("99991.25", organic)
            self.assertNotIn("قابلة وِل", organic)
            dests = [r.get("destination") for r in vercel.get("redirects") or []]
            self.assertIn("/?mode=organic", dests)
        finally:
            if previous is None:
                if os.path.exists(data_path):
                    os.remove(data_path)
            else:
                open(data_path, "w", encoding="utf-8").write(previous)


class SpringRoseTests(unittest.TestCase):
    def test_account_and_named_ads_drop_out_of_spend(self):
        from tiktok.merge import is_spring_rose_account, without_spring_rose
        self.assertTrue(is_spring_rose_account("6948010864247046146", "Spring Rose0406"))
        self.assertTrue(is_spring_rose_account("", "شركة زهرة الربيع"))
        self.assertFalse(is_spring_rose_account("7532842350553514000", "Well"))
        blob = {
            "ads": {
                "t1": {"platform": "tiktok", "name": "Rose install", "campaign": "SR | iOS14 | AppInstall", "group": "", "text": ""},
                "t2": {"platform": "tiktok", "name": "Well lead", "campaign": r"Tiktok_Leads_WELL_iv_20\8", "group": "", "text": ""},
                "m1": {"platform": "facebook", "name": "قابلة", "campaign": "IV", "group": "", "text": ""},
            },
            "rows": [
                ["t1", "2026-10-01", 12.5, 10, 1, 0, 0],
                ["t2", "2026-10-01", 4, 10, 1, 1, 0],
                ["m1", "2026-10-01", 9, 10, 1, 1, 0],
            ],
        }
        out = without_spring_rose(blob)
        self.assertEqual(set(out["ads"]), {"t2", "m1"})
        self.assertEqual([r[0] for r in out["rows"]], ["t2", "m1"])
        self.assertAlmostEqual(sum(r[2] for r in out["rows"]), 13.0)
        whole = without_spring_rose({
            "advertiser_id": "6948010864247046146",
            "advertiser_name": "Spring Rose0406",
            "ads": {"t9": {"platform": "tiktok", "name": "plain", "campaign": "purchase", "group": "", "text": ""}},
            "rows": [["t9", "2026-10-01", 99, 1, 0, 0, 0]],
        })
        self.assertEqual(whole["ads"], {})
        self.assertEqual(whole["rows"], [])

    def test_merge_keeps_well_and_skips_spring_rose_pull(self):
        import tempfile
        rose_ads = {"data": {"list": [{
            "ad_id": "9", "advertiser_id": "6948010864247046146", "advertiser_name": "Spring Rose0406",
            "ad_name": "install", "campaign_name": "ZR_ND96_TT_iOS_Purchase", "adgroup_name": "g",
            "operation_status": "ENABLE", "secondary_status": "AD_STATUS_DELIVERY_OK", "ad_text": "زهرة الربيع",
        }]}}
        days = {"data": {"page_info": {"total_page": 1}, "list": [{
            "dimensions": {"ad_id": "9", "stat_time_day": "2026-10-01 00:00:00"},
            "metrics": {"spend": "50.00", "impressions": "100", "clicks": "3", "conversion": "1"},
        }]}}
        prev = {
            "ads": {"t2": {"platform": "tiktok", "name": "Well lead", "campaign": "Tiktok_Leads_WELL", "group": "", "text": "", "live": False}},
            "rows": [["t2", "2026-09-01", 10, 5, 1, 0, 0]],
            "objectives": {},
        }
        with tempfile.TemporaryDirectory() as tmp:
            ads_path = os.path.join(tmp, "ads.json")
            days_path = os.path.join(tmp, "days.json")
            out_path = os.path.join(tmp, "tiktok.json")
            json.dump(rose_ads, open(ads_path, "w", encoding="utf-8"))
            json.dump(days, open(days_path, "w", encoding="utf-8"))
            json.dump(prev, open(out_path, "w", encoding="utf-8"))
            subprocess.check_call([sys.executable, os.path.join(ROOT, "tiktok", "merge.py"), out_path, "--ads", ads_path, "--days", days_path])
            got = json.load(open(out_path, encoding="utf-8"))
        self.assertEqual(set(got["ads"]), {"t2"})
        self.assertEqual(got["rows"], [["t2", "2026-09-01", 10, 5, 1, 0, 0]])
        self.assertAlmostEqual(sum(r[2] for r in got["rows"]), 10.0)


class DeliveryTests(unittest.TestCase):
    def test_google_is_live_only_when_every_level_is_enabled(self):
        from fetch_data import google_delivery
        self.assertEqual(google_delivery("ENABLED", "ENABLED", "ENABLED"), ("نشط", True))
        self.assertEqual(google_delivery("ENABLED", "PAUSED", "ENABLED"), ("متوقف", False))
        self.assertEqual(google_delivery("PAUSED", "ENABLED", "ENABLED"), ("متوقف", False))

    def test_meta_preview_prefers_a_public_post(self):
        from fetch_data import meta_preview
        creative = {
            "instagram_permalink_url": "https://www.instagram.com/p/abc/",
            "effective_object_story_id": "1_2",
            "image_url": "https://cdn.example/a.jpg",
        }
        self.assertEqual(meta_preview(creative, "https://cdn.example/a.mp4"), "https://www.instagram.com/p/abc/")
        self.assertEqual(meta_preview({"effective_object_story_id": "9_8"}), "https://www.facebook.com/9_8")
        self.assertEqual(meta_preview({}, "https://cdn.example/a.mp4"), "https://cdn.example/a.mp4")
        self.assertIsNone(meta_preview({}))

    def test_missing_live_ad_becomes_paused_after_a_status_pull(self):
        from fetch_data import carry_forward
        prev = {
            "m1": {"live": True, "status": "نشط", "name": "كان نشط"},
            "m2": {"live": False, "status": "المجموعة متوقفة", "name": "متوقف"},
            "g1": {"live": True, "status": "نشط"},
        }
        out = carry_forward(prev, {"m9": {"live": True, "status": "نشط"}}, "m")
        self.assertFalse(out["m1"]["live"])
        self.assertEqual(out["m1"]["status"], "متوقف")
        self.assertEqual(out["m1"]["name"], "كان نشط")
        self.assertEqual(out["m2"]["status"], "المجموعة متوقفة")
        self.assertNotIn("g1", out)
        self.assertNotIn("m9", out)

    def test_recent_window_needs_existing_history(self):
        from fetch_data import choose_history, configure_window
        recent, start, range_start = configure_window(None, 3)
        self.assertEqual((recent, start, range_start), (0, None, None))
        prev = {"schema": 3, "range": {"start": "2026-05-01"}, "generated_at": "2026-10-18T01:00+03:00"}
        recent, start, range_start = configure_window(prev, 3)
        self.assertEqual(recent, 3)
        self.assertEqual(range_start, "2026-05-01")
        older = {"schema": 3, "generated_at": "2026-10-17T01:00+03:00", "ads": {"m1": {}}, "rows": []}
        chosen, has_rows, file_newer = choose_history(
            {"generated_at": "2026-10-18T02:00+03:00", "ads": {"m1": {}}},
            older,
        )
        self.assertTrue(has_rows)
        self.assertTrue(file_newer)
        self.assertEqual(chosen["generated_at"], "2026-10-18T02:00+03:00")
        empty, has_rows, file_newer = choose_history({"ads": {}}, None)
        self.assertFalse(has_rows)
        self.assertFalse(file_newer)


class PreviewTests(unittest.TestCase):
    def test_pick_preview_skips_snap_api_links(self):
        from media import pick_preview
        self.assertEqual(
            pick_preview({"preview_url": "https://www.instagram.com/reel/abc/", "link": "https://adsapi.snapchat.com/v1/x"}),
            "https://www.instagram.com/reel/abc/",
        )
        self.assertIsNone(pick_preview({"preview_url": "https://adsapi.snapchat.com/v1/media/preview", "link": "https://adsapi.snapchat.com/v1/x"}))
        self.assertEqual(pick_preview({"video": "https://cdn.example/ad.mp4"}), "https://cdn.example/ad.mp4")
        self.assertEqual(pick_preview({"image_url": "https://cdn.example/ad.jpg"}), "https://cdn.example/ad.jpg")

    def test_dashboard_has_paused_filter_and_creative_button(self):
        html = open(os.path.join(ROOT, "template.html"), encoding="utf-8").read()
        self.assertIn('id="stat"', html)
        self.assertIn('data-v="off"', html)
        self.assertIn("function passesStatus", html)
        self.assertIn("function applyStat", html)
        self.assertIn("عرض الكرييتف", html)
        self.assertIn("function openCreative", html)
        self.assertIn("preview_url", html)
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", html)


class SupabaseStoreTests(unittest.TestCase):
    def setUp(self):
        self._url = os.environ.get("SUPABASE_URL")
        self._key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        os.environ["SUPABASE_URL"] = "https://example.supabase.co"
        os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "test-service-key"

    def tearDown(self):
        if self._url is None:
            os.environ.pop("SUPABASE_URL", None)
        else:
            os.environ["SUPABASE_URL"] = self._url
        if self._key is None:
            os.environ.pop("SUPABASE_SERVICE_ROLE_KEY", None)
        else:
            os.environ["SUPABASE_SERVICE_ROLE_KEY"] = self._key

    def test_round_trip_keeps_old_days_and_replaces_the_window(self):
        from supabase_store import load_bundle, save_bundle
        api = _MemoryApi()
        data = {
            "generated_at": "2026-10-18T10:00+03:00",
            "schema": 3,
            "range": {"start": "2026-05-01", "end": "2026-10-17", "today": "2026-10-18"},
            "goals": {"lead": "ليدز"},
            "ads": {"m1": {
                "platform": "facebook", "name": "قابلة", "campaign": "IV", "group": "g",
                "status": "نشط", "live": True, "goal": "lead",
                "preview_url": "https://www.instagram.com/p/abc/",
                "thumb": "data:image/jpeg;base64,aa",
            }},
            "rows": [
                ["m1", "2026-10-01", 10, 100, 4, 1, 0],
                ["m1", "2026-10-17", 5, 20, 1, 0, 2],
            ],
            "organic": {"facebook": []},
        }
        save_bundle(data, full=True, transport=api)
        got = load_bundle(transport=api)
        self.assertEqual(got["ads"]["m1"]["preview_url"], "https://www.instagram.com/p/abc/")
        self.assertEqual(got["ads"]["m1"]["thumb"], "data:image/jpeg;base64,aa")
        self.assertTrue(got["ads"]["m1"]["live"])
        self.assertEqual(got["organic"], {"facebook": []})
        self.assertEqual(sorted(r[1] for r in got["rows"]), ["2026-10-01", "2026-10-17"])
        paused = json.loads(json.dumps(data))
        paused["ads"]["m1"]["live"] = False
        paused["ads"]["m1"]["status"] = "متوقف"
        paused["rows"] = [
            ["m1", "2026-10-01", 10, 100, 4, 1, 0],
            ["m1", "2026-10-17", 9, 30, 2, 1, 0],
        ]
        save_bundle(paused, recent_from="2026-10-16", ok_prefixes=["m"], full=False, transport=api)
        got = load_bundle(transport=api)
        by_day = {r[1]: r for r in got["rows"]}
        self.assertEqual(by_day["2026-10-01"][2], 10)
        self.assertEqual(by_day["2026-10-17"][2], 9)
        self.assertFalse(got["ads"]["m1"]["live"])
        self.assertEqual(got["ads"]["m1"]["status"], "متوقف")
        self.assertTrue(any(call[0] == "DELETE" and "like.m*" in call[1] for call in api.calls))
        self.assertTrue(all("test-service-key" not in call[1] for call in api.calls))


class _MemoryApi:
    def __init__(self):
        self.tables = {"ads": {}, "ad_metrics": {}, "dashboard_state": {}}
        self.calls = []

    def __call__(self, method, url, data, headers):
        from urllib.parse import parse_qs, urlparse
        self.calls.append((method, url))
        self.assert_key = headers.get("apikey")
        if self.assert_key != "test-service-key":
            raise AssertionError("service key header missing")
        parsed = urlparse(url)
        table = parsed.path.rstrip("/").split("/")[-1]
        qs = parse_qs(parsed.query, keep_blank_values=True)
        body = json.loads(data.decode()) if data else None
        if method == "GET":
            if table == "dashboard_state":
                row = self.tables["dashboard_state"].get(1)
                return [row] if row else []
            rows = list(self.tables[table].values())
            rng = headers.get("Range")
            if rng:
                start, end = (int(x) for x in rng.split("-"))
                rows = rows[start:end + 1]
            return rows
        if method == "POST":
            for row in body:
                if table == "ads":
                    self.tables["ads"][row["ad_key"]] = row
                elif table == "ad_metrics":
                    self.tables["ad_metrics"][(row["ad_key"], row["day"])] = row
                else:
                    self.tables["dashboard_state"][row["id"]] = row
            return None
        if method == "DELETE":
            if qs.get("ad_key") == ["not.is.null"]:
                self.tables["ad_metrics"].clear()
                return None
            raw = qs.get("ad_key", [""])[0]
            prefix = raw.split(".", 1)[1].rstrip("*") if "." in raw else ""
            start = end = None
            for item in qs.get("day", []):
                if item.startswith("gte."):
                    start = item.split(".", 1)[1]
                if item.startswith("lte."):
                    end = item.split(".", 1)[1]
            for key in list(self.tables["ad_metrics"]):
                ad_key, day = key
                if ad_key.startswith(prefix) and start <= day <= end:
                    del self.tables["ad_metrics"][key]
            return None
        raise AssertionError(method)


class DateAccuracyTests(unittest.TestCase):
    def test_riyadh_day_keeps_late_evening_on_the_next_calendar_day(self):
        from organic import _riyadh_unix, _unix, riyadh_day
        self.assertEqual(riyadh_day("2026-10-17T22:00:00+0000"), "2026-10-18")
        self.assertEqual(riyadh_day("2026-10-17T20:00:00+0000"), "2026-10-17")
        self.assertEqual(riyadh_day("2026-10-18T00:30:00+0300"), "2026-10-18")
        self.assertEqual(riyadh_day("2026-10-18"), "2026-10-18")
        self.assertIsNone(riyadh_day(""))
        self.assertEqual(metric_day("2026-09-15T07:00:00+0000"), "2026-09-14")
        self.assertEqual(_riyadh_unix("2026-10-15") - _unix("2026-10-15"), -3 * 3600)

    def test_ig_user_days_stay_separate_from_the_window_total(self):
        from datetime import datetime
        from organic import RIYADH, fetch_ig_user_days

        def payload(reach, views, engaged):
            return {"data": [
                {"name": "reach", "total_value": {"value": reach}},
                {"name": "views", "total_value": {"value": views}},
                {"name": "accounts_engaged", "total_value": {"value": engaged}},
            ]}

        class Graph:
            def __init__(self, fail_day=None):
                self.fail_day = fail_day
                self.calls = []

            def get(self, path, **q):
                self.calls.append(q)
                since, until = int(q["since"]), int(q["until"])
                if self.fail_day and until - since <= 86400:
                    day = datetime.fromtimestamp(since, RIYADH).strftime("%Y-%m-%d")
                    if day == self.fail_day:
                        raise RuntimeError("HTTP 500 temporary")
                if until - since > 86400:
                    return payload(15, 100, 4)
                return payload(10, 3, 2)

        graph = Graph()
        mapped, totals, bad = fetch_ig_user_days(graph, "ig", "2026-10-15", "2026-10-16")
        self.assertEqual(bad, [])
        self.assertEqual(totals, {"reach": 15, "views": 100, "accounts_engaged": 4})
        self.assertEqual(mapped["2026-10-15"]["reach"], 10)
        self.assertEqual(mapped["2026-10-16"]["reach"], 10)
        self.assertNotEqual(totals["reach"], mapped["2026-10-15"]["reach"] + mapped["2026-10-16"]["reach"])
        self.assertEqual(len(graph.calls), 3)

        skipped = Graph(fail_day="2026-10-16")
        mapped, totals, _bad = fetch_ig_user_days(skipped, "ig", "2026-10-15", "2026-10-16")
        self.assertEqual(set(mapped), {"2026-10-15"})
        self.assertNotIn("2026-10-16", mapped)
        self.assertEqual(totals["reach"], 15)

        class Denied:
            def get(self, path, **q):
                raise RuntimeError("(#10) Application does not have permission")

        with self.assertRaises(RuntimeError):
            fetch_ig_user_days(Denied(), "ig", "2026-10-15", "2026-10-15")

    def test_ig_drops_an_invalid_metric_instead_of_failing_the_day(self):
        from organic import fetch_ig_user_days

        class Graph:
            def __init__(self):
                self.metrics = []

            def get(self, path, **q):
                self.metrics.append(q["metric"])
                if "views" in q["metric"]:
                    raise RuntimeError("(#100) metric views is not valid")
                return {"data": [{"name": "reach", "total_value": {"value": 6}}]}

        graph = Graph()
        mapped, totals, bad = fetch_ig_user_days(graph, "ig", "2026-10-16", "2026-10-16", metrics=("reach", "views"))
        self.assertEqual(bad, ["views"])
        self.assertEqual(totals.get("reach"), 6)
        self.assertNotIn("views", totals)
        self.assertEqual(mapped["2026-10-16"]["reach"], 6)
        self.assertTrue(all("views" not in m for m in graph.metrics[1:]))

    def test_post_timestamp_uses_the_riyadh_calendar_day(self):
        import urllib.parse
        from organic import _riyadh_unix, _unix, collect_organic
        seen = []

        def transport(url, data=None, headers=None, method=None, timeout=None):
            seen.append(url)
            path = urllib.parse.urlparse(url).path
            if path.endswith("/me/accounts"):
                return {"data": [{
                    "id": "111", "name": "Well Care.", "access_token": "PAGE",
                    "instagram_business_account": {"id": "ig1", "username": "wellcare.sa"},
                }]}
            if path.endswith("/111"):
                return {"name": "Well Care.", "followers_count": 10, "fan_count": 10}
            if path.endswith("/111/insights") or path.endswith("/ig1/insights"):
                return {"data": []}
            if path.endswith("/111/posts"):
                return {"data": [{
                    "id": "p1", "message": "بعد منتصف الليل",
                    "created_time": "2026-10-17T22:00:00+0000",
                    "permalink_url": "https://www.facebook.com/p/1",
                    "status_type": "added_photos",
                }]}
            if path.endswith("/111/feed"):
                return {"data": []}
            if path.endswith("/ig1"):
                return {"username": "wellcare.sa", "followers_count": 10}
            if path.endswith("/ig1/media"):
                return {"data": [{
                    "id": "m1", "caption": "منشور", "media_type": "IMAGE",
                    "permalink": "https://www.instagram.com/p/abc/",
                    "timestamp": "2026-10-17T21:30:00+0000",
                    "like_count": 1, "comments_count": 0,
                }]}
            if method == "POST":
                raise RuntimeError("batch")
            raise RuntimeError("unexpected " + path)

        org = collect_organic({"META_ACCESS_TOKEN": "USER"}, "2026-10-15", "2026-10-16", transport=transport)
        self.assertEqual(org["facebook"][0]["posts"][0]["date"], "2026-10-18")
        self.assertEqual(org["instagram"][0]["posts"][0]["date"], "2026-10-18")
        post_url = next(u for u in seen if u.split("?", 1)[0].endswith("/111/posts"))
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(post_url).query)
        self.assertEqual(qs["since"][0], str(_riyadh_unix("2026-10-15")))
        self.assertEqual(qs["until"][0], str(_riyadh_unix("2026-10-17")))
        self.assertNotEqual(qs["since"][0], str(_unix("2026-10-15")))

    def test_tiktok_coverage_ends_at_the_file_not_today(self):
        from fetch_data import tiktok_coverage_end
        self.assertEqual(tiktok_coverage_end("2026-10-12T12:38+03:00", ["2026-10-11"]), "2026-10-12")
        self.assertEqual(tiktok_coverage_end("2026-10-12T12:38+03:00", ["2026-10-11", "2026-10-13"]), "2026-10-13")
        self.assertEqual(tiktok_coverage_end("", ["2026-10-11"]), "2026-10-11")
        self.assertEqual(tiktok_coverage_end("not-a-date", []), "")

    def test_template_keeps_the_date_accuracy_guards(self):
        html = open(os.path.join(ROOT, "template.html"), encoding="utf-8").read()
        for piece in (
            "leadN", "function uniqueOf", "function holesBetween", "function coverEnd",
            "prevKnown", "function periodMatch", "بيانات ناقصة", "coverage_end",
        ):
            self.assertIn(piece, html)
        self.assertIn("audience_network", html)
        self.assertIn("meta_whatsapp", html)
        self.assertNotIn("عبر Claude", html)


if __name__ == "__main__":
    unittest.main()
