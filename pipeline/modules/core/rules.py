"""قواعد لين الثابتة. أي اقتراح أو تنفيذ يتحقق منها هنا، وما تتغيّر إلا بـ PR توافق عليه لين.

المصدر: WELL_media_buying_CLAUDE.md (قواعد لين) وقرارات 28 أكتوبر 2026.
"""
from datetime import date

MIN_DAYS_BEFORE_PAUSE = 3          # ما فيه إيقاف قبل 3 أيام من تشغيل الحملة أو الإعلان
MAX_BUDGET_CHANGE_PCT = 20         # أقصى رفع أو تنزيل ميزانية بخطوة وحدة (قاعدة +20%)
KILL_MULTIPLIER = 2.0              # قاعدة الإيقاف #56: صرف ≥ ضعف تكلفة الليد المستهدفة بدون نتيجة
ALLOWED_OBJECTIVES = {"lead", "sales"}   # Sales أو Leads بس، أبد مو Traffic
FORBIDDEN_OBJECTIVES = {"traffic"}
GEO = "الرياض بس (ميتا: نصف قطر 10 ميل)"
AGE_MIN, AGE_MAX = 30, None        # 30–50+ (بدون حد أعلى)
NO_ADVANTAGE_PLUS = True           # بدون Smart audience / Advantage+ / توسيع تلقائي
NEW_CAMPAIGN_NEEDS_LEEN = True     # أي حملة جديدة تحتاج موافقة لين، حتى في Auto
HIDE_AD_CODES_FROM_CLIENT = True   # أكواد الإعلانات ما تطلع للعميل

KINDS = {
    "pause": {"write": True, "reversal": "resume"},
    "resume": {"write": True, "reversal": "pause"},
    "pause_campaign": {"write": True, "reversal": "resume_campaign"},
    "budget_up": {"write": True, "reversal": "budget_down"},
    "budget_down": {"write": True, "reversal": "budget_up"},
    "refresh_creative": {"write": False, "reversal": None},   # شغل برودكشن، ما يلمس المنصة
    "new_campaign": {"write": True, "reversal": "pause_campaign"},
}


def days_running(first_day, today):
    if not first_day:
        return None
    return (date.fromisoformat(str(today)[:10]) - date.fromisoformat(str(first_day)[:10])).days


def check(s, today):
    """يرجع قائمة مخالفات الاقتراح لقواعد لين (فاضية = سليم)."""
    bad = []
    kind, params, ev = s.get("kind"), s.get("params") or {}, s.get("evidence") or {}
    if kind not in KINDS:
        bad.append(f"نوع غير معروف: {kind}")
        return bad
    if kind in ("pause", "pause_campaign") and s.get("evidence", {}).get("objective") not in FORBIDDEN_OBJECTIVES:
        d = days_running(ev.get("first_day"), today)
        if d is None:
            bad.append("ما نعرف متى اشتغل، فما نوقفه")
        elif d < MIN_DAYS_BEFORE_PAUSE:
            bad.append(f"اشتغل من {d} يوم بس، والإيقاف ما يصير قبل {MIN_DAYS_BEFORE_PAUSE} أيام")
    if kind in ("budget_up", "budget_down"):
        pct = params.get("pct")
        if not isinstance(pct, (int, float)) or pct <= 0:
            bad.append("نسبة تغيير الميزانية ناقصة")
        elif pct > MAX_BUDGET_CHANGE_PCT:
            bad.append(f"تغيير الميزانية {pct}% أكبر من الحد {MAX_BUDGET_CHANGE_PCT}%")
    if kind == "new_campaign":
        if params.get("objective") in FORBIDDEN_OBJECTIVES or (params.get("objective") and params.get("objective") not in ALLOWED_OBJECTIVES):
            bad.append("الهدف لازم Sales أو Leads")
        if params.get("advantage_plus"):
            bad.append("بدون Advantage+")
        if params.get("age_min") is not None and params["age_min"] < AGE_MIN:
            bad.append(f"العمر يبدأ من {AGE_MIN}")
    return bad


def needs_leen(s):
    """الحملة الجديدة دايماً تحتاج موافقة لين، حتى في Auto."""
    return s.get("kind") == "new_campaign" and NEW_CAMPAIGN_NEEDS_LEEN
