"""طبقة التسليم: هل الإعلان فعلاً يصرف؟ `live` يبقى «مفعّل بالمفتاح» ولا يتغير معناه (لوحة القرار وقواعد الباير تقرأه).

الحقول على كل إعلان في dash.json:
  delivery         delivering | no_spend | rejected | in_review | scheduled | ended | budget | off
  delivery_reason  سبب قصير بالعربي (فاضي إذا يصرف وحالة المنصة معروفة)
  delivery_days    لـ no_spend فقط: كم يوم من آخر صرف أو ظهور (غايب إذا ما سجّلنا أي صرف)
  delivery_fb      1 إذا حقل المنصة ما انسحب وحُكم على الإعلان بالصرف الفعلي فقط
  fresh_at         وقت إنشاء الإعلان أو تفعيله إذا كان خلال آخر 48 ساعة (يعفيه 24 ساعة من قاعدة no_spend)

طبقتان: (أ) حقول المنصة (مراجعة، جدولة، ميزانية) في دوال *_state لكل منصة، (ب) قاعدة البيانات `finalize` بعد دمج الأرقام:
مفعّل بلا صرف ولا ظهور آخر 72 ساعة => no_spend. دوال نقية بلا شبكة، فتختبر بملفات ثابتة.
"""
from datetime import datetime, timedelta, timezone

RIYADH = timezone(timedelta(hours=3))
WINDOW_DAYS = 3          # اليوم + اليومان قبله = آخر 72 ساعة من البيانات اليومية
YOUNG_HOURS = 24
KEEP_FRESH_HOURS = 48

STATES = ("delivering", "no_spend", "rejected", "in_review", "scheduled", "ended", "budget", "off")
# مجموعة ثابتة من الأسباب (تُترجم كلها في جدول الترجمة، لا نص حر)
REASON = {
    "rejected": "مرفوض من المنصة",
    "in_review": "قيد المراجعة عند المنصة",
    "scheduled": "مجدول ولم يبدأ بعد",
    "ended": "انتهت مدة الجدولة",
    "budget": "الميزانية خلصت",
    "no_spend": "مفعّل لكن بدون صرف أو ظهور آخر 3 أيام",
    "fallback": "حالة المراجعة والجدولة من المنصة غير متاحة الحين، والحكم من الصرف الفعلي فقط",
}


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


def fresh_from(*times, now):
    """أحدث وقت (إنشاء أو تعديل) إذا كان خلال KEEP_FRESH_HOURS، كنص ISO، وإلا None."""
    best = max([t for t in (parse_time(x) for x in times) if t], default=None)
    if best and now - best <= timedelta(hours=KEEP_FRESH_HOURS) and best <= now + timedelta(hours=1):
        return best.astimezone(RIYADH).isoformat(timespec="seconds")
    return None


def _out(state, known):
    return state, REASON.get(state, ""), known


def meta_state(a, live, now):
    """a = إعلان ميتا من Graph: effective_status وadset{start_time,end_time,lifetime_budget,budget_remaining} وcampaign{...}.
    يرجع (حالة أو None، سبب، معروف). None = المنصة ما ترى مانع (الحكم لقاعدة الصرف)."""
    st = a.get("effective_status") or ""
    adset, camp = a.get("adset") or {}, a.get("campaign") or {}
    known = bool(st) and ("start_time" in adset or "start_time" in camp)   # schedule fields come from a separate optional call
    if st == "DISAPPROVED":
        return _out("rejected", True)
    if st == "PENDING_REVIEW":
        return _out("in_review", True)
    if not live:
        return None, "", known
    sched = _first(_window(adset.get("start_time"), adset.get("end_time"), now),
                   _window(camp.get("start_time"), camp.get("stop_time"), now))
    if sched:
        return _out(sched, True)
    for node in (adset, camp):
        # ميزانية مدى الحياة وخلصت. الميزانية اليومية تتجدد، فصفرها لا يعني توقف
        try:
            if float(node.get("lifetime_budget") or 0) > 0 and float(node.get("budget_remaining") or 0) <= 0 \
                    and "budget_remaining" in node:
                return _out("budget", True)
        except (TypeError, ValueError):
            pass
    return None, "", known


def snap_state(ad, squad, camp, live, now):
    """ad.review_status: REJECTED | PENDING_REVIEW | APPROVED. جدولة المجموعة والحملة من start_time/end_time."""
    review = ad.get("review_status")
    known = bool(review)
    if review == "REJECTED":
        return _out("rejected", True)
    if review == "PENDING_REVIEW":
        return _out("in_review", True)
    if not live:
        return None, "", known
    sched = _first(_window((squad or {}).get("start_time"), (squad or {}).get("end_time"), now),
                   _window((camp or {}).get("start_time"), (camp or {}).get("end_time"), now))
    if sched:
        return _out(sched, True)
    return None, "", known


GOOGLE_NOT_SERVING = {"ENDED": "ended", "PENDING": "scheduled"}


def google_state(approval, ad_primary, camp_primary, camp_serving, live):
    """approval = ad_group_ad.policy_summary.approval_status، والبقية primary_status وserving_status."""
    known = bool(approval or camp_primary or camp_serving)
    if approval == "DISAPPROVED":
        return _out("rejected", True)
    if not live:
        return None, "", known
    for v in (camp_serving, camp_primary):
        if v in GOOGLE_NOT_SERVING:
            return _out(GOOGLE_NOT_SERVING[v], True)
    if ad_primary == "PENDING":
        return _out("in_review", True)
    return None, "", known


