# قواعد الشركة

الريبو عام، فأسماء الحملات والحدود (تكلفة الليد وغيرها) **ما تنكتب هنا**. تنحفظ في قاعدة البيانات: `control_settings.guardrails.buyer.rules` لكل منصة، ومن عندها صلاحية الموافقة على تاب الميديا باير (لين) تحفظها (`POST /api/buyer/rules` بجسم `{ "rules": [...] }`، و`GET` لقراءتها). كل قاعدة تتحقق منها `cleanRules` في `src/modules/buyer/rules.ts`.

## شكل القاعدة (أمثلة صناعية)
```json
{ "id": "scale-example", "kind": "scale", "platform": "snapchat", "match": ["example-campaign"], "maxCpl": 9, "stepPct": 20, "everyDays": 3, "owner": "media_buyer", "open": "الحد مو محسوم" }
```
| الحقل | معناه |
|---|---|
| `kind` | `scale` رفع ميزانية (يحتاج `maxCpl`)، `resume` تشغيل متوقفة جيدة (`maxCpl`)، `stop_idle` إيقاف بلا نتائج (`minIdleDays`)، `reduce` تقليل للحد الأدنى (مع `followUp` مهمة إصلاح)، `replace_creative` مادة جديدة بلا إيقاف (`minCtr`، و`followUp` الطلب)، `alert_stalled` تنبيه لو ما صرف آخر يوم |
| `platform` | `meta` / `tiktok` / `snapchat` / `google` |
| `match` | أجزاء أسماء الحملات أو الإعلانات (بدون حساسية لحالة الأحرف) |
| `owner` | من ينفّذ: `media_buyer` (الافتراضي) / `video_agent` / `production` / `landing` |
| `open` | قرار مفتوح عند لين، يظهر مع التوصية، والإيجنت ما يحسمه |
| `judgeBy` | `cpl` أو `ctr` |

**تيك توك:** يُحكم عليه بنسبة النقر والتفاعل مو بالليدز، فقواعد `scale` و`stop_idle` مرفوضة له، و`resume` يحتاج `minCtr` بدل `maxCpl`. حد سناب (`maxCpl` في `scale`) إعداد قابل للتغيير، الافتراضي 9 لين تحسمه لين.

القاعدة اللي تتعارض مع حكم التسويق تنوقف مثل بقية القواعد (التوسيع بشرط الـ CPL «تمام»، ومادة جديدة بشرط إن النقر مو «تمام»). توصية رفع الميزانية للشركة تحلّ محل التوصية العامة لنفس الحملة.
