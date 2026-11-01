"""يتعلّم من كل حركات الميديا باير: قراراته في اللوحة (وافق، رفض، عدّل، وملاحظاته)، ونتايجها بعد 3 و7 أيام،
وحركاته داخل المنصات نفسها (من observe). ويطلع دروس يقراها suggest وcritic.

- قاعدة يرفضها الفريق باستمرار (5 قرارات أو أكثر، والموافقة أقل من 20%) تتعلّم "block"، والمراجع يرفض اقتراحاتها لين تراجعها لين.
- قاعدة نتيجتها سيئة (تكلفة الليد طلعت بعد الموافقة) تطلع درس تحذير.
- حركات يدوية متكررة داخل المنصة (مثل رفع ميزانية بدون اقتراح) تطلع درس: النظام فاته شي.
قراءة فقط على حسابات الإعلانات.
"""
import sys, urllib.parse
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from statistics import median

from modules.core.supa import Supa

PN = {"meta": "Meta", "snap": "Snap", "tiktok": "TikTok", "google": "Google"}
KIND = {"pause": "الإيقاف", "pause_campaign": "إيقاف الحملة", "budget_up": "رفع الميزانية", "budget_down": "تنزيل الميزانية", "refresh_creative": "تغيير الكرييتف", "new_campaign": "الحملات الجديدة"}


def lessons(decisions, outcomes, activity):
    out = []
    by = defaultdict(list)
    for s in decisions:
        by[(s["platform"], s["kind"])].append(s)
    oc = defaultdict(list)
    for o in outcomes:
        oc[o["suggestion_id"]].append(o)
    for (p, k), rows in by.items():
        n = len(rows)
        ok = sum(1 for s in rows if s["status"] in ("approved", "modified", "executed"))
        rate = ok / n
        notes = [s["note"] for s in rows if s.get("note") and s["status"] in ("rejected", "modified")][:8]
        ev = {"decisions": n, "approved": ok, "approval_rate": round(rate, 2), "notes": notes}
        if n >= 5 and rate < 0.2:
            out.append({"platform": p, "kind": k, "lesson": f"الفريق رفض {n - ok} من {n} اقتراحات {KIND.get(k, k)} في {PN.get(p, p)}. المراجع يوقفها لين تراجع لين القاعدة.",
                        "evidence": ev, "confidence": round(min(1, n / 10), 2), "block": True})
        elif n >= 3:
            out.append({"platform": p, "kind": k, "lesson": f"نسبة الموافقة على {KIND.get(k, k)} في {PN.get(p, p)}: {round(100 * rate)}% من {n} قرار.",
                        "evidence": ev, "confidence": round(min(1, n / 10), 2), "block": False})
        changes = [o["vs_expect"].get("cpl_change_pct") for s in rows if s["status"] in ("approved", "modified", "executed") for o in oc.get(s["id"], [])
                   if o["day"] == 7 and (o.get("vs_expect") or {}).get("cpl_change_pct") is not None]
        if len(changes) >= 3:
            m = median(changes)
            out.append({"platform": p, "kind": k, "lesson": f"بعد 7 أيام من {KIND.get(k, k)} في {PN.get(p, p)}، تكلفة الليد {'طلعت' if m > 0 else 'نزلت'} {abs(m):.0f}% (الوسيط من {len(changes)}).",
                        "evidence": {"cpl_change_median": m, "n": len(changes)}, "confidence": round(min(1, len(changes) / 8), 2), "block": False})
    moves = Counter((a["platform"], a["event"]) for a in activity)
    actors = defaultdict(Counter)
    for a in activity:
        actors[(a["platform"], a["event"])][a.get("actor") or "?"] += 1
    for (p, e), n in moves.most_common(6):
        if n >= 3:
            who = "، ".join(f"{k} ({v})" for k, v in actors[(p, e)].most_common(3))
            out.append({"platform": p, "kind": "manual:" + e, "lesson": f"حركة يدوية متكررة داخل {PN.get(p, p)}: {e} صارت {n} مرات آخر 7 أيام ({who}). إذا ما فيه اقتراح يقابلها، النظام فاته شي.",
                        "evidence": {"count": n}, "confidence": round(min(1, n / 10), 2), "block": False})
    return out


def main():
    db = Supa.from_env()
    if not db:
        print("learn: بدون Supabase")
        return
    try:
        now = datetime.now(timezone.utc)
        d30, d7 = (now - timedelta(days=30)).isoformat(), (now - timedelta(days=7)).isoformat()
        decisions = db.req("/rest/v1/suggestions?select=id,platform,kind,status,note&status=in.(approved,modified,rejected,executed)&decided_at=gte." + urllib.parse.quote(d30) + "&limit=5000") or []
        outcomes = db.req("/rest/v1/outcomes?select=suggestion_id,day,vs_expect&limit=5000") or []
        activity = db.req("/rest/v1/platform_activity?select=platform,event,actor&at=gte." + urllib.parse.quote(d7) + "&limit=5000") or []
        new = lessons(decisions, outcomes, activity)
        db.req("/rest/v1/lessons?active=eq.true", "PATCH", {"active": False}, "return=minimal")
        if new:
            db.req("/rest/v1/lessons", "POST", new, "return=minimal")
        db.audit("learn_run", target={"lessons": len(new), "decisions": len(decisions), "moves": len(activity)})
        print(f"learn: {len(new)} درس من {len(decisions)} قرار و{len(activity)} حركة داخل المنصات")
    except Exception as ex:
        print("learn: ما اشتغل —", str(ex)[:200], file=sys.stderr)


if __name__ == "__main__":
    main()
