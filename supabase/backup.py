"""نسخة احتياطية من قاعدة Supabase بمفتاح السيرفر (بدون كلمة سر القاعدة): كل جداول public + مستخدمين Auth.

يكتب ملف JSON لكل جدول في مجلد backup/ ، ويطلع عدد الصفوف. المخطط نفسه في supabase/*.sql.
فيه بيانات شخصية (إيميلات): يُرفع كـ artifact خاص لمدة قصيرة بس، وما ينحفظ في الريبو أبداً.
"""
import json, os, sys, urllib.parse, urllib.request

from modules.core.supa import Supa

TABLES = ("profiles", "audit_log", "dashboard_state", "ads", "ad_metrics", "platform_activity",
          "suggestions", "control_settings", "outcomes", "lessons")
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
    total, bad = 0, []
    for t in TABLES:
        try:
            rows = dump(db, t)
        except Exception as ex:
            bad.append(t); print(f"backup: {t} ✗ {str(ex)[:120]}"); continue
        json.dump(rows, open(f"backup/{t}.json", "w", encoding="utf-8"), ensure_ascii=False)
        total += len(rows); print(f"backup: {t} {len(rows)} صف")
    u = users(db)
    json.dump(u, open("backup/auth_users.json", "w", encoding="utf-8"), ensure_ascii=False)
    print(f"backup: auth_users {len(u)} مستخدم")
    print(f"backup: المجموع {total} صف" + (f" · فشل: {', '.join(bad)}" if bad else " ✓"))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
