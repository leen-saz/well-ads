# المدير: Paperclip بدون Workers Paid

Paperclip (MIT) يدير الإيجنتس: هيكل، مهام، ميزانية لكل إيجنت، وموافقات. اللوحة تكلمه من الـ Worker، والشركات ما تشوفه.
Cloudflare Containers مدفوعة، فـ Paperclip يشتغل على جهاز (جهازك أو سيرفر مجاني)، ويوصل له الـ Worker عن طريق **Cloudflare Tunnel (مجاني)**.

## 1. Paperclip على وضع authenticated
اللي شغال الحين `local_trusted` (يفتح بدون دخول، للجهاز بس). قبل ما ينفتح على الإنترنت:
```
paperclipai configure --section server     # اختر authenticated
paperclipai allowed-hostname paperclip.<دومينك>
```

## 2. Cloudflare Tunnel (مجاني)
```
brew install cloudflared
cloudflared tunnel login
cloudflared tunnel create paperclip
cloudflared tunnel route dns paperclip paperclip.<دومينك>
cloudflared tunnel run --url http://localhost:3100 paperclip
```
- يحتاج دومين على Cloudflare. بدون دومين: `cloudflared tunnel --url http://localhost:3100` يعطي رابط `trycloudflare.com` مؤقت يتغير كل تشغيل (للتجربة بس).
- الجهاز لازم يكون شغال. لـ 24 ساعة بدون دفع: VM من Oracle Cloud Always Free، نفس الخطوات عليه.

## 3. board API token
```
paperclipai token board create --name well-ads --never-expires
```
ينطبع مرة وحدة. لا تحطه في الكود ولا في الشات.

## 4. أسرار الـ Worker (أنتِ تحطينها)
Cloudflare ← Workers ← `well-ads` ← Settings ← Variables and Secrets ← Add (Secret):
- `PAPERCLIP_URL` = `https://paperclip.<دومينك>`
- `PAPERCLIP_TOKEN` = التوكن من الخطوة 3

## 5. الربط
تاب **المدير** ← **اربط**: ينشئ لشركتك شركة في Paperclip ويحفظ رقمها (`companies.paperclip_company_id`).

## كيف يشتغل
- **مهمة جديدة** (أو `C`): issue بحالة `todo`، لإيجنت محدد أو المدير يوزعها.
- **مهام كل تاب:** في نافذة المهمة «لأي تاب». مهمة التاب تروح لمشروع في Paperclip اسمه `tab · <مفتاح التاب>` (مثل `tab · social`؛ المشاريع القديمة `Well · <التاب>` تنقرى زي ما هي)، ينسوى أول مرة. الإيجنت المسند له يصحى ويستلمها (assignment يصحّيه، أو heartbeat). بدون إيجنت، إيجنت الـ CEO في Paperclip يوزعها. اللوحة تعرض التاب على كل مهمة، وتحت كل إيجنت التابات اللي اشتغل لها.
- في Paperclip: خلّ إيجنتس كل تاب يتابعون مشروع تابهم (تعليمات الإيجنت أو `projectId` في فلتر المهام).
- **الوارد:** موافقات الإيجنتس والمهام المتوقفة. الموافقة تحتاج صلاحية "موافقة" على المدير، ونتأكد إن الموافقة تابعة لشركتك.
- كل فعل ينسجل في `audit_log` مع الشركة.

## نموذج الإيجنتس (Grok): يتحدد في Paperclip، مو في الكود
قرار لين: الإيجنتس على Grok (xAI). الإيجنتس يشتغلون داخل Paperclip، فالنموذج يتحدد هناك لكل إيجنت. اللوحة وأسرار الـ Worker ما فيها نموذج ولا مفتاح xAI.

لكل إيجنت في Paperclip:
1. افتح الإيجنت ← **Harness / Runtime** ← كرت **Adapter**.
2. نوع الـ adapter: **`grok_local`** (يشغّل Grok Build CLI على جهاز Paperclip).
3. حقل **Model**: `grok-4.7` (أو `grok-build` الافتراضي، أو `grok-4.6` / `grok-4.5`). بدون بادئة مزوّد.
4. المفتاح: في نفس الصفحة، متغيرات البيئة (`adapterConfig.env`)، `XAI_API_KEY`. الأفضل كـ secret في أسرار الشركة داخل Paperclip، وتسمح للإيجنت فيه من **Secret access**. بدون مفتاح، Grok يستخدم دخول اشتراك SuperGrok على الجهاز.
5. **Heartbeat on interval**: شغّله لو تبي الإيجنت يصحى بنفسه. غير كذا يصحى لما تنسند له مهمة.

- **مدفوع:** كل طلب له تكلفة على حساب xAI.
- **الميزانية:** لكل إيجنت (Budget بالشهر، بالسنت الأمريكي) ولكل شركة. `0` يعني بدون سقف، مو صفر. التحذير عند 80% والإيقاف عند 100%. تاب المدير يعرض صرف كل إيجنت وصرف الشركة هالشهر.
- المصدر: https://docs.paperclip.ing/reference/adapters/grok-local.md و https://docs.paperclip.ing/reference/api/costs.md (2026-11-03)
