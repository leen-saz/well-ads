"""تجربة التنفيذ: يطفي إعلان واحد في حملة التجربة ويرجّعه يشتغل، ويتأكد من Meta بعد كل خطوة.

يختار أقل إعلان شغّال صرفاً في الحملة (آخر 7 أيام)، فالأثر على التوصيل ثواني بس.
يشتغل يدوي من GitHub Actions (execute-smoke). كل خطوة تنكتب في السجل.
"""
import os, re, sys, time
from datetime import datetime, timedelta, timezone

from modules.core.supa import Supa
from modules.execute.run import Meta, guard

WAIT = 20


def pick(meta, act, campaign):
    camps = meta._call(f"{act}/campaigns", fields="id,name", limit=200).get("data") or []
    c = next((x for x in camps if x.get("name") == campaign or x.get("id") == campaign), None)
    if not c:
        raise SystemExit(f"smoke: ما لقيت الحملة {campaign}")
    ads = meta._call(f"{c['id']}/ads", fields="id,name,status,effective_status,insights.date_preset(last_7d){spend}", limit=200).get("data") or []
    live = [a for a in ads if a.get("status") == "ACTIVE"]
    if not live:
        raise SystemExit("smoke: ما فيه إعلان شغّال في الحملة")
    spend = lambda a: float(((a.get("insights") or {}).get("data") or [{}])[0].get("spend") or 0)
    return c, min(live, key=spend)


def approved_by_leen(db, approval_id, now=None):
    """The test touches a live ad, so it needs an approved decision (a suggestions row decided in the last 48 hours).
    Returns an error message, or None when the approval is good."""
    if not re.fullmatch(r"\d{1,12}", str(approval_id or "").strip()):
        return "ما فيه رقم موافقة صحيح (approval_id)"
    rows = db.req(f"/rest/v1/suggestions?id=eq.{int(approval_id)}&select=status,decided_at") or []
    if not rows or rows[0].get("status") not in ("approved", "executed"):
        return "الموافقة غير موجودة أو مو موافق عليها"
    at = rows[0].get("decided_at")
    now = now or datetime.now(timezone.utc)
    if not at or datetime.fromisoformat(at.replace("Z", "+00:00")) < now - timedelta(hours=48):
        return "الموافقة أقدم من 48 ساعة"
    return None


def main():
    campaign = (os.environ.get("CAMPAIGN") or "").strip()
    token, act = (os.environ.get("META_ACCESS_TOKEN") or "").strip(), (os.environ.get("META_AD_ACCOUNT_ID") or "").strip()
    db = Supa.from_env()
    if not (campaign and token and act and db):
        raise SystemExit("smoke: ناقص الحملة أو المفاتيح")
    kill, canary = guard(db)
    if kill:
        raise SystemExit("smoke: زر الطوارئ شغّال")
    why = approved_by_leen(db, os.environ.get("APPROVAL_ID"))
    if why:
        raise SystemExit(f"smoke: {why}، ما ينفّذ شي")
    meta = Meta(token)
    c, ad = pick(meta, act, campaign)
    if c["id"] not in canary and c["name"] not in canary:
        raise SystemExit(f"smoke: {c['name']} مو حملة تجربة. لين تختارها من حدود التنفيذ أول")
    # the record comes BEFORE the pause, and it must succeed: no row, no pause (Supa.audit swallows errors, so write directly)
    db.req("/rest/v1/audit_log", "POST", {"email": "system", "action": "execute_smoke_start",
           "target": {"platform": "meta", "campaign": c["name"], "target_id": ad["id"], "target_name": ad["name"], "approval_id": os.environ.get("APPROVAL_ID")}}, "return=minimal")
    steps, ok = [], True
    print(f"smoke: الإعلان المختار {ad['name']} ({ad['id']})")
    try:
        for want in ("PAUSED", "ACTIVE"):
            meta.set_status(ad["id"], want)
            got = meta.ad(ad["id"]).get("status")
            steps.append({"asked": want, "got": got})
            print(f"smoke: {ad['name']} ← {want}: Meta يقول {got}")
            ok = ok and got == want
            if want == "PAUSED":
                time.sleep(WAIT)
    except Exception as ex:
        ok = False
        steps.append({"error": str(ex)[:300]})
        print(f"smoke: Meta رفض — {str(ex)[:300]}")
    finally:
        if meta.ad(ad["id"]).get("status") != "ACTIVE":
            meta.set_status(ad["id"], "ACTIVE")   # لا يمكن نخليه طافي بسبب تجربة
    db.audit("execute_smoke", target={"platform": "meta", "campaign": c["name"], "target_id": ad["id"], "target_name": ad["name"]},
             before={"status": "ACTIVE"}, after={"status": meta.ad(ad["id"]).get("status")}, result={"steps": steps, "ok": ok})
    print("smoke: نجح ✓" if ok else "smoke: فشل ✗")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
