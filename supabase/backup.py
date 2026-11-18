"""نسخة احتياطية من قاعدة Supabase بمفتاح السيرفر (بدون كلمة سر القاعدة): كل جداول public + مستخدمين Auth.

يكتب ملف JSON لكل جدول في مجلد backup/ ، ويطلع عدد الصفوف. المخطط نفسه في supabase/*.sql.
فيه بيانات شخصية (إيميلات) وأرقام أعمال، والريبو عام (وأي حساب GitHub ينزّل الـ artifacts): الـ workflow يشفّره قبل الرفع، وما ينحفظ في الريبو أبداً.
"""
import json, os, sys, urllib.parse, urllib.request
from datetime import datetime, timezone

from modules.core.supa import Supa

# Every table the app writes (supabase/migrations). connections holds names and status only: the keys live in the Vault.
TABLES = ("profiles", "audit_log", "dashboard_state", "ads", "ad_metrics", "platform_activity",
          "suggestions", "control_settings", "outcomes", "lessons",
          "companies", "connections", "crm_leads", "crm_sync_state", "knowledge", "brand_assets", "social_posts",
          "journeys", "journey_runs", "copy_projects", "content_plans", "listen_watch", "listen_mentions",
          "motion_projects", "motion_versions",
          "ai_budgets", "ai_routes", "ai_usage", "campaigns", "campaign_tasks", "campaign_outputs", "library_items",
          "library_favorites", "transcribe_jobs", "vision_analyses", "voiceover_settings", "buyer_actions", "buyer_outcomes",
          "schema_migrations", "video_projects", "video_jobs", "video_settings")
# Not backed up on purpose (tests/unit/backup-coverage.test.ts reads this): web_vitals is 7-day telemetry with no personal data
SKIPPED = ("web_vitals",)
PAGE = 1000


def dump(db, table):
    rows, start = [], 0
    while True:
        h = {"apikey": db.key, "Authorization": f"Bearer {db.key}", "Range-Unit": "items", "Range": f"{start}-{start + PAGE - 1}"}
        with urllib.request.urlopen(urllib.request.Request(f"{db.url}/rest/v1/{table}?select=*", headers=h), timeout=60) as r:
            got = json.loads(r.read().decode() or "[]")
        rows += got
        if len(got) < PAGE:
            return rows
        start += PAGE


def users(db):
    out, page = [], 1
    while True:
        r = db.req(f"/auth/v1/admin/users?{urllib.parse.urlencode({'page': page, 'per_page': PAGE})}") or {}
        got = r.get("users") or []
        out += [{k: u.get(k) for k in ("id", "email", "role", "created_at", "last_sign_in_at", "email_confirmed_at", "app_metadata", "user_metadata")} for u in got]
        if len(got) < PAGE:
            return out
        page += 1


def main():
    db = Supa.from_env()
    if not db:
        sys.exit("backup: ناقص SUPABASE_URL أو المفتاح")
    os.makedirs("backup", exist_ok=True)
    total, bad, counts = 0, [], {}
    debug = os.environ.get("PIPELINE_DEBUG") == "1"
    for t in TABLES:
        try:
            rows = dump(db, t)
        except Exception as ex:
            bad.append(t); print(f"backup: {t} ✗ {str(ex)[:120]}"); continue
        json.dump(rows, open(f"backup/{t}.json", "w", encoding="utf-8"), ensure_ascii=False)
        total += len(rows); counts[t] = len(rows)
        # The Actions log is public: the row counts go into the encrypted manifest, and to the log only with PIPELINE_DEBUG=1
        print(f"backup: {t} ✓" + (f" {len(rows)} صف" if debug else ""))
    u = users(db)
    json.dump(u, open("backup/auth_users.json", "w", encoding="utf-8"), ensure_ascii=False)
    counts["auth_users"] = len(u)
    print("backup: auth_users ✓" + (f" {len(u)} مستخدم" if debug else ""))
    # Read back by supabase/backup_check.py (the monthly restore test) to prove nothing was cut short
    json.dump({"taken_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "tables": counts, "failed": bad},
              open("backup/manifest.json", "w", encoding="utf-8"))
    print("backup: " + (f"فشل: {', '.join(bad)}" if bad else "كل الجداول ✓") + (f" · المجموع {total} صف" if debug else ""))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
