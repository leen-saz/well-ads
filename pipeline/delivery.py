"""طبقة التسليم: هل الإعلان فعلاً يصرف؟ الحكم يجي مباشرة من حقول المنصة نفسها، ولا شي يُخمَّن.

`live` يبقى «مفعّل بالمفتاح» كما تحسبه fetch_data (لوحة القرار وقواعد الباير تقرأه) وهذي الطبقة ما تلمسه أبداً.

الحقول على كل إعلان في dash.json:
  delivery                  delivering | rejected | in_review | scheduled | ended | budget | off | unknown
  delivery_reason           سبب قصير من مجموعة ثابتة (REASON)، أو كلمة حالة المنصة لـ off
  delivery_days_no_spend    معلومة ثانوية فقط: مفعّل وما سجّل صرف ولا ظهور آخر 3 أيام (عدد الأيام منذ آخر صرف، أو 3 إذا ما فيه
                            أي صرف مسجّل). لا تغيّر الحكم أبداً: إعلان تقول المنصة إنه delivering يبقى delivering
  fresh_at                  وقت إنشاء/تفعيل الإعلان إذا خلال آخر 48 ساعة (يعفيه 24 ساعة من الملاحظة الثانوية)

الحكم (دوال *_state، نقية بلا شبكة، ترجع (delivery, reason)):
  unknown = حقل المنصة اللازم للحكم ما انسحب لهذا الإعلان. ليس تخميناً وليس off.

Meta   ad.effective_status: DISAPPROVED→rejected، PENDING_REVIEW/IN_PROCESS→in_review، PREAPPROVED→scheduled،
       ACTIVE→(adset.effective_status وcampaign.effective_status لازم ACTIVE وإلا off)، ثم adset/campaign start_time>الآن→scheduled،
       end_time/stop_time<الآن→ended، ميزانية مدى الحياة lifetime_budget>0 وbudget_remaining<=0→budget، وإلا delivering.
       غير ذلك (PAUSED، ADSET_PAUSED، CAMPAIGN_PAUSED، WITH_ISSUES، ARCHIVED، DELETED...)→off.
Snap   ad.review_status: REJECTED→rejected، PENDING_REVIEW→in_review. ثم ad/adsquad/campaign.status لازم ACTIVE وإلا off،
       adsquad ثم campaign start_time>الآن→scheduled وend_time<الآن→ended، وإلا delivering.
TikTok ad.secondary_status: AD_STATUS_DELIVERY_OK→delivering، AUDIT/REAUDIT→in_review، AUDIT_DENY/REAUDIT_DENY/PARTIAL_AUDIT_DENY→rejected،
       NOT_START/SCHEDULE_NOT_START→scheduled، DONE/SCHEDULE_DONE/TIME_DONE→ended، BUDGET_EXCEED/CAMPAIGN_EXCEED→budget،
       *_DISABLE/*_DELETE/BALANCE_EXCEED→off. أي قيمة ثانية أو فاضية→unknown. جدولة المجموعة (schedule_*_time) تؤكد فقط.
Google ad_group_ad.policy_summary.approval_status: DISAPPROVED→rejected. campaign.primary_status: ENDED→ended، PENDING→scheduled،
       PAUSED/REMOVED→off، ELIGIBLE/LIMITED/LEARNING→delivering (LIMITED تعني يصرف بقيود)، NOT_ELIGIBLE→من campaign.primary_status_reasons
       (ENDED/PENDING/DISAPPROVED/UNDER_REVIEW/BUDGET)، MISCONFIGURED أو سبب غير مقروء→unknown. ad_group_ad.primary_status PAUSED/REMOVED→off،
       PENDING→in_review.
"""
from datetime import datetime, timedelta, timezone

RIYADH = timezone(timedelta(hours=3))
WINDOW_DAYS = 3          # اليوم + اليومان قبله = آخر 72 ساعة من البيانات اليومية (للملاحظة الثانوية فقط)
YOUNG_HOURS = 24
KEEP_FRESH_HOURS = 48

