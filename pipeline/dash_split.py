"""dash.json للوحة الرئيسية بدون الأجزاء الثقيلة اللي ما تطلع في أول رسم: تفاصيل المشاهدين لكل إعلان (aud، 80 KB)
والعضوي (organic، 56 KB). تنحفظ في dash-aud.json وdash-organic.json وتتحمّل بعد أول رسم (pipeline/dash/01-base.js).
صفحات الأقسام والكرييتف والملف المستقل تبقى ببياناتها كاملة داخل الصفحة. الأرقام نفسها، بس مقسومة على ملفات."""
import copy

EXTRA = ["aud", "organic"]


def rows_cols(rows):
    """الصفوف عمود عمود: k = مفاتيح الإعلانات، d = الأيام، c = سبعة أعمدة (رقم المفتاح، رقم اليوم، والخمسة أرقام كما هي).
    نفس الترتيب ونفس القيم؛ Brotli يضغطها أصغر بربع تقريباً لأن المفتاح والتاريخ ما يتكررون نص في كل صف.
    ترجع صفوف بنفس الشكل في decodeRows (pipeline/dash/01-base.js وsrc/modules/overview/useDash.ts)."""
    keys = sorted({r[0] for r in rows})
    days = sorted({r[1] for r in rows})
    ki = {k: i for i, k in enumerate(keys)}
    di = {d: i for i, d in enumerate(days)}
    cols = [[ki[r[0]] for r in rows], [di[r[1]] for r in rows]]
    for j in range(2, 7):
        cols.append([r[j] for r in rows])
    return {"k": keys, "d": days, "c": cols}


def decode_rows(rc):
    """عكس rows_cols (للاختبار، ونفس منطق decodeRows في الصفحة)."""
    k, d, c = rc["k"], rc["d"], rc["c"]
    return [[k[c[0][i]], d[c[1][i]]] + [c[j][i] for j in range(2, 7)] for i in range(len(c[0]))]


def split(data):
    """(main, aud, organic): main = data بدون aud في كل إعلان وبدون organic، وفيه extra يقول وش ينقص،
    والصفوف عمود عمود في rows_cols بدل rows."""
    main = copy.copy(data)
    ads, aud = {}, {}
    for k, ad in (data.get("ads") or {}).items():
        if isinstance(ad, dict) and "aud" in ad:
            ad = dict(ad)
            aud[k] = ad.pop("aud")
        ads[k] = ad
    main["ads"] = ads
    organic = main.pop("organic", None)
    main["extra"] = EXTRA
    rows = main.pop("rows", None)
    if rows is not None:
        main["rows_cols"] = rows_cols(rows)
    return main, aud, organic