TT_STATUS = {
    "AD_STATUS_AUDIT": "in_review", "AD_STATUS_REAUDIT": "in_review", "AD_STATUS_AUDIT_DENY": "rejected",
    "AD_STATUS_REAUDIT_DENY": "rejected",
    "AD_STATUS_SCHEDULE_NOT_START": "scheduled", "AD_STATUS_NOT_START": "scheduled",
    "AD_STATUS_SCHEDULE_DONE": "ended", "AD_STATUS_DONE": "ended",
    "AD_STATUS_BUDGET_EXCEED": "budget", "AD_STATUS_CAMPAIGN_EXCEED": "budget",
}


def tiktok_state(x, group, live, now):
    """x = إعلان ad/get (secondary_status)، group = المجموعة (schedule_start_time/schedule_end_time إن وُجدت)."""
    st = x.get("secondary_status") or ""
    known = bool(st)
    hit = TT_STATUS.get(st)
    if hit in ("rejected", "in_review"):
        return _out(hit, True)
    if not live:
        return None, "", known
    if hit:
        return _out(hit, True)
    sched = _window((group or {}).get("schedule_start_time"), (group or {}).get("schedule_end_time"), now)
    if sched:
        return _out(sched, True)
    return None, "", known


def stamp(ad, state, now_fresh=None):
    """يكتب نتيجة المنصة على الإعلان (finalize يكمل بقاعدة الصرف)."""
    delivery, reason, known = state
    ad["delivery"] = delivery or ("delivering" if ad.get("live") else "off")
    ad["delivery_reason"] = reason
    if not known:
        ad["delivery_fb"] = 1
    else:
        ad.pop("delivery_fb", None)
    if now_fresh:
        ad["fresh_at"] = now_fresh
    return ad


def guarded(ad, state_fn, fresh_fn=None):
    """يكتب حقول التسليم على الإعلان ولا يرمي أبداً: أي خطأ هنا يعني «الحالة غير معروفة» (يحكم الصرف الفعلي)،
    ولا يلمس live ولا status ولا وجود الإعلان. طبقة التسليم إضافة، ما تكسر السحب."""
    import sys
    try:
        state = state_fn()
        fresh = fresh_fn() if fresh_fn else None
    except Exception as ex:  # noqa: BLE001
        print("delivery: تعذر حساب حالة التسليم، نكمل بدونها —", type(ex).__name__, str(ex)[:80], file=sys.stderr)
        state, fresh = (None, "", False), None
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
    """قاعدة البيانات بعد دمج الأرقام. تعدّل ads في مكانها وترجع عدّاد الحالات.
    - المنصة اللي فشل سحبها (مو في ok_prefixes) تبقى حالتها السابقة، لأن صفوفها قديمة وما تصلح للحكم.
    - الحالات اللي أقرتها المنصة (مرفوض، مراجعة، جدولة، انتهى، ميزانية، متوقف) ما تتغير.
    - مفعّل (أو لا يوجد مانع من المنصة) وبلا صرف ولا ظهور من today-2 إلى today => no_spend، إلا الإعلان الجديد أقل من 24 ساعة."""
    today = now.astimezone(RIYADH).strftime("%Y-%m-%d")
    since = (now.astimezone(RIYADH) - timedelta(days=WINDOW_DAYS - 1)).strftime("%Y-%m-%d")
    last = activity(rows)
    prev = prev_ads or {}
    counts = {}
    for key, ad in ads.items():
        if not isinstance(ad, dict):
            continue
        if key[:1] not in ok_prefixes and ad.get("delivery"):
            counts[ad["delivery"]] = counts.get(ad["delivery"], 0) + 1
            continue
        if prev and key not in prev and not ad.get("fresh_at"):
            ad["fresh_at"] = now.astimezone(RIYADH).isoformat(timespec="seconds")   # أول مرة نشوفه
        cur = ad.get("delivery")
        if cur not in (None, "delivering", "no_spend"):
            if cur == "off" and ad.get("live"):
                cur = None   # صار مفعّلاً من آخر سحب
            elif cur == "off" or not ad.get("live") and cur not in ("rejected", "in_review"):
                ad["delivery"] = "off"
                ad["delivery_reason"] = ad.get("delivery_reason") or ad.get("status") or ""
                ad.pop("delivery_days", None)
                counts["off"] = counts.get("off", 0) + 1
                continue
            else:
                ad.pop("delivery_days", None)
                counts[cur] = counts.get(cur, 0) + 1
                continue
        if not ad.get("live"):
            ad["delivery"], ad["delivery_reason"] = "off", ad.get("status") or ""
            ad.pop("delivery_days", None)
        else:
            la = last.get(_base(key), "")
            young = False
            f = parse_time(ad.get("fresh_at"))
            if f and now - f <= timedelta(hours=YOUNG_HOURS):
                young = True
            fb = REASON["fallback"] if ad.get("delivery_fb") else ""
            if la >= since or young:
                ad["delivery"], ad["delivery_reason"] = "delivering", fb
                ad.pop("delivery_days", None)
            else:
                ad["delivery"] = "no_spend"
                ad["delivery_reason"] = REASON["no_spend"] + (" (" + REASON["fallback"] + ")" if fb else "")
                if la:
                    ad["delivery_days"] = (datetime.strptime(today, "%Y-%m-%d") - datetime.strptime(la, "%Y-%m-%d")).days
                else:
                    ad.pop("delivery_days", None)
        f = parse_time(ad.get("fresh_at"))
        if ad.get("fresh_at") and (not f or now - f > timedelta(hours=KEEP_FRESH_HOURS)):
            ad.pop("fresh_at", None)
        counts[ad["delivery"]] = counts.get(ad["delivery"], 0) + 1
    return counts
