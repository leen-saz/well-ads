"""سحب تيك توك من ردود واجهة محفوظة. لا شبكة ولا توكن حقيقي."""
import contextlib, io, json, os, sys, unittest, urllib.parse
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from common import env
from fetch_data import USD_SAR as META_USD_SAR, carry_forward
from tiktok.fetch import (
    USD_SAR, api_coverage_end, file_coverage_end, ingest_tiktok, pull, secrets_ready, spend_sar,
)

FIXTURE = json.load(open(os.path.join(ROOT, "tests", "fixtures", "tiktok_api.json"), encoding="utf-8"))
TOKEN = "super-secret-token-value"
WELL = "7532842350553514000"
ROSE = "6948010864247046146"
RIYADH = timezone(timedelta(hours=3))
NOW = datetime(2026, 10, 18, 21, 5, tzinfo=RIYADH)
START = datetime(2026, 10, 1, tzinfo=RIYADH)
END = datetime(2026, 10, 18, tzinfo=RIYADH)


def _env(ids=None):
    return {
        "TIKTOK_ACCESS_TOKEN": TOKEN,
        "TIKTOK_ADVERTISER_IDS": ids if ids is not None else f"{WELL}, {ROSE}",
    }


class FixtureTransport:
    def __init__(self, info=None, report_pages=None, fail_metrics=0):
        self.info = info or FIXTURE["advertiser_info"]
        self.report_pages = report_pages or {
            "1": FIXTURE["report_page_1"],
            "2": FIXTURE["report_page_2"],
        }
        self.fail_metrics = fail_metrics
        self.urls = []
        self.report_metrics = []

    def __call__(self, url, data=None, headers=None, method=None, timeout=None):
        if (headers or {}).get("Access-Token") != TOKEN:
            raise AssertionError("Access-Token header missing")
        if TOKEN in url or ROSE in url:
            raise AssertionError("token or excluded advertiser leaked into the URL")
        self.urls.append(url)
        path = url.split("?", 1)[0]
        query = url.split("?", 1)[1] if "?" in url else ""
        if path.endswith("/advertiser/info/"):
            return self.info
        if path.endswith("/campaign/get/"):
            return FIXTURE["campaigns"]
        if path.endswith("/adgroup/get/"):
            return FIXTURE["adgroups"]
        if path.endswith("/ad/get/"):
            return FIXTURE["ads"]
        if path.endswith("/report/integrated/get/"):
            self.report_metrics.append(query)
            if self.fail_metrics:
                self.fail_metrics -= 1
                return FIXTURE["metric_error"]
            page = "1"
            for part in query.split("&"):
                if part.startswith("page="):
                    page = part.split("=", 1)[1]
            return self.report_pages.get(page) or self.report_pages["1"]
        raise AssertionError("unexpected " + path)


def _rows_by_day(rows):
    return {(r[0], r[1]): r for r in rows}


