"""المراجع الثاني: يشيّك كل اقتراح مفتوح على قواعد لين (modules/core/rules.py)، وعلى الدروس لما تجهز (المرحلة C).

يكتب في suggestions.critic: {ok, issues, at}. الاقتراح اللي فشل ما ينقبل في لوحة القرارات (رفض بس).
قراءة فقط على حسابات الإعلانات.
"""
import sys
from datetime import date, datetime, timezone

from modules.core import rules, enabled
from modules.core.supa import Supa


def review(s, today=None, lessons=()):
    issues = rules.check(s, today or date.today())
    if s.get("digest") is None:
        issues.append("الاقتراح بدون بصمة")
    if rules.needs_leen(s):
        issues.append("حملة جديدة: تحتاج موافقة لين")
    for l in lessons:   # المرحلة C: دروس من النتايج السابقة
        if l.get("kind") == s.get("kind") and l.get("platform") == s.get("platform") and l.get("block"):
            issues.append(f"درس سابق: {l.get('lesson')}")
    return {"ok": not issues, "issues": issues, "at": datetime.now(timezone.utc).isoformat()}


def main():
    if not enabled("critic"):
        print("critic: مقفل في config/modules.json")
        return
    db = Supa.from_env()
    if not db:
        print("critic: بدون Supabase")
        return
    try:
        rows = db.req("/rest/v1/suggestions?select=*&status=eq.open&critic=is.null&limit=500") or []
        try:
            lessons = db.req("/rest/v1/lessons?select=platform,kind,lesson,block&active=eq.true&limit=500") or []
        except Exception:
            lessons = []   # جدول الدروس ما انسوى بعد
        for s in rows:
            c = review(s, lessons=lessons)
            db.req(f"/rest/v1/suggestions?id=eq.{s['id']}&critic=is.null", "PATCH", {"critic": c}, "return=minimal")
        print(f"critic: راجع {len(rows)} اقتراح")
        db.audit("critic_run", target={"reviewed": len(rows)})
    except Exception as ex:
        print("critic: ما اشتغل —", str(ex)[:200], file=sys.stderr)


if __name__ == "__main__":
    main()
