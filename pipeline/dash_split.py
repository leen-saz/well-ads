"""dash.json للوحة الرئيسية بدون الأجزاء الثقيلة اللي ما تطلع في أول رسم: تفاصيل المشاهدين لكل إعلان (aud، 80 KB)
والعضوي (organic، 56 KB). تنحفظ في dash-aud.json وdash-organic.json وتتحمّل بعد أول رسم (pipeline/dash/01-base.js).
صفحات الأقسام والكرييتف والملف المستقل تبقى ببياناتها كاملة داخل الصفحة. الأرقام نفسها، بس مقسومة على ملفات."""
import copy

EXTRA = ["aud", "organic"]


def split(data):
    """(main, aud, organic): main = data بدون aud في كل إعلان وبدون organic، وفيه extra يقول وش ينقص."""
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
    return main, aud, organic
