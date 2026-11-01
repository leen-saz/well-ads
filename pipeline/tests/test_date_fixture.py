"""تشغّل اللوحة على أرقام معروفة وتتأكد أن الفترة والفلاتر تغيّر الناتج."""
import json, os, subprocess, sys, tempfile, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROME = os.environ.get("CHROME", "/usr/bin/google-chrome")


def page(data):
    tpl = open(os.path.join(ROOT, "template.html"), encoding="utf-8").read()
    blob = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    return tpl.replace("/*__DATA__*/", blob)


def main_data():
    ad = dict(group="g", status="نشط", live=True, goal="lead", format="صورة", text="")
    return {
        "generated_at": "2026-10-17T12:00+03:00",
        "schema": 3,
        "range": {"start": "2026-10-01", "end": "2026-10-16", "today": "2026-10-17"},
        "currency": "SAR",
        "goals": {"lead": "ليدز", "messages": "محادثات"},
        "platforms": {
            "meta": {"ok": True, "coverage_end": "2026-10-17"},
            "google": {"ok": True, "coverage_end": "2026-10-17"},
            "snap": {"ok": True, "coverage_end": "2026-10-17"},
            "tiktok": {"ok": True, "synced_at": "2026-10-16T12:00+03:00", "coverage_end": "2026-10-16"},
        },
        "ads": {
            "fb": {**ad, "platform": "facebook", "name": "Hair Vitality", "campaign": "IV Camp", "dept": "iv"},
            "tt": {**ad, "platform": "tiktok", "name": "TikTok IV", "campaign": "TT Camp", "dept": "iv", "format": "فيديو"},
            "sn": {**ad, "platform": "snap", "name": "maternity care", "campaign": "Mid Camp", "dept": "midwife"},
            "gg": {**ad, "platform": "google", "name": "Foot Alignment", "campaign": "G Camp", "dept": "foot", "live": False, "status": "متوقف"},
            "msg": {**ad, "platform": "facebook", "name": "Renan chat", "campaign": "Msg Camp", "dept": "renan", "goal": "messages"},
            "an": {**ad, "platform": "audience_network", "name": "HIDDENAN", "campaign": "AN Camp", "dept": "brand"},
        },
        "rows": [
            ["fb", "2026-10-13", 20, 40, 4, 4, 0],
            ["fb", "2026-10-15", 10, 100, 10, 2, 1],
            ["fb", "2026-10-16", 30, 50, 0, 1, 0],
            ["tt", "2026-10-15", 5, 40, 4, 1, 0],
            ["sn", "2026-10-16", 7, 70, 7, 3, 0],
            ["sn", "2026-10-17", 8, 16, 2, 1, 0],
            ["gg", "2026-10-16", 4, 20, 2, 0.5, 0],
            ["msg", "2026-10-16", 100, 80, 8, 10, 2],
            ["an", "2026-10-16", 9, 30, 1, 0, 0],
        ],
        "organic": {
            "facebook": [{
                "status": "ok", "name": "Well Care.", "followers": 42421, "insights": "ok", "posts_status": "ok",
                "days": [
                    {"date": "2026-10-15", "views": 10, "reach": 8, "engagement": 3},
                    {"date": "2026-10-16", "views": 20, "reach": 7, "engagement": 4},
                ],
                "posts": [
                    {"id": "in", "date": "2026-10-15", "caption": "POST IN RANGE", "dept": "iv", "reach": 10, "likes": 2, "views": 100, "comments": 0, "shares": 0, "saves": 0},
                    {"id": "out", "date": "2026-10-13", "caption": "POST OUT", "dept": "iv", "reach": 4, "likes": 1, "views": 10},
                    {"id": "foot", "date": "2026-10-16", "caption": "POST FOOT", "dept": "foot", "reach": 0, "likes": 5, "views": 50, "comments": 0, "shares": 0, "saves": 0},
                    {"id": "none", "caption": "UNDATED POST", "dept": "iv", "reach": 10, "likes": 5, "views": 50},
                ],
            }],
            "instagram": [{
                "status": "ok", "name": "@wellcare.sa", "followers": 88001, "insights": "ok", "posts_status": "ok",
                "days": [],
                "period": {"start": "2026-10-01", "end": "2026-10-16", "views": 999, "reach": 111, "engagement": 91},
                "posts": [],
            }],
            "ga4": {
                "status": "ok", "name": "GA4",
                "days": [
                    {"date": "2026-10-15", "users": 5, "sessions": 10, "views": 100},
                    {"date": "2026-10-16", "users": 9, "sessions": 3, "views": 40},
                ],
                "channels": [{"channel": "Organic Search", "sessions": 4242, "users": 1000}],
                "window": {"start": "2026-10-01", "end": "2026-10-16"},
            },
        },
    }


def month_data():
    ad = dict(group="g", status="نشط", live=True, goal="lead", format="صورة", text="", platform="snap", name="snap", campaign="S", dept="iv")
    return {
        "generated_at": "2026-11-01T08:00+03:00",
        "schema": 3,
        "range": {"start": "2026-10-01", "end": "2026-10-31", "today": "2026-11-01"},
        "currency": "SAR",
        "goals": {"lead": "ليدز"},
        "platforms": {
            "meta": {"ok": True, "coverage_end": "2026-11-01"},
            "google": {"ok": True, "coverage_end": "2026-11-01"},
            "snap": {"ok": True, "coverage_end": "2026-11-01"},
        },
        "ads": {"sn": ad},
        "rows": [
            ["sn", "2026-10-15", 40, 10, 1, 2, 0],
            ["sn", "2026-11-01", 3, 6, 1, 1, 0],
        ],
        "organic": {"facebook": [], "instagram": [], "ga4": {"status": "pending", "days": [], "needs": ["GA4"]}},
    }


class FixtureBrowserTests(unittest.TestCase):
    def test_selected_range_and_filters_match_known_values(self):
        if not os.path.exists(CHROME):
            self.fail("chrome is not available")
        if not os.path.exists("/tmp/pw/node_modules/puppeteer-core"):
            subprocess.check_call(["npm", "install", "--prefix", "/tmp/pw", "puppeteer-core"], timeout=180)
        shot = "/opt/cursor/artifacts/screenshots"
        os.makedirs(shot, exist_ok=True)
        with tempfile.TemporaryDirectory() as tmp:
            main = os.path.join(tmp, "main.html")
            month = os.path.join(tmp, "month.html")
            open(main, "w", encoding="utf-8").write(page(main_data()))
            open(month, "w", encoding="utf-8").write(page(month_data()))
            env = dict(os.environ, CHROME=CHROME)
            proc = subprocess.run(
                ["node", os.path.join(ROOT, "tests", "browser_date_fixture.js"),
                 "file://" + main, "file://" + month, shot],
                cwd=ROOT, env=env, capture_output=True, text=True, timeout=120,
            )
        if proc.returncode != 0:
            self.fail((proc.stdout or "") + (proc.stderr or ""))
        self.assertIn("fixture ok", proc.stdout)


if __name__ == "__main__":
    unittest.main()