class PullTests(unittest.TestCase):
    def test_same_dollar_rate_as_meta(self):
        self.assertEqual(USD_SAR, META_USD_SAR)
        self.assertEqual(spend_sar("50.29", "SAR"), 50.29)
        self.assertEqual(spend_sar("10.00", "usd"), 37.5)
        with self.assertRaises(RuntimeError):
            spend_sar("10", "EUR")
        with self.assertRaises(RuntimeError):
            spend_sar("10", "")

    def test_fixture_report_becomes_riyadh_rows_without_the_excluded_account(self):
        transport = FixtureTransport()
        ads, rows = pull(_env(), START, END, transport)
        blob = json.dumps({"ads": ads, "rows": rows}, ensure_ascii=False)
        self.assertNotIn(TOKEN, blob)
        self.assertNotIn(ROSE, blob)
        self.assertTrue(all(ROSE not in url and TOKEN not in url for url in transport.urls))
        self.assertTrue(any("data_level=AUCTION_AD" in url and "stat_time_day" in url for url in transport.urls))
        self.assertTrue(any("STATUS_ALL" in url for url in transport.urls))
        by = _rows_by_day(rows)
        live = by[("t1878109843378193", "2026-10-17")]
        self.assertEqual(live[2:], [50.29, 17367, 86, 2.0, 3])
        talks = by[("t1878109843378193", "2026-10-15")]
        self.assertEqual(talks[6], 4)
        self.assertNotIn(("t1878109843378193", "2026-10-18"), by)
        self.assertNotIn(("t9", "2026-10-17"), by)
        self.assertEqual(by[("t555", "2026-10-16")][3:5], [10, 1])
        deleted = by[("t777", "2026-10-17")]
        self.assertEqual(deleted[2], 3.5)
        self.assertEqual(deleted[5], 0.5)
        self.assertNotIn("2026-10-13", {r[1] for r in rows})
        lead = ads["t1878109843378193"]
        self.assertEqual(lead["name"], "Well lead video")
        self.assertEqual(lead["campaign"], "Tiktok_Leads_WELL_iv")
        self.assertEqual(lead["group"], "Female2")
        self.assertEqual(lead["link"], "https://www.tiktok.com/embed/v2/7692055113619442965")
        self.assertTrue(lead["live"])
        self.assertEqual(lead["status"], "نشط")
        self.assertEqual(lead["goal"], "lead")
        self.assertEqual(lead["format"], "فيديو")
        self.assertEqual(lead["family"], "tiktok")
        paused = ads["t555"]
        self.assertFalse(paused["live"])
        self.assertEqual(paused["status"], "المجموعة متوقفة")
        parent_off = ads["t556"]
        self.assertFalse(parent_off["live"])
        self.assertEqual(parent_off["status"], "متوقف")
        self.assertNotIn("t9", ads)
        self.assertEqual(ads["t777"]["name"], "Deleted creative")
        self.assertEqual(ads["t777"]["status"], "محذوف")
        self.assertFalse(ads["t777"]["live"])
        self.assertEqual(ads["t777"]["goal"], "lead")
        self.assertAlmostEqual(sum(r[2] for r in rows), 53.79)

    def test_usd_spend_uses_the_meta_rate_and_unknown_currency_writes_nothing(self):
        usd = FixtureTransport(
            info=FIXTURE["usd_advertiser_info"],
            report_pages={"1": FIXTURE["usd_report"]},
        )
        _ads, rows = pull(_env(WELL), START, END, usd)
        self.assertEqual(rows, [["t1878109843378193", "2026-10-17", 37.5, 100, 4, 1.0, 0]])
        eur = FixtureTransport(info=FIXTURE["eur_advertiser_info"])
        with self.assertRaises(RuntimeError):
            pull(_env(WELL), START, END, eur)
        self.assertFalse(any("/report/" in url for url in eur.urls))

    def test_named_spring_rose_account_is_not_reported(self):
        transport = FixtureTransport(info=FIXTURE["rose_named_advertiser_info"])
        with self.assertRaises(RuntimeError):
            pull(_env(WELL), START, END, transport)
        self.assertFalse(any("/report/" in url or "/ad/get/" in url for url in transport.urls))

    def test_rejected_optional_metrics_retry_with_core_fields(self):
        transport = FixtureTransport(fail_metrics=1)
        ads, rows = pull(_env(WELL), START, END, transport)
        self.assertGreaterEqual(len(transport.report_metrics), 2)
        self.assertIn("messaging_total_conversation", transport.report_metrics[0])
        self.assertNotIn("messaging_total_conversation", transport.report_metrics[1])
        self.assertIn("spend", transport.report_metrics[1])
        self.assertEqual(_rows_by_day(rows)[("t1878109843378193", "2026-10-17")][2], 50.29)
        self.assertTrue(ads["t1878109843378193"]["live"])

    def test_stat_time_day_windows_stay_within_thirty_days(self):
        seen = []

        def transport(url, data=None, headers=None, method=None, timeout=None):
            self.assertEqual((headers or {}).get("Access-Token"), TOKEN)
            if "/report/integrated/get/" in url:
                qs = dict(part.split("=", 1) for part in url.split("?", 1)[1].split("&"))
                seen.append((qs["start_date"], qs["end_date"]))
                return {"code": 0, "data": {"list": [], "page_info": {"total_page": 1}}}
            if "/advertiser/info/" in url:
                return FIXTURE["advertiser_info"]
            return {"code": 0, "data": {"list": [], "page_info": {"total_page": 1}}}

        pull(_env(WELL), datetime(2026, 9, 1, tzinfo=RIYADH), END, transport)
        self.assertEqual(seen, [("2026-09-01", "2026-09-30"), ("2026-10-01", "2026-10-18")])
        for start, end in seen:
            span = datetime.strptime(end, "%Y-%m-%d") - datetime.strptime(start, "%Y-%m-%d")
            self.assertLessEqual(span.days + 1, 30)


