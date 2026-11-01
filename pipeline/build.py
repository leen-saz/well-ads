#!/usr/bin/env python3
"""يدمج data.json داخل لوحة واحدة.
المخرجات:
  well-ads-dashboard.html   نسخة Claude Artifact
  web/public/index.html     اللوحة على / (الإعلانات افتراضياً، العضوي عبر ?mode=organic)
  web/public/organic/       تحويل إلى /?mode=organic
  /creative                 تحويل إلى /?view=creative (الكرييتف فقط)
  web/vercel.json           ترويسات الأمان مع بصمة السكربت (CSP)"""
import base64, hashlib, json, os, re
from channels import annotate
from classify import apply_all, public_config, relabel_posts
from media import enrich
from organic import pending_shell, visible_facebook
from tiktok.merge import without_spring_rose
HERE = os.path.dirname(os.path.abspath(__file__))
_BILLING = re.compile(r"رصيد|سداد|مستحق|شحن|فوتر|فاتور|billing|unpaid|top-?up|payment|account balance", re.I)

def scrub_status(status):
    """يخفي أي نص حالة فيه رصيد أو سداد أو شحن قبل ما يننشر في الصفحة."""
    text = str(status or "")
    text = text.replace("ميزانية الحساب أو الحملة خلصت", "حد صرف الحملة خلص")
    text = text.replace("ميزانية المجموعة خلصت", "حد صرف المجموعة خلص")
    if _BILLING.search(text):
        return "متوقف"
    return text

data = without_spring_rose(json.load(open(os.path.join(HERE, "data.json"), encoding="utf-8")))
# CRM leads matched to ads (closings, revenue, ROAS on the dashboard). Skipped without Supabase.
from crm.join import attach_from_db
attach_from_db(data)
for plat in (data.get("platforms") or {}).values():
    if isinstance(plat, dict):
        for k in ("balance", "disable_reason", "account_status", "currency"):
            plat.pop(k, None)
for ad in (data.get("ads") or {}).values():
    if isinstance(ad, dict) and ad.get("status"):
        ad["status"] = scrub_status(ad["status"])
before, after = enrich(data)
for ad in (data.get("ads") or {}).values():
    if isinstance(ad, dict) and ad.get("status"):
        ad["status"] = scrub_status(ad["status"])
print("معاينات قبل", before)
print("معاينات بعد", after)
apply_all(data.get("ads") or {})
data["channels"] = annotate(data.get("ads") or {})
data["departments"] = public_config()
if not data.get("organic"):
    data["organic"] = pending_shell()
else:
    relabel_posts(data["organic"])
    data["organic"]["facebook"] = visible_facebook(data["organic"].get("facebook"))
# الصور تطلع من الصفحة لملفات مستقلة تحت /thumbs/ (اسمها بصمة محتواها، وتنحفظ في المتصفح).
# الصفحة تنزل من حوالي 4 ميقا لأقل بكثير، والصور تنزل وقت ما تظهر بس (loading=lazy). تمر على بوابة الدخول.
import base64, shutil
THUMBS = os.path.join(HERE, "web", "public", "thumbs")
shutil.rmtree(THUMBS, ignore_errors=True)
os.makedirs(THUMBS, exist_ok=True)
_EXT = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif"}
def externalize(item):
    t = item.get("thumb") if isinstance(item, dict) else None
    if not (isinstance(t, str) and t.startswith("data:image") and "," in t):
        return
    head, b64 = t.split(",", 1)
    try:
        raw = base64.b64decode(b64)
    except Exception:
        return
    name = hashlib.sha1(raw).hexdigest()[:20] + "." + _EXT.get(head[5:].split(";")[0], "jpg")
    path = os.path.join(THUMBS, name)
    if not os.path.exists(path):
        open(path, "wb").write(raw)
    item["thumb"] = "/thumbs/" + name
for _ad in (data.get("ads") or {}).values():
    externalize(_ad)
from media import organic_posts
for _post in organic_posts(data):
    externalize(_post)
print("صور:", len(os.listdir(THUMBS)), "ملف")
blob = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
tpl = open(os.path.join(HERE, "template.html"), encoding="utf-8").read()
page = tpl.replace("/*__DATA__*/", blob)

