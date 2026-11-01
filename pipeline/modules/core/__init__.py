"""المشترك الوحيد بين الموديولات: المنصات، وقواعد لين، وعميل Supabase، ومفاتيح التشغيل."""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PLATFORMS = ("meta", "snap", "tiktok", "google")
PREFIX = {"m": "meta", "s": "snap", "t": "tiktok", "g": "google"}


def platform_of(key):
    """مفتاح الإعلان في data.json (m123|instagram، s…، t…، g…) ← المنصة."""
    return PREFIX.get(str(key)[:1])


def base_key(key):
    """مواضع ميتا لنفس الإعلان (m123|facebook، m123|instagram) ← m123."""
    return str(key).split("|", 1)[0]


def enabled(name):
    """مفتاح تشغيل الموديول من config/modules.json. الموديول الغايب = مقفل."""
    try:
        return bool(json.load(open(os.path.join(ROOT, "config", "modules.json"), encoding="utf-8")).get(name))
    except FileNotFoundError:
        return False


def load_data(path=None):
    return json.load(open(path or os.path.join(ROOT, "data.json"), encoding="utf-8"))