class CoverageTests(unittest.TestCase):
    def test_gap_does_not_extend_coverage_and_a_touching_history_does(self):
        self.assertEqual(api_coverage_end("2026-10-15", "2026-10-18", ["2026-10-12"], False), "2026-10-12")
        self.assertEqual(api_coverage_end("2026-10-15", "2026-10-18", ["2026-10-14"], False), "2026-10-18")
        self.assertEqual(api_coverage_end("2026-05-31", "2026-10-18", [], True), "2026-10-18")
        self.assertEqual(file_coverage_end("2026-10-12T12:38+03:00", ["2026-10-11"]), "2026-10-12")
        self.assertEqual(file_coverage_end("2026-10-10T12:38+03:00", ["2026-10-12"]), "2026-10-12")


class IngestTests(unittest.TestCase):
    def _carry(self, prev_ads, fresh):
        return carry_forward(prev_ads, fresh, "t")

    def _run(self, env, prev, path, transport, recent=3, start=None):
        buf = io.StringIO()
        with contextlib.redirect_stderr(buf):
            got = ingest_tiktok(
                env, prev, recent, start or datetime(2026, 10, 15, tzinfo=RIYADH), END,
                "2026-10-18", path, transport, NOW, self._carry,
            )
        self.assertNotIn(TOKEN, buf.getvalue())
        self.assertNotIn(TOKEN, json.dumps(got["status"], ensure_ascii=False))
        return got, buf.getvalue()

    def test_recent_window_keeps_older_days_and_skips_the_gap(self):
        prev = {
            "ads": {
                "tOLD": {"platform": "tiktok", "family": "tiktok", "name": "قديم", "campaign": "Tiktok_Leads_WELL", "live": True, "status": "نشط"},
                "tKEEP": {"platform": "tiktok", "family": "tiktok", "name": "متوقف سابقاً", "campaign": "Tiktok_Leads_WELL", "live": False, "status": "المجموعة متوقفة"},
            },
            "rows": [
                ["tOLD", "2026-09-01", 7, 5, 1, 0, 0],
                ["tOLD", "2026-10-12", 2, 3, 1, 0, 0],
                ["tOLD", "2026-10-14", 1, 1, 0, 0, 0],
            ],
        }
        got, _log = self._run(_env(), prev, os.path.join(ROOT, "missing-tiktok.json"), FixtureTransport())
        self.assertFalse(got["pending"])
        self.assertEqual(got["status"]["source"], "api")
        self.assertTrue(got["status"]["ok"])
        self.assertEqual(got["status"]["synced_at"], "2026-10-18T21:05+03:00")
        self.assertEqual(got["status"]["coverage_end"], "2026-10-18")
        days = {r[1] for r in got["rows"]}
        self.assertIn("2026-09-01", days)
        self.assertIn("2026-10-17", days)
        self.assertNotIn("2026-10-13", days)
        self.assertFalse(any(r[2] == 0 and r[3] == 0 and r[4] == 0 and r[5] == 0 and r[6] == 0 for r in got["rows"]))
        self.assertFalse(got["ads"]["tOLD"]["live"])
        self.assertEqual(got["ads"]["tOLD"]["status"], "متوقف")
        self.assertEqual(got["ads"]["tKEEP"]["status"], "المجموعة متوقفة")

    def test_branch_backfills_only_days_before_the_api_window(self):
        import tempfile
        prev = {
            "ads": {"tNEW": {"platform": "tiktok", "name": "داخل النافذة", "live": False, "status": "متوقف"}},
            "rows": [["tNEW", "2026-10-16", 1, 1, 0, 0, 0]],
        }
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "tiktok.json")
            with open(path, "w", encoding="utf-8") as handle:
                json.dump({
                    "generated_at": "2026-10-12T12:38+03:00",
                    "ads": {"t2": {"platform": "tiktok", "name": "Well lead", "campaign": "Tiktok_Leads_WELL", "group": "g"}},
                    "rows": [
                        ["t2", "2026-09-01", 10, 5, 1, 0, 0],
                        ["t2", "2026-10-16", 99, 9, 1, 0, 0],
                    ],
                }, handle)
            got, _log = self._run(_env(), prev, path, FixtureTransport())
        marked = {(r[0], r[1], r[2]) for r in got["rows"]}
        self.assertIn(("t2", "2026-09-01", 10), marked)
        self.assertNotIn(("t2", "2026-10-16", 99), marked)
        self.assertTrue(any(r[0] == "t1878109843378193" and r[1] == "2026-10-17" and r[2] == 50.29 for r in got["rows"]))
        self.assertEqual(got["status"]["source"], "api")
        self.assertNotIn("2026-10-13", {r[1] for r in got["rows"]})

    def test_gap_before_the_window_keeps_coverage_on_the_old_day(self):
        prev = {
            "ads": {"tOLD": {"platform": "tiktok", "name": "قديم", "live": False, "status": "متوقف"}},
            "rows": [["tOLD", "2026-10-12", 2, 3, 1, 0, 0]],
            "platforms": {"tiktok": {"ok": True, "synced_at": "2026-10-12T12:38+03:00", "source": "mcp"}},
        }
        got, _log = self._run(_env(), prev, os.path.join(ROOT, "missing-tiktok.json"), FixtureTransport())
        self.assertEqual(got["status"]["coverage_end"], "2026-10-12")
        self.assertEqual(got["status"]["source"], "api")
        self.assertIn("2026-10-12", {r[1] for r in got["rows"]})
        self.assertNotIn("2026-10-13", {r[1] for r in got["rows"]})
        self.assertIn("2026-10-17", {r[1] for r in got["rows"]})

    def test_missing_secrets_use_the_branch_file_exactly(self):
        import tempfile
        prev = {
            "ads": {"tNEW": {"platform": "tiktok", "name": "من الواجهة", "live": True, "status": "نشط"}},
            "rows": [["tNEW", "2026-10-18", 999, 1, 1, 1, 1]],
            "platforms": {"tiktok": {"ok": True, "synced_at": "2026-10-18T09:00+03:00", "source": "api", "coverage_end": "2026-10-18"}},
        }
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "tiktok.json")
            json.dump({
                "generated_at": "2026-10-12T12:38+03:00",
                "organic": {"status": "ok", "name": "تيك توك", "followers": 10, "posts": []},
                "ads": {"t2": {"platform": "tiktok", "name": "Well lead", "campaign": "Tiktok_Leads_WELL", "group": "g", "text": "", "live": False}},
                "rows": [
                    ["t2", "2026-09-01", 10, 5, 1, 0, 0],
                    ["t2", "2026-10-12", 4, 8, 2, 1, 0],
                    ["t9", "2026-10-12", 80, 9, 1, 0, 0],
                ],
            }, open(path, "w", encoding="utf-8"))
            # ملف فيه إعلان زهرة الربيع يُسقَط كما في المسار القديم.
            blob = json.load(open(path, encoding="utf-8"))
            blob["ads"]["t9"] = {"platform": "tiktok", "name": "Rose install", "campaign": "SR | iOS14 | AppInstall", "group": "", "text": ""}
            json.dump(blob, open(path, "w", encoding="utf-8"))

            def boom(*_a, **_k):
                raise AssertionError("secrets missing must not call TikTok")

            got, log = self._run({}, prev, path, boom, recent=0)
        self.assertFalse(got["pending"])
        self.assertTrue(got["status"]["ok"])
        self.assertEqual(got["status"]["source"], "mcp")
        self.assertEqual(got["status"]["synced_at"], "2026-10-12T12:38+03:00")
        self.assertEqual(got["status"]["coverage_end"], "2026-10-12")
        self.assertEqual(sorted(r[0] for r in got["rows"]), ["t2", "t2"])
        self.assertNotIn("t9", got["ads"])
        self.assertNotIn("tNEW", got["ads"])
        self.assertEqual(got["organic_blob"]["organic"]["followers"], 10)
        self.assertIn("tiktok-data", log)

    def test_api_failure_keeps_newer_previous_rows_and_does_not_invent_days(self):
        import tempfile
        prev = {
            "generated_at": "2026-10-18T09:00+03:00",
            "ads": {"tNEW": {"platform": "tiktok", "name": "من الواجهة", "live": True, "status": "نشط"}},
            "rows": [
                ["tNEW", "2026-10-12", 4, 8, 2, 1, 0],
                ["tNEW", "2026-10-17", 6, 9, 1, 1, 2],
            ],
            "platforms": {"tiktok": {
                "ok": True, "synced_at": "2026-10-18T09:00+03:00", "source": "api", "coverage_end": "2026-10-17",
            }},
        }
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "tiktok.json")
            json.dump({
                "generated_at": "2026-10-12T12:38+03:00",
                "ads": {"t2": {"platform": "tiktok", "name": "Well lead", "campaign": "c", "group": "g"}},
                "rows": [["t2", "2026-10-12", 4, 1, 1, 0, 0]],
            }, open(path, "w", encoding="utf-8"))

            def transport(*_a, **_k):
                raise RuntimeError("HTTP 401: Access-Token: " + TOKEN)

            got, log = self._run(_env(), prev, path, transport)
        self.assertFalse(got["status"]["ok"])
        self.assertEqual(got["status"]["source"], "api")
        self.assertEqual(got["status"]["synced_at"], "2026-10-18T09:00+03:00")
        self.assertEqual(got["status"]["coverage_end"], "2026-10-17")
        self.assertEqual(got["status"]["stale_from"], "2026-10-18T09:00+03:00")
        self.assertEqual([r[1] for r in got["rows"]], ["2026-10-12", "2026-10-17"])
        self.assertEqual(got["rows"][1][2], 6)
        self.assertNotIn("2026-10-18", {r[1] for r in got["rows"]})
        self.assertNotIn(TOKEN, got["status"]["error"])
        self.assertIn("فشل السحب", log)
        self.assertIn("أقدم", log)

    def test_api_failure_without_newer_history_uses_the_branch(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "tiktok.json")
            json.dump({
                "generated_at": "2026-10-12T12:38+03:00",
                "ads": {"t2": {"platform": "tiktok", "name": "Well lead"}},
                "rows": [["t2", "2026-10-12", 4, 1, 1, 0, 0]],
            }, open(path, "w", encoding="utf-8"))

            def transport(*_a, **_k):
                raise RuntimeError("TikTok 40105: invalid access token")

            got, log = self._run(_env(), None, path, transport)
        self.assertTrue(got["status"]["ok"])
        self.assertEqual(got["status"]["source"], "mcp")
        self.assertEqual(got["rows"], [["t2", "2026-10-12", 4, 1, 1, 0, 0]])
        self.assertIn("فشل السحب", log)
        self.assertIn("tiktok-data", log)

    def test_nothing_available_stays_pending_without_zero_rows(self):
        def boom(*_a, **_k):
            raise AssertionError("no secrets and no file must not call the network")
        got, _log = self._run({}, None, os.path.join(ROOT, "missing-tiktok.json"), boom)
        self.assertTrue(got["pending"])
        self.assertIsNone(got["status"])
        self.assertEqual(got["ads"], {})
        self.assertEqual(got["rows"], [])
        self.assertFalse(secrets_ready({}))
        self.assertFalse(secrets_ready({"TIKTOK_ACCESS_TOKEN": TOKEN, "TIKTOK_ADVERTISER_IDS": ROSE}))

    def test_vault_value_is_used_for_audience_instead_of_the_branch(self):
        vault, github = "vault-tiktok-token", "github-tiktok-token"
        keys = ("TIKTOK_ACCESS_TOKEN", "V_TIKTOK_ACCESS_TOKEN", "TIKTOK_ADVERTISER_IDS", "V_TIKTOK_ADVERTISER_IDS")
        old = {k: os.environ.get(k) for k in keys}
        os.environ["TIKTOK_ACCESS_TOKEN"] = github
        os.environ["V_TIKTOK_ACCESS_TOKEN"] = vault
        os.environ["TIKTOK_ADVERTISER_IDS"] = ROSE
        os.environ["V_TIKTOK_ADVERTISER_IDS"] = WELL

        def transport(url, data=None, headers=None, method=None, timeout=None):
            got = (headers or {}).get("Access-Token")
            if got != vault:
                raise AssertionError("pipeline did not use the vault token")
            if vault in url or github in url or ROSE in url:
                raise AssertionError("secret or excluded advertiser leaked into the URL")
            path = url.split("?", 1)[0]
            query = urllib.parse.unquote(url.split("?", 1)[1] if "?" in url else "")
            if path.endswith("/advertiser/info/"):
                return {"code": 0, "data": {"list": [{
                    "advertiser_id": WELL, "name": "Well", "currency": "SAR", "timezone": "Asia/Riyadh",
                }]}}
            if path.endswith("/campaign/get/"):
                return {"code": 0, "data": {"list": [{
                    "campaign_id": "c1", "objective_type": "LEAD_GENERATION", "operation_status": "ENABLE",
                    "campaign_name": "Tiktok_Leads_WELL",
                }]}}
            if path.endswith("/adgroup/get/"):
                return {"code": 0, "data": {"list": [{"adgroup_id": "g1", "operation_status": "ENABLE"}]}}
            if path.endswith("/ad/get/"):
                return {"code": 0, "data": {"list": [{
                    "ad_id": "55", "ad_name": "Well lead", "campaign_id": "c1", "campaign_name": "Tiktok_Leads_WELL",
                    "adgroup_id": "g1", "adgroup_name": "g", "operation_status": "ENABLE",
                    "secondary_status": "AD_STATUS_DELIVERY_OK", "advertiser_id": WELL,
                }]}}
            if path.endswith("/report/integrated/get/"):
                if '"age"' in query or '"gender"' in query or '"platform"' in query or '"stat_time_hour"' in query:
                    if '"stat_time_hour"' in query:
                        dim = {"ad_id": "55", "stat_time_hour": "2026-10-18 18:00:00"}
                    elif '"age"' in query:
                        dim = {"ad_id": "55", "age": "AGE_25_34"}
                    elif '"gender"' in query:
                        dim = {"ad_id": "55", "gender": "FEMALE"}
                    else:
                        dim = {"ad_id": "55", "platform": "TIKTOK"}
                    return {"code": 0, "data": {"list": [{"dimensions": dim, "metrics": {
                        "spend": "10", "impressions": "100", "clicks": "4", "conversion": "1",
                    }}]}}
                return {"code": 0, "data": {"list": [{"dimensions": {
                    "ad_id": "55", "stat_time_day": "2026-10-17 00:00:00",
                }, "metrics": {"spend": "10", "impressions": "100", "clicks": "4", "conversion": "1"}}]}}
            raise AssertionError("unexpected " + path)

        try:
            picked = env()
            self.assertEqual(picked["TIKTOK_ACCESS_TOKEN"], vault)
            self.assertEqual(picked["TIKTOK_ADVERTISER_IDS"], WELL)
            buf = io.StringIO()
            with contextlib.redirect_stderr(buf):
                got = ingest_tiktok(
                    picked, None, 3, datetime(2026, 10, 15, tzinfo=RIYADH), END, "2026-10-18",
                    os.path.join(ROOT, "missing-tiktok.json"), transport, NOW, self._carry, audience_due=True,
                )
            log = buf.getvalue()
        finally:
            for k, v in old.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v
        self.assertNotIn(vault, log)
        self.assertNotIn(github, log)
        self.assertNotIn("tiktok-data", log)
        self.assertIn("tiktok: تفاصيل المشاهدين لـ 1 إعلان", log)
        self.assertEqual(got["status"]["source"], "api")
        self.assertTrue(got["status"]["ok"])
        self.assertFalse(got["pending"])


if __name__ == "__main__":
    unittest.main()