STATES = ("delivering", "rejected", "in_review", "scheduled", "ended", "budget", "off", "unknown")
# مجموعة ثابتة من الأسباب (تُترجم كلها في جدول الترجمة، لا نص حر)
REASON = {
    "rejected": "مرفوض من المنصة",
    "in_review": "قيد المراجعة عند المنصة",
    "scheduled": "مجدول ولم يبدأ بعد",
    "ended": "انتهت مدة الجدولة",
    "budget": "الميزانية خلصت",
    "unknown": "ما قدرنا نقرأ الحالة من المنصة",
}
UNKNOWN = ("unknown", REASON["unknown"])
DELIVERING = ("delivering", "")
OFF = ("off", "")


def parse_time(value, assume=RIYADH):
    """يقبل صيَغ المنصات: 2026-11-20T00:00:00+0300 (ميتا)، ...000Z (سناب)، 2026-11-20 00:00:00 (تيك توك)، 2026-11-20."""
    if not value or not isinstance(value, str):
        return None
    s = value.strip().replace("Z", "+0000")
    if len(s) > 5 and s[-3] == ":" and s[-6] in "+-":
        s = s[:-3] + s[-2:]
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S",
                "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            d = datetime.strptime(s, fmt)
        except ValueError:
            continue
        return d if d.tzinfo else d.replace(tzinfo=assume)
    return None


def _window(start, end, now):
    """scheduled إذا البداية بالمستقبل، ended إذا النهاية فاتت. None إذا ما فيه شيء."""
    s, e = parse_time(start), parse_time(end)
    if s and s > now:
        return "scheduled"
    if e and e < now:
        return "ended"
    return None


def _first(*states):
    return next((s for s in states if s), None)


def _v(state):
    return (state, REASON.get(state, ""))


def fresh_from(*times, now):
    """أحدث وقت (إنشاء أو تعديل) إذا كان خلال KEEP_FRESH_HOURS، كنص ISO، وإلا None."""
    best = max([t for t in (parse_time(x) for x in times) if t], default=None)
    if best and now - best <= timedelta(hours=KEEP_FRESH_HOURS) and best <= now + timedelta(hours=1):
        return best.astimezone(RIYADH).isoformat(timespec="seconds")
    return None


def meta_state(a, now):
    """a = إعلان ميتا من Graph (ad.effective_status وadset/campaign effective_status وstart_time/end_time(stop_time) والميزانية)."""
    st = a.get("effective_status") or ""
    adset, camp = a.get("adset") or {}, a.get("campaign") or {}
    if not st:
        return UNKNOWN
    if st == "DISAPPROVED":
        return _v("rejected")
    if st in ("PENDING_REVIEW", "IN_PROCESS"):
        return _v("in_review")
    if st == "PREAPPROVED":
        return _v("scheduled")
    if st != "ACTIVE":
        return OFF
    for node in (adset, camp):
        s = node.get("effective_status")
        if not s:
            return UNKNOWN
        if s != "ACTIVE":
            return OFF
    if "start_time" not in adset and "start_time" not in camp:
        return UNKNOWN   # the schedule fields did not come back: ACTIVE alone does not prove it has started
    sched = _first(_window(adset.get("start_time"), adset.get("end_time"), now),
                   _window(camp.get("start_time"), camp.get("stop_time"), now))
    if sched:
        return _v(sched)
    for node in (adset, camp):
        # ميزانية مدى الحياة وخلصت. الميزانية اليومية تتجدد، فصفرها لا يعني توقف
        try:
            if float(node.get("lifetime_budget") or 0) > 0 and "budget_remaining" in node and float(node.get("budget_remaining") or 0) <= 0:
                return _v("budget")
        except (TypeError, ValueError):
            return UNKNOWN
    return DELIVERING


