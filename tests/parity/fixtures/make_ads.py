"""بيانات وهمية لاختبار التطابق (المرحلة 4.1): 4 منصات وأقسام وأهداف وحالات، 60 يوم، وثابتة (نفس الناتج كل مرة).
    python3 tests/parity/fixtures/make_ads.py > tests/parity/fixtures/ads.json
الريبو public: ما فيها ولا اسم أو رقم حقيقي."""
import json
import random
from datetime import date, timedelta

rnd = random.Random(42)
START, DAYS = date(2026, 8, 23), 60
END = START + timedelta(days=DAYS - 1)
PLATS = [("meta", "m", "facebook"), ("snap", "s", "snap"), ("tiktok", "t", "tiktok"), ("google", "g", "google")]
DEPTS = ["iv", "midwife", "foot", "renan", "brand"]
IDEAS = ["عرض الخريف", "جلسة في البيت", "استشارة مجانية", "باقة العائلة", "قبل وبعد", "سؤال وجواب", "يوم في العيادة", "تجربة أول مرة"]
FORMATS = ["صورة", "فيديو", "كاروسيل"]
SCALE = {"meta": 60, "snap": 35, "tiktok": 25, "google": 20}
CPL = {"meta": 45, "snap": 28, "tiktok": 60, "google": 80}

ads, rows = {}, []
n = 0
for plat, pre, platform in PLATS:
    for i in range(10):
        n += 1
        dept = DEPTS[(n + i) % len(DEPTS)]
        goal = "messages" if plat == "meta" and i % 4 == 0 else "lead"
        live = i % 3 != 2
        key = f"{pre}{1000 + n}"
        ads[key] = {
            "name": f"{IDEAS[(n * 3 + i) % len(IDEAS)]} {i + 1}", "campaign": f"{plat.upper()}_{dept.upper()}_C{i % 3 + 1}",
            "group": f"G{i % 2 + 1}", "platform": platform, "dept": dept, "goal": goal,
            "status": "نشط" if live else "متوقف", "live": live, "format": FORMATS[(n + i) % 3], "text": "",
        }
        # delivery layer examples (no random calls, so the rows stay the same): a few switched-on ads that do not deliver
        if live and i == 3:
            ads[key].update(delivery="delivering", delivery_days_no_spend=4)   # the platform says delivering, no spend for 4 days (a note only)
        elif live and i == 4 and plat == "snap":
            ads[key].update(delivery="rejected", delivery_reason="مرفوض من المنصة")
        elif live and i == 4 and plat == "google":
            ads[key].update(delivery="unknown", delivery_reason="ما قدرنا نقرأ الحالة من المنصة")
        elif live and i == 7 and plat == "tiktok":
            ads[key].update(delivery="scheduled", delivery_reason="مجدول ولم يبدأ بعد")
        elif live:
            ads[key]["delivery"] = "delivering"
        else:
            ads[key]["delivery"] = "off"
        base = SCALE[plat] * (0.5 + rnd.random())
        cpl = CPL[plat] * (0.6 + rnd.random())
        first = rnd.randrange(0, 20)
        last = DAYS - (0 if live else rnd.randrange(5, 25))
        for d in range(first, last):
            if rnd.random() < 0.12:
                continue
            day = (START + timedelta(days=d)).isoformat()
            spend = round(base * (0.6 + 0.8 * rnd.random()), 2)
            impr = int(spend * (40 + 40 * rnd.random()))
            clicks = int(impr * (0.004 + 0.02 * rnd.random()))
            res = max(0, round(spend / cpl + rnd.uniform(-0.6, 0.6)))
            rows.append([key, day, spend, impr, clicks, res if goal == "lead" else 0, res if goal == "messages" else 0])

print(json.dumps({"range": {"start": START.isoformat(), "end": END.isoformat(), "today": (END + timedelta(days=1)).isoformat()},
                  "ads": ads, "rows": rows}, ensure_ascii=False, separators=(",", ":")))
