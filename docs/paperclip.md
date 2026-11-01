# المايسترو: Paperclip بدون Workers Paid

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
تاب **المايسترو** ← **اربط**: ينشئ لشركتك شركة في Paperclip ويحفظ رقمها (`companies.paperclip_company_id`).

## كيف يشتغل
- **مهمة جديدة** (أو `C`): issue بحالة `todo`، لإيجنت محدد أو المايسترو يوزعها.
- **الوارد:** موافقات الإيجنتس والمهام المتوقفة. الموافقة تحتاج صلاحية "موافقة" على المايسترو، ونتأكد إن الموافقة تابعة لشركتك.
- كل فعل ينسجل في `audit_log` مع الشركة.
