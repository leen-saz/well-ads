"""يحوّل قواعد لين لاقتراحات. قراءة فقط على حسابات الإعلانات: يكتب اقتراحات في Supabase بس.

كل اقتراح فيه: قبل ← بعد، وتاقات خطر، والتوقّع، وخطة القياس، وخطة التراجع، وبصمة (digest) تربط الموافقة بمحتواه.
القواعد من modules/core/rules.py، والأهداف من modules/targets.
"""
import hashlib, json, os, sys, urllib.parse
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

from modules.core import rules, load_data, enabled
from modules.core.supa import Supa
from modules.targets import run as targets

PLAT = {"m": "meta", "s": "snap", "t": "tiktok", "g": "google"}


def base(key):
    return key.split("|", 1)[0]


def digest(s):
    """بصمة محتوى الاقتراح. لو تغيّر الهدف أو النوع أو القيم، تتغير البصمة وتسقط أي موافقة قديمة."""
    core = {k: s.get(k) for k in ("platform", "level", "target_id", "kind", "params", "after")}
    return hashlib.sha256(json.dumps(core, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:32]


def plan(s):
    """قبل ← بعد، والخطر، والتوقّع، والقياس، والتراجع."""
    k, ev, p = s["kind"], s.get("evidence") or {}, s.get("params") or {}
    sp, ld = ev.get("spend") or 0, ev.get("leads") or 0
    risk = []
    if ev.get("first_day"):
        d = rules.days_running(ev["first_day"], date.today())
        if d is not None and d < 7:
            risk.append("مرحلة تعلّم")
    if k in ("pause", "pause_campaign"):
        s["before"], s["after"] = {"status": "ACTIVE"}, {"status": "PAUSED"}
        s["expect"] = {"save_per_week": round(sp, 2)}
        s["measure_plan"] = "بعد 3 و7 أيام: صرف الحملة ينزل بقيمة هذا الإعلان، والليدز ما تنزل."
        s["reversal_plan"] = "إعادة تشغيل الإعلان من نفس المكان (resume)."
    elif k in ("budget_up", "budget_down"):
        pct = p.get("pct") or 0
        s["before"], s["after"] = {"budget": None, "note": "يتقرا من المنصة وقت التنفيذ"}, {"change_pct": pct if k == "budget_up" else -pct}
        s["expect"] = {"extra_spend_per_week": round(sp * pct / 100, 2), "extra_leads_per_week": round(ld * pct / 100, 1)}
        s["measure_plan"] = "بعد 3 و7 أيام: تكلفة الليد ما تطلع أكثر من 15% فوق قبل الرفع."
        s["reversal_plan"] = f"ترجيع الميزانية للقيمة السابقة (-{pct}%)."
        if ld < 20:
            risk.append("ليدز قليلة")
    else:
        s["before"] = s["after"] = None
        s["expect"] = {}
        s["measure_plan"] = "نسبة النقر للكرييتف الجديد بعد 7 أيام."
        s["reversal_plan"] = "ما يلمس المنصة."
    if sp and ev.get("target_cpl") and sp >= 3 * ev["target_cpl"] * 7:
        risk.append("صرف عالي")
    s["risk"] = risk
    s["revision"] = 1
    s["requested_by"] = "rule:suggest"
    s["digest"] = digest(s)
    return s


def build(data, today=None):
    ads, rows = data.get("ads") or {}, data.get("rows") or []
    today = date.fromisoformat(today or (data.get("range") or {}).get("today") or date.today().isoformat())
    d7, d30 = (today - timedelta(days=7)).isoformat(), (today - timedelta(days=30)).isoformat()
    # الأرقام لكل إعلان (مواضع ميتا مع بعض)
    agg = defaultdict(lambda: {"s7": 0.0, "l7": 0.0, "m7": 0.0, "i7": 0, "c7": 0, "days": set(), "keys": set()})
    plat30 = defaultdict(lambda: [0.0, 0.0])
    camp_live, camp_goal, camp_spend7 = defaultdict(bool), {}, defaultdict(float)
    for k, day, sp, im, cl, ld, *rest in rows:
        a = ads.get(k)
        if not a:
            continue
        cv = (rest[0] if rest else 0) or 0
        b, p = base(k), PLAT.get(k[0])
        x = agg[b]; x["keys"].add(k)
        if sp:
            x["days"].add(day)
        if day >= d7:
            x["s7"] += sp; x["l7"] += ld; x["m7"] += cv; x["i7"] += im; x["c7"] += cl
            camp_spend7[(p, a.get("campaign") or "")] += sp
        if day >= d30 and a.get("goal") == "lead":
            plat30[p][0] += sp; plat30[p][1] += ld
    for a_key, a in ads.items():
        ck = (PLAT.get(a_key[0]), a.get("campaign") or "")
        if a.get("live"):
            camp_live[ck] = True
        camp_goal.setdefault(ck, a.get("goal"))
    tg = targets.compute(data, today.isoformat())
    target = {p: v["cpl"] for p, v in tg.items()}
    target_chat = {p: v.get("chat") for p, v in tg.items()}

    out = []
    def add(p, level, tid, name, campaign, kind, reason, evidence, priority, params=None):
        out.append({"platform": p, "level": level, "target_id": tid, "target_name": name, "campaign": campaign or None, "kind": kind,
                    "params": params or {}, "reason": reason, "evidence": evidence, "priority": priority, "source": "rule"})

    # CTR أول 7 وآخر 7 أيام فيها ظهور (للتعب)
    daily = defaultdict(list)
    for k, day, sp, im, cl, *_ in rows:
        if im:
            daily[base(k)].append((day, im, cl))

    for b, x in agg.items():
        k = sorted(x["keys"])[0]; a = ads[k]; p = PLAT.get(k[0])
        if not a.get("live"):
            continue
        tid = b[1:]
        t = target.get(p)
        first = min(x["days"]) if x["days"] else None
        ev = {"spend": round(x["s7"], 2), "leads": round(x["l7"], 2), "days": 7, "target_cpl": round(t, 2) if t else None,
              "target_source": (tg.get(p) or {}).get("source"), "first_day": first}
        if a.get("goal") == "lead" and t:
            if x["l7"] == 0 and x["s7"] >= rules.KILL_MULTIPLIER * t and (rules.days_running(first, today) or 0) >= rules.MIN_DAYS_BEFORE_PAUSE:
                add(p, "ad", tid, a.get("name"), a.get("campaign"), "pause",
                    f"صرف {x['s7']:.0f} ريال آخر 7 أيام بدون ولا ليد، وهذا ضعف تكلفة الليد المستهدفة ({t:.2f}) أو أكثر.", ev, 90)
            elif x["l7"] >= 10 and x["s7"] / x["l7"] <= 0.8 * t:
                cpl = x["s7"] / x["l7"]
                add(p, "ad", tid, a.get("name"), a.get("campaign"), "budget_up",
                    f"جاب {x['l7']:.0f} ليد آخر 7 أيام بتكلفة {cpl:.2f} ريال، أقل من هدف المنصة ({t:.2f}) بـ {100 - 100 * cpl / t:.0f}%. ارفع ميزانية مجموعته 20%.",
                    {**ev, "cpl": round(cpl, 2)}, 60, {"pct": rules.MAX_BUDGET_CHANGE_PCT, "scope": "adset"})
        tc = target_chat.get(p)
        if a.get("goal") == "messages" and tc:
            # حملات واتساب والرسايل: نفس قاعدة الليدز، بالمحادثات وتكلفة المحادثة
            evc = {**ev, "metric": "chats", "leads": round(x["m7"], 2), "target_cpl": round(tc, 2), "target_source": (tg.get(p) or {}).get("chat_source")}
            if x["m7"] == 0 and x["s7"] >= rules.KILL_MULTIPLIER * tc and (rules.days_running(first, today) or 0) >= rules.MIN_DAYS_BEFORE_PAUSE:
                add(p, "ad", tid, a.get("name"), a.get("campaign"), "pause",
                    f"صرف {x['s7']:.0f} ريال آخر 7 أيام بدون ولا محادثة، وهذا ضعف تكلفة المحادثة المستهدفة ({tc:.2f}) أو أكثر.", evc, 90)
            elif x["m7"] >= 10 and x["s7"] / x["m7"] <= 0.8 * tc:
                cpc = x["s7"] / x["m7"]
                add(p, "ad", tid, a.get("name"), a.get("campaign"), "budget_up",
                    f"جاب {x['m7']:.0f} محادثة آخر 7 أيام بتكلفة {cpc:.2f} ريال، أقل من هدف المنصة ({tc:.2f}) بـ {100 - 100 * cpc / tc:.0f}%. ارفع ميزانية مجموعته 20%.",
                    {**evc, "cpl": round(cpc, 2)}, 60, {"pct": rules.MAX_BUDGET_CHANGE_PCT, "scope": "adset"})
        d = sorted(daily.get(b, []))
        if len(d) >= 14:
            w = lambda xs: (100 * sum(c for _, _, c in xs) / sum(i for _, i, _ in xs)) if sum(i for _, i, _ in xs) >= 1000 else None
            f, l = w(d[:7]), w(d[-7:])
            if f and l is not None and l < 0.7 * f:
                add(p, "ad", tid, a.get("name"), a.get("campaign"), "refresh_creative",
                    f"نسبة النقر نزلت من {f:.2f}% في أول 7 أيام إلى {l:.2f}% آخر 7 أيام. الكرييتف بدأ يتعب، جهّز بديل.",
                    {"ctr": round(l, 2), "ctr_first": round(f, 2), "days": len(d)}, 40)

    for (p, camp), live in camp_live.items():
        if live and camp_goal.get((p, camp)) == "traffic":
            add(p, "campaign", camp, camp, camp, "pause_campaign",
                "حملة هدفها Traffic. القاعدة: الهدف Sales أو Leads بس، أبد مو Traffic.",
                {"spend": round(camp_spend7.get((p, camp), 0), 2), "days": 7, "objective": "traffic"}, 80)
    return [plan(s) for s in out]



REFRESH = ("target_name", "campaign", "params", "reason", "evidence", "priority", "before", "after", "risk", "expect",
           "measure_plan", "reversal_plan", "requested_by", "digest")


def sync(found, db, now=None):
    now = now or datetime.now(timezone.utc)
    sig = lambda s: (s["platform"], str(s["target_id"]), s["kind"])
    open_rows = db.req("/rest/v1/suggestions?select=id,platform,target_id,kind,digest,revision&status=eq.open&limit=5000") or []
    since = (now - timedelta(days=3)).isoformat()
    recent = db.req("/rest/v1/suggestions?select=platform,target_id,kind&status=neq.open&decided_at=gte." + urllib.parse.quote(since) + "&limit=5000") or []
    have, skip, want = {sig(s): s for s in open_rows}, {sig(s) for s in recent}, {sig(s): s for s in found}
    new = [s for k, s in want.items() if k not in have and k not in skip]
    gone = [r["id"] for k, r in have.items() if k not in want]
    # اقتراح مفتوح بدون بصمة (من قبل المرحلة A) أو تغيّر محتواه: نحدّثه ونرجّعه للمراجع
    stale = [(have[k], s) for k, s in want.items() if k in have and have[k].get("digest") != s["digest"]]
    for r, s in stale:
        patch = {f: s.get(f) for f in REFRESH}
        patch["revision"] = (r.get("revision") or 1) + (1 if r.get("digest") else 0)
        patch["critic"] = None
        db.req(f"/rest/v1/suggestions?id=eq.{r['id']}&status=eq.open", "PATCH", patch, "return=minimal")
    if new:
        db.req("/rest/v1/suggestions", "POST", new, "return=minimal")
    for i in gone:
        db.req(f"/rest/v1/suggestions?id=eq.{i}&status=eq.open", "PATCH", {"status": "expired", "decided_at": now.isoformat(), "decided_by": "system"}, "return=minimal")
    return len(new), len(gone), len(have) - len(gone), len(stale)


def main():
    if not enabled("suggest"):
        print("suggest: مقفل في config/modules.json")
        return
    found = build(load_data())
    print("اقتراحات:", len(found), dict(sorted(((k, sum(1 for s in found if s["kind"] == k)) for k in {s["kind"] for s in found}))))
    db = Supa.from_env()
    if not db:
        print("بدون Supabase: ما انكتبت الاقتراحات")
        return
    try:
        n, g, kept, upd = sync(found, db)
        print(f"لوحة القرارات: {n} جديدة | {g} انتهت | {kept} باقية مفتوحة | {upd} تحدّثت")
    except Exception as ex:   # الأعمدة الجديدة ما انضافت بعد، أو القاعدة ما ترد. ما يوقف النشر.
        print("لوحة القرارات: ما انكتبت الاقتراحات —", str(ex)[:200], file=sys.stderr)


if __name__ == "__main__":
    main()