def snap_state(ad, squad, camp, now):
    """ad.review_status وad/adsquad/campaign.status وstart_time/end_time للمجموعة ثم الحملة."""
    review = ad.get("review_status")
    if not review:
        return UNKNOWN
    if review == "REJECTED":
        return _v("rejected")
    if review == "PENDING_REVIEW":
        return _v("in_review")
    statuses = [ad.get("status"), (squad or {}).get("status"), (camp or {}).get("status")]
    if not all(statuses):
        return UNKNOWN
    if any(s != "ACTIVE" for s in statuses):
        return OFF
    sched = _first(_window((squad or {}).get("start_time"), (squad or {}).get("end_time"), now),
                   _window((camp or {}).get("start_time"), (camp or {}).get("end_time"), now))
    return _v(sched) if sched else DELIVERING


TT_STATUS = {
    "AD_STATUS_DELIVERY_OK": "delivering",
    "AD_STATUS_AUDIT": "in_review", "AD_STATUS_REAUDIT": "in_review",
    "AD_STATUS_AUDIT_DENY": "rejected", "AD_STATUS_REAUDIT_DENY": "rejected", "AD_STATUS_PARTIAL_AUDIT_DENY": "rejected",
    "AD_STATUS_NOT_START": "scheduled", "AD_STATUS_SCHEDULE_NOT_START": "scheduled",
    "AD_STATUS_DONE": "ended", "AD_STATUS_SCHEDULE_DONE": "ended", "AD_STATUS_TIME_DONE": "ended",
    "AD_STATUS_BUDGET_EXCEED": "budget", "AD_STATUS_CAMPAIGN_EXCEED": "budget",
    "AD_STATUS_DISABLE": "off", "AD_STATUS_CAMPAIGN_DISABLE": "off", "AD_STATUS_ADGROUP_DISABLE": "off",
    "AD_STATUS_DELETE": "off", "AD_STATUS_CAMPAIGN_DELETE": "off", "AD_STATUS_ADGROUP_DELETE": "off",
    "AD_STATUS_BALANCE_EXCEED": "off",   # billing state: never shown, same as the status word (STATUS_AR)
}


def tiktok_state(x, group, now):
    """x.secondary_status هو الحكم. جدولة المجموعة تؤكد فقط: delivering مع نهاية جدولة فاتت يصير ended."""
    hit = TT_STATUS.get(x.get("secondary_status") or "")
    if not hit:
        return UNKNOWN
    if hit == "delivering":
        sched = _window((group or {}).get("schedule_start_time"), (group or {}).get("schedule_end_time"), now)
        if sched:
            return _v(sched)
        return DELIVERING
    return OFF if hit == "off" else _v(hit)


def google_state(approval, ad_primary, camp_primary, camp_reasons):
    """approval = ad_group_ad.policy_summary.approval_status، ad_primary = ad_group_ad.primary_status،
    camp_primary وcamp_reasons = campaign.primary_status وcampaign.primary_status_reasons (قائمة)."""
    if not camp_primary:
        return UNKNOWN
    if approval == "DISAPPROVED":
        return _v("rejected")
    if camp_primary == "ENDED":
        return _v("ended")
    if camp_primary == "PENDING":
        return _v("scheduled")
    if camp_primary in ("PAUSED", "REMOVED") or ad_primary in ("PAUSED", "REMOVED"):
        return OFF
    if ad_primary == "PENDING":
        return _v("in_review")
    if camp_primary in ("ELIGIBLE", "LIMITED", "LEARNING"):
        return DELIVERING
    if camp_primary == "NOT_ELIGIBLE":
        text = " ".join(camp_reasons or [])
        for needle, state in (("ENDED", "ended"), ("PENDING", "scheduled"), ("DISAPPROVED", "rejected"),
                              ("UNDER_REVIEW", "in_review"), ("BUDGET", "budget")):
            if needle in text:
                return _v(state)
    return UNKNOWN


def stamp(ad, state, fresh=None):
    """يكتب نتيجة المنصة على الإعلان. لا يلمس live ولا status."""
    delivery, reason = state
    ad["delivery"] = delivery
    ad["delivery_reason"] = reason
    if fresh:
        ad["fresh_at"] = fresh
    return ad