# ---- Vercel: one dashboard. /organic/ only redirects into organic mode.
scripts = re.findall(r"<script>(.*?)</script>", page, re.S)
hashes = " ".join(f"'sha256-{base64.b64encode(hashlib.sha256(s.encode()).digest()).decode()}'" for s in scripts)
csp = "; ".join([
    "default-src 'none'",
    f"script-src 'self' {hashes}",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "media-src https: blob: data:",
    "frame-src https://www.tiktok.com https://www.instagram.com https://www.facebook.com",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
])
out = os.path.join(HERE, "well-ads-dashboard.html")
open(out, "w", encoding="utf-8").write(page)
print(out, os.path.getsize(out) // 1024, "KB")

def wrap(fragment):
    return ('<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
            '<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">'
            '<meta http-equiv="Content-Security-Policy" content="' + csp.replace('"', '&quot;') + '">'
            '</head><body>' + fragment + USERBAR + '</body></html>')
# شريط التنقل الموحّد (نفس الروابط في كل الصفحات، حسب صلاحيات اليوزر)
USERBAR = '<script type="module" src="/assets/nav.js"></script>'
public = os.path.join(HERE, "web", "public")
os.makedirs(os.path.join(public, "organic"), exist_ok=True)
open(os.path.join(public, "index.html"), "w", encoding="utf-8").write(wrap(page))
open(os.path.join(public, "organic", "index.html"), "w", encoding="utf-8").write(
    '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">'
    '<meta http-equiv="refresh" content="0;url=/?mode=organic">'
    '<link rel="canonical" href="/?mode=organic">'
    '<title>العضوي</title></head><body>'
    '<p><a href="/?mode=organic">فتح تقرير العضوي</a></p>'
    '</body></html>')
open(os.path.join(HERE, "web", "public", "robots.txt"), "w").write("User-agent: *\nDisallow: /\n")
# بيانات لوحة القرارات: صورة الكرييتف وآخر 14 يوم لكل إعلان عليه اقتراح بس (خفيف).
# يمر على بوابة الدخول لأنه تحت /control/.
def control_data(data):
    import suggest
    from collections import defaultdict
    from datetime import date, timedelta
    ads, rows = data.get("ads") or {}, data.get("rows") or []
    pre = {"meta": "m", "snap": "s", "tiktok": "t", "google": "g"}
    want = {pre[s["platform"]] + str(s["target_id"]) for s in suggest.build(data) if s["level"] == "ad"}
    today = (data.get("range") or {}).get("today") or date.today().isoformat()
    since = (date.fromisoformat(today) - timedelta(days=13)).isoformat()
    out = {}
    for k, a in ads.items():
        b = k.split("|", 1)[0]
        if b not in want:
            continue
        o = out.setdefault(b, {"name": a.get("name"), "campaign": a.get("campaign"), "thumb": None, "open": None, "days": {}, "first": None})
        if not o["thumb"] and str(a.get("thumb") or "").startswith(("data:image", "/thumbs/")):
            o["thumb"] = a["thumb"]
        o["open"] = o["open"] or a.get("preview_url") or a.get("video") or a.get("link")
    for k, d, sp, im, cl, ld, *_ in rows:
        o = out.get(k.split("|", 1)[0])
        if not o:
            continue
        if sp and (not o["first"] or d < o["first"]):
            o["first"] = d
        if d >= since:
            x = o["days"].setdefault(d, [0.0, 0.0]); x[0] += sp; x[1] += ld
    for o in out.values():
        o["days"] = [[d, round(v[0], 2), round(v[1], 2)] for d, v in sorted(o["days"].items())]
    # إعلانات واتساب (ميتا، هدفها محادثات): كم إعلان ثاني شغّال في نفس المجموعة. اللوحة تنبّه إن إيقافها يدوي
    group = defaultdict(set)
    for k, a in ads.items():
        if k[0] == "m" and a.get("live"):
            group[(a.get("campaign"), a.get("group"))].add(k.split("|", 1)[0])
    for b, o in out.items():
        a = next((v for k, v in ads.items() if k.split("|", 1)[0] == b), {})
        if b[0] == "m" and a.get("goal") == "messages":
            o["wa_siblings"] = len(group[(a.get("campaign"), a.get("group"))] - {b})
    return {"generated_at": data.get("generated_at"), "ads": out}
# نسخة لكل قسم: فيها إعلانات القسم وأرقامه بس. مدير القسم ما يوصله غيرها (البوابة تحوّله لها)،
# فبيانات الأقسام الثانية ما تكون موجودة أصلاً في صفحته.
def dept_page(d):
    ads = {k: v for k, v in (data.get("ads") or {}).items() if isinstance(v, dict) and v.get("dept") == d}
    sub = dict(data)
    sub["ads"] = ads
    sub["rows"] = [r for r in (data.get("rows") or []) if r[0] in ads]
    sub["channels"] = annotate(ads)
    cfg = dict(data.get("departments") or {})
    cfg["order"] = [d]
    sub["departments"] = cfg
    sub["organic"] = pending_shell()
    sub["scope"] = {"dept": d}
    return tpl.replace("/*__DATA__*/", json.dumps(sub, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/"))
# نسخة الكرييتف لليوزر اللي ما عنده التحليلات: إعلانات Meta وSnap وTikTok وأرقامها بس، بدون العضوي ولا Google.
def creative_page():
    ads = {k: v for k, v in (data.get("ads") or {}).items() if isinstance(v, dict) and not str(v.get("platform", "")).startswith("google")}
    sub = dict(data)
    sub["ads"] = ads
    sub["rows"] = [r for r in (data.get("rows") or []) if r[0] in ads]
    sub["channels"] = annotate(ads)
    sub["organic"] = pending_shell()
    sub["scope"] = {"view": "creative"}
    return tpl.replace("/*__DATA__*/", json.dumps(sub, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/"))
os.makedirs(os.path.join(public, "c"), exist_ok=True)
open(os.path.join(public, "c", "index.html"), "w", encoding="utf-8").write(wrap(creative_page()))
for d in [k for k in (data.get("departments") or {}).get("order", []) if k != "brand"]:
    os.makedirs(os.path.join(public, "dept", d), exist_ok=True)
    open(os.path.join(public, "dept", d, "index.html"), "w", encoding="utf-8").write(wrap(dept_page(d)))
os.makedirs(os.path.join(public, "control"), exist_ok=True)
json.dump(control_data(data), open(os.path.join(public, "control", "ads.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
headers = [
    {"key": "Content-Security-Policy", "value": csp},
    {"key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains"},
    {"key": "X-Content-Type-Options", "value": "nosniff"},
    {"key": "X-Frame-Options", "value": "DENY"},
    {"key": "Referrer-Policy", "value": "no-referrer"},
    {"key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=(), payment=(), usb=()"},
    {"key": "Cross-Origin-Opener-Policy", "value": "same-origin"},
    {"key": "X-Robots-Tag", "value": "noindex, nofollow"},
    # المتصفح يحتفظ بنسخة ويسأل كل مرة إذا تغيّرت (304 بدل ما ينزل اللوحة كاملة من جديد)
    {"key": "Cache-Control", "value": "private, no-cache"},
]
vercel = {"$schema": "https://openapi.vercel.sh/vercel.json", "framework": None, "buildCommand": "",
          "installCommand": "npm ci --ignore-scripts", "outputDirectory": "public",
          "redirects": [
              {"source": "/organic", "destination": "/?mode=organic", "permanent": False},
              {"source": "/organic/", "destination": "/?mode=organic", "permanent": False},
              {"source": "/creative", "destination": "/?view=creative", "permanent": False},
              {"source": "/creative/", "destination": "/?view=creative", "permanent": False},
          ],
          "headers": [{"source": "/(.*)", "headers": headers},
                      # ملفات الواجهة: المتصفح يتأكد كل مرة إذا تغيّرت (304 سريع)، عشان أي نشر يوصل فوراً
                      {"source": "/assets/(.*)", "headers": [{"key": "Cache-Control", "value": "public, max-age=0, must-revalidate"}]},
                      # الصور: اسمها بصمة محتواها فما تتغيّر أبد. تنحفظ في متصفح اليوزر بس (private) لأنها ورا الدخول
                      {"source": "/thumbs/(.*)", "headers": [{"key": "Cache-Control", "value": "private, max-age=604800, immutable"}]}]}
json.dump(vercel, open(os.path.join(HERE, "web", "vercel.json"), "w"), indent=2)
print("web/public/index.html", os.path.getsize(os.path.join(HERE, "web", "public", "index.html")) // 1024, "KB |", len(scripts), "script hash")
