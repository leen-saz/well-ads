"""نتيجة كل قرار بعد 3 و7 أيام: الأرقام بعد القرار مقابل 7 أيام قبله، للإعلان أو الحملة نفسها.
حتى المرفوض ينقاس: يورينا وش صار لما ما سوينا شي. قراءة فقط."""
import sys, urllib.parse
from datetime import date, datetime, timedelta, timezone

from modules.core import load_data, base_key, PREFIX
from modules.core.supa import Supa

PRE = {v: k for k, v in PREFIX.items()}


def window(data, s, start, days):
    """صرف وليدز يومي متوسط للهدف بين start و start+days."""
    ads, end = data.get("ads") or {}, (start + timedelta(days=days)).isoformat()
    st = start.isoformat()
    if s["level"] == "campaign":
        keys = {k for k, a in ads.items() if a.get("campaign") == s.get("target_id") and k[0] == PRE.get(s["platform"])}
    else:
        keys = {k for k in ads if base_key(k) == PRE.get(s["platform"], "") + str(s["target_id"])}
    sp = ld = 0.0
    for k, d, spend, im, cl, leads, *_ in data.get("rows") or []:
        if k in keys and st <= d < end:
            sp += spend; ld += leads
    return {"spend_day": round(sp / days, 2), "leads_day": round(ld / days, 2), "cpl": round(sp / ld, 2) if ld else None}


def measure(data, s, day, today):
    decided = date.fromisoformat(str(s["decided_at"])[:10])
    if (today - decided).days < day:
        return None
    before = window(data, s, decided - timedelta(days=7), 7)
    after = window(data, s, decided, day)
    vs = {}
    if before["cpl"] and after["cpl"]:
        vs["cpl_change_pct"] = round(100 * (after["cpl"] - before["cpl"]) / before["cpl"], 1)
    if before["spend_day"]:
        vs["spend_change_pct"] = round(100 * (after["spend_day"] - before["spend_day"]) / before["spend_day"], 1)
    return {"suggestion_id": s["id"], "day": day, "metrics": {"before": before, "after": after, "decision": s["status"]}, "vs_expect": vs}


def main():
    db = Supa.from_env()
    if not db:
        print("outcomes: بدون Supabase")
        return
    try:
        data, today = load_data(), date.today()
        since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        decided = db.req("/rest/v1/suggestions?select=id,platform,level,target_id,kind,status,decided_at&status=in.(approved,modified,rejected,executed)&decided_at=gte." + urllib.parse.quote(since) + "&limit=1000") or []
        have = {(o["suggestion_id"], o["day"]) for o in (db.req("/rest/v1/outcomes?select=suggestion_id,day&limit=5000") or [])}
        new = [m for s in decided for day in (3, 7) if (s["id"], day) not in have for m in [measure(data, s, day, today)] if m]
        if new:
            db.req("/rest/v1/outcomes?on_conflict=suggestion_id,day", "POST", new, "return=minimal,resolution=ignore-duplicates")
        print(f"outcomes: {len(new)} نتيجة جديدة")
    except Exception as ex:
        print("outcomes: ما اشتغل —", str(ex)[:200], file=sys.stderr)


if __name__ == "__main__":
    main()
