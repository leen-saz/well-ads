"""تصنيف الأقسام من config/departments.json.

اسم الإعلان أولاً. اسم الحملة احتياط فقط إذا اسم الإعلان بلا إشارة.
"""
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_PATH = os.path.join(HERE, "config", "departments.json")


def load(path=None):
    cfg = json.load(open(path or DEFAULT_PATH, encoding="utf-8"))
    compiled = []
    for s in cfg["signals"]:
        compiled.append({**s, "_re": re.compile(s["pattern"])})
    cfg = {**cfg, "signals": compiled}
    return cfg


def public_config(cfg=None):
    """نسخة تُدمج في الصفحة: بدون الأنماط المُترجمة."""
    cfg = cfg or load()
    return {
        "default": cfg.get("default", "brand"),
        "order": list(cfg.get("order") or []),
        "departments": cfg.get("departments") or {},
        "signals": [{"id": s["id"], "pattern": s["pattern"]} for s in cfg["signals"]],
        "notes": list(cfg.get("notes") or []),
    }


def _hit(cfg, text):
    t = (text or "").lower()
    for s in cfg["signals"]:
        if s["_re"].search(t):
            return s["id"]
    return None


def classify_pair(name, campaign, cfg=None):
    """ترجع (قسم, مصدر) والمصدر ad أو campaign أو default."""
    cfg = cfg or load()
    found = _hit(cfg, name)
    if found:
        return found, "ad"
    found = _hit(cfg, campaign)
    if found:
        return found, "campaign"
    return cfg.get("default", "brand"), "default"


def apply(ad, cfg=None):
    dept, src = classify_pair(ad.get("name"), ad.get("campaign"), cfg)
    ad["dept"] = dept
    ad["dsrc"] = src
    return ad


def apply_all(ads, cfg=None):
    cfg = cfg or load()
    for ad in ads.values():
        apply(ad, cfg)
    return ads


def relabel_posts(organic, cfg=None):
    """يعيد قسم كل منشور من نصه حسب نفس الإعداد."""
    if not organic:
        return organic
    cfg = cfg or load()
    for bucket in ("facebook", "instagram"):
        for page in organic.get(bucket) or []:
            for post in page.get("posts") or []:
                dept, src = classify_pair(post.get("caption") or "", "", cfg)
                post["dept"] = dept
                post["dsrc"] = src
    tt = organic.get("tiktok") or {}
    for post in tt.get("posts") or []:
        dept, src = classify_pair(post.get("caption") or "", "", cfg)
        post["dept"] = dept
        post["dsrc"] = src
    return organic
