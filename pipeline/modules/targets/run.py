"""الأهداف لكل منصة: تكلفة الليد (cpl) وتكلفة المحادثة (chat). المكتوبة في config/targets.json، وإذا null نرجع لمتوسط آخر 30 يوم.
كل هدف يرجع معه مصدره (written أو avg30) عشان يبان في لوحة القرارات."""
import json, os
from collections import defaultdict
from datetime import date, timedelta

from modules.core import ROOT, platform_of


def written():
    try:
        cfg = json.load(open(os.path.join(ROOT, "config", "targets.json"), encoding="utf-8"))
    except FileNotFoundError:
        return {}
    return {p: v for p, v in cfg.items() if not p.startswith("_") and isinstance(v, dict)}


def compute(data, today=None):
    """{platform: {"cpl", "source", "chat", "chat_source"}}: الرقم float|None، والمصدر "written"|"avg30"|None"""
    ads, rows = data.get("ads") or {}, data.get("rows") or []
    today = date.fromisoformat(today or (data.get("range") or {}).get("today") or date.today().isoformat())
    d30 = (today - timedelta(days=30)).isoformat()
    acc, chats = defaultdict(lambda: [0.0, 0.0]), defaultdict(lambda: [0.0, 0.0])
    for k, day, sp, im, cl, ld, *rest in rows:
        a = ads.get(k)
        if not a or day < d30:
            continue
        if a.get("goal") == "lead":
            x = acc[platform_of(k)]; x[0] += sp; x[1] += ld
        elif a.get("goal") == "messages":
            x = chats[platform_of(k)]; x[0] += sp; x[1] += (rest[0] if rest else 0) or 0
    out = {}
    w = written()
    for p in ("meta", "snap", "tiktok", "google"):
        out[p] = {}
        for key, src, a in (("cpl", "source", acc[p]), ("chat", "chat_source", chats[p])):
            v = (w.get(p) or {}).get(key)
            if isinstance(v, (int, float)) and v > 0:
                out[p][key], out[p][src] = float(v), "written"
            elif a[1]:
                out[p][key], out[p][src] = a[0] / a[1], "avg30"
            else:
                out[p][key], out[p][src] = None, None
    return out