def guarded(ad, state_fn, fresh_fn=None):
    """يكتب حقول التسليم ولا يرمي أبداً: أي خطأ = unknown، ولا يلمس live ولا status ولا وجود الإعلان.
    طبقة التسليم إضافة، ما تكسر السحب."""
    import sys
    try:
        state = state_fn()
        fresh = fresh_fn() if fresh_fn else None
    except Exception as ex:  # noqa: BLE001
        print("delivery: تعذر حساب حالة التسليم، الحالة غير معروفة —", type(ex).__name__, str(ex)[:80], file=sys.stderr)
        state, fresh = UNKNOWN, None
    try:
        return stamp(ad, state, fresh)
    except Exception:  # noqa: BLE001
        return ad


def _base(key):
    return str(key).split("|", 1)[0]


def activity(rows):
    """{أساس المفتاح: آخر يوم فيه صرف أو ظهور}. مواضع إعلان ميتا الواحد تُجمع."""
    last = {}
    for r in rows:
        if (r[2] or r[3]) and r[1] > last.get(_base(r[0]), ""):
            last[_base(r[0])] = r[1]
    return last


def finalize(ads, rows, now, prev_ads=None, ok_prefixes=("m", "g", "s", "t")):
    """بعد دمج الأرقام. تعدّل ads في مكانها وترجع عدّاد الحالات. لا تغيّر live أبداً، ولا تقرر الحكم من الصرف.
    - إعلان بلا delivery (قديم أو من نسخة سابقة): غير مفعّل→off، مفعّل→unknown.
    - حكم سابق مخزّن لإعلان صار غير مفعّل (carry_forward): delivering/scheduled/ended/budget/unknown تصير off؛ rejected/in_review تبقى.
    - الملاحظة الثانوية delivery_days_no_spend: مفعّل وبلا صرف ولا ظهور من today-2 إلى today، لمنصة سحبها ناجح وإلا تبقى
      كما كانت. الإعلان الأقل من 24 ساعة معفى. ما تغيّر delivery."""
    today = now.astimezone(RIYADH).strftime("%Y-%m-%d")
    since = (now.astimezone(RIYADH) - timedelta(days=WINDOW_DAYS - 1)).strftime("%Y-%m-%d")
    last = activity(rows)
    prev = prev_ads or {}
    counts = {}
    for key, ad in ads.items():
        if not isinstance(ad, dict):
            continue
        for legacy in ("delivery_fb", "delivery_days"):
            ad.pop(legacy, None)
        if prev and key not in prev and not ad.get("fresh_at"):
            ad["fresh_at"] = now.astimezone(RIYADH).isoformat(timespec="seconds")   # أول مرة نشوفه
        d = ad.get("delivery")
        if d not in STATES:
            d = "unknown" if ad.get("live") else "off"
            ad["delivery"], ad["delivery_reason"] = d, (REASON["unknown"] if d == "unknown" else "")
        elif not ad.get("live") and d not in ("rejected", "in_review", "off"):
            ad["delivery"], ad["delivery_reason"] = "off", ""
        if ad["delivery"] == "off" and not ad.get("delivery_reason"):
            ad["delivery_reason"] = ad.get("status") or ""
        if key[:1] in ok_prefixes:
            f = parse_time(ad.get("fresh_at"))
            young = bool(f and now - f <= timedelta(hours=YOUNG_HOURS))
            la = last.get(_base(key), "")
            if ad.get("live") and not young and la < since:
                ad["delivery_days_no_spend"] = (datetime.strptime(today, "%Y-%m-%d") - datetime.strptime(la, "%Y-%m-%d")).days if la else WINDOW_DAYS
            else:
                ad.pop("delivery_days_no_spend", None)
        f = parse_time(ad.get("fresh_at"))
        if ad.get("fresh_at") and (not f or now - f > timedelta(hours=KEEP_FRESH_HOURS)):
            ad.pop("fresh_at", None)
        counts[ad["delivery"]] = counts.get(ad["delivery"], 0) + 1
    return counts
