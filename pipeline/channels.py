"""تقسيم المنصات: فيسبوك/إنستغرام من publisher_platform، وجوجل من نوع الحملة.

مفاتيح الإعلان تبقى تبدأ بـ m/g/s/t حتى يشتغل التحديث الجزئي كما هو.
"""
import re

META_PLACEMENTS = ("facebook", "instagram", "messenger", "audience_network", "threads")

# ترتيب العرض. الألوان من لوحة وِل (تدرجات الشفافية مسموحة، بدون ألوان جديدة).
_PLATFORMS = {
    "facebook": {"ar": "فيسبوك", "family": "meta", "color": "--s-fb"},
    "instagram": {"ar": "إنستغرام", "family": "meta", "color": "--s-ig"},
    "messenger": {"ar": "ماسنجر", "family": "meta", "color": "--s-msg"},
    "audience_network": {"ar": "شبكة الجمهور", "family": "meta", "color": "--s-an"},
    "threads": {"ar": "ثريدز", "family": "meta", "color": "--s-threads"},
    "meta": {"ar": "ميتا", "family": "meta", "color": "--s-meta"},
    "snap": {"ar": "سناب شات", "family": "snap", "color": "--s-snap"},
    "tiktok": {"ar": "تيك توك", "family": "tiktok", "color": "--s-tiktok"},
    "google_search": {"ar": "جوجل · بحث", "family": "google", "color": "--s-gs"},
    "google_pmax": {"ar": "جوجل · أداء أقصى", "family": "google", "color": "--s-gp"},
    "google_display": {"ar": "جوجل · شبكة العرض", "family": "google", "color": "--s-gd"},
    "google_video": {"ar": "جوجل · يوتيوب", "family": "google", "color": "--s-gv"},
    "google_demand_gen": {"ar": "جوجل · توليد الطلب", "family": "google", "color": "--s-gg"},
    "google_shopping": {"ar": "جوجل · تسوق", "family": "google", "color": "--s-gsh"},
    "google_app": {"ar": "جوجل · تطبيقات", "family": "google", "color": "--s-ga"},
    "google_smart": {"ar": "جوجل · ذكي", "family": "google", "color": "--s-google"},
    "google_local": {"ar": "جوجل · محلي", "family": "google", "color": "--s-google"},
    "google_hotel": {"ar": "جوجل · فنادق", "family": "google", "color": "--s-google"},
    "google_travel": {"ar": "جوجل · سفر", "family": "google", "color": "--s-google"},
    "google": {"ar": "جوجل", "family": "google", "color": "--s-google"},
}
ORDER = list(_PLATFORMS)

_GOOGLE = {
    "SEARCH": "google_search",
    "DISPLAY": "google_display",
    "VIDEO": "google_video",
    "DEMAND_GEN": "google_demand_gen",
    "DISCOVERY": "google_demand_gen",
    "SHOPPING": "google_shopping",
    "SMART": "google_smart",
    "LOCAL": "google_local",
    "LOCAL_SERVICES": "google_local",
    "HOTEL": "google_hotel",
    "TRAVEL": "google_travel",
}
GOOGLE_FORMAT = {
    "google_search": "بحث نصي",
    "google_video": "فيديو",
    "google_display": "صورة",
    "google_pmax": "أداء أقصى",
    "google_demand_gen": "توليد الطلب",
    "google_shopping": "تسوق",
    "google_app": "تطبيق",
}


def placement_platform(publisher):
    pub = (publisher or "unknown").strip().lower()
    if pub in META_PLACEMENTS:
        return pub
    if pub in ("", "unknown"):
        return "meta"
    safe = re.sub(r"[^a-z0-9]+", "_", pub).strip("_") or "other"
    return "meta_" + safe


def meta_key(ad_id, publisher):
    pub = (publisher or "unknown").strip().lower() or "unknown"
    return f"m{ad_id}|{pub}", placement_platform(pub)


def google_platform(channel, subtype=""):
    ch = (channel or "").upper()
    sub = (subtype or "").upper()
    if ch == "PERFORMANCE_MAX" or sub == "PERFORMANCE_MAX" or "PERFORMANCE_MAX" in sub:
        return "google_pmax"
    if "APP_CAMPAIGN" in sub or (ch == "MULTI_CHANNEL" and "APP" in sub):
        return "google_app"
    if ch == "MULTI_CHANNEL":
        return "google_pmax" if "PERFORMANCE" in sub else "google_app"
    if ch in _GOOGLE:
        return _GOOGLE[ch]
    if not ch:
        return "google"
    safe = re.sub(r"[^a-z0-9]+", "_", ch.lower()).strip("_")
    return "google_" + safe if safe else "google"


def family_of(platform):
    if not platform:
        return ""
    info = _PLATFORMS.get(platform)
    if info:
        return info["family"]
    if platform.startswith("google"):
        return "google"
    if platform.startswith("meta"):
        return "meta"
    return platform


def catalog(extra_ids=()):
    platforms = {k: dict(v) for k, v in _PLATFORMS.items()}
    order = list(ORDER)
    for pid in extra_ids:
        if pid in platforms:
            continue
        platforms[pid] = {"ar": pid, "family": family_of(pid), "color": "--s-google" if family_of(pid) == "google" else "--s-meta"}
        order.append(pid)
    return {"order": order, "platforms": platforms}


def annotate(ads):
    """يضيف family لأي إعلان، ويرجع كتالوج القنوات الموجود فعلاً."""
    ids = []
    for ad in ads.values():
        p = ad.get("platform") or ""
        ad["family"] = family_of(p)
        if p and p not in _PLATFORMS and p not in ids:
            ids.append(p)
    return catalog(ids)
