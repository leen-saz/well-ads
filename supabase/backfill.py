#!/usr/bin/env python3
"""تعبئة لمرة واحدة: يقرأ data.json ويكتبه كاملاً في Supabase.

يحتاج SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY في البيئة أو في .env بجانب المستودع.
المفتاح السري لا يُطبع. إذا غاب أحد المتغيرين يتوقف السكربت بدون ما يمس الملف.
"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from supabase_store import enabled, save_bundle


def main():
    if not enabled():
        print("أضيفي SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY ثم أعيدي التشغيل", file=sys.stderr)
        return 1
    path = os.path.join(ROOT, "data.json")
    if not os.path.exists(path):
        print("ما فيه data.json. أول تشغيل للسحب مع الأسرار يعبّي القاعدة من الكاش.", file=sys.stderr)
        return 1
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    save_bundle(data, full=True)
    print(f"تمت التعبئة: {len(data.get('ads') or {})} إعلان، {len(data.get('rows') or [])} صف")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
