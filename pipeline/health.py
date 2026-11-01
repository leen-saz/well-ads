#!/usr/bin/env python3
"""فحص صحة البيانات بعد كل تحديث. إذا فيه مشكلة يفشل الـworkflow، وGitHub يرسل إيميل تنبيه تلقائياً.

يفشل (= إيميل) بس في 4 تشغيلات باليوم (9 الصبح، 1 الظهر، 5 العصر، 9 الليل بتوقيت الرياض) عشان ما يزعج كل ساعة.
باقي الساعات يكتب المشكلة في ملخص التشغيل بس.
- منصة فشل سحبها.
- بيانات تيك توك (روتين موج) متأخرة أكثر من 6 ساعات.
- منصة آخر يوم فيها أقدم من أمس.
- حملات صرفت آخر 7 أيام وما انعرف قسمها من اسمها (تحتاج تسمية صح).
"""
import json, os, sys
from datetime import date, datetime, timedelta, timezone

RIYADH = timezone(timedelta(hours=3))
ALERT_HOURS = {9, 13, 17, 21}


def check(data, now):
    problems, notes = [], []
    today = now.date()
    for name, p in (data.get("platforms") or {}).items():
        if not isinstance(p, dict):
            continue
        if p.get("ok") is False:
            problems.append(f"{name}: السحب فشل — {str(p.get('error') or '')[:160]}")
        end = p.get("coverage_end")
        if end and date.fromisoformat(end[:10]) < today - timedelta(days=1):
            problems.append(f"{name}: آخر بيانات {end[:10]}")
    tt = (data.get("platforms") or {}).get("tiktok") or {}
    if tt.get("synced_at"):
        lag = (now - datetime.fromisoformat(tt["synced_at"])).total_seconds() / 3600
        if lag > 6:
            problems.append(f"tiktok: آخر مزامنة من روتين موج قبل {lag:.0f} ساعة")
    since = (today - timedelta(days=7)).isoformat()
    ads = data.get("ads") or {}
    spent = {}
    for k, d, sp, *_ in data.get("rows") or []:
        a = ads.get(k)
        if d >= since and sp and a and a.get("dept") in (None, "", "brand"):
            spent[a.get("campaign") or "?"] = spent.get(a.get("campaign") or "?", 0) + sp
    for camp, sp in sorted(spent.items(), key=lambda x: -x[1])[:10]:
        notes.append(f"حملة بدون قسم واضح من اسمها: {camp} (صرف {sp:.0f} ريال آخر 7 أيام)")
    return problems, notes


def main():
    data = json.load(open("data.json", encoding="utf-8"))
    now = datetime.now(RIYADH)
    problems, notes = check(data, now)
    lines = ["## صحة البيانات", ""] + ([f"- ❌ {p}" for p in problems] or ["- ✅ كل المنصات محدّثة"]) + [""] + [f"- ⚠️ {n}" for n in notes]
    print("\n".join(lines))
    out = os.environ.get("GITHUB_STEP_SUMMARY")
    if out:
        open(out, "a", encoding="utf-8").write("\n".join(lines) + "\n")
    if problems and (now.hour in ALERT_HOURS or os.environ.get("HEALTH_ALWAYS")):
        sys.exit(1)


if __name__ == "__main__":
    main()
