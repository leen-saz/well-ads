# المايسترو: Paperclip على Cloudflare

Paperclip (MIT) يدير الإيجنتس: هيكل، مهام، ميزانية لكل إيجنت، وموافقات. اللوحة تكلمه من الـ Worker، والشركات ما تشوفه.

## التشغيل على Cloudflare Containers
- **يحتاج باقة Workers Paid** (5$ شهرياً + استهلاك). Containers ما تشتغل على المجاني.
- Paperclip = Node + Postgres. الحاوية تشغّل `paperclipai` على المنفذ 3100، والقاعدة Postgres خارجي (Supabase نفسها، أو قاعدة مستقلة) عن طريق `DATABASE_URL`.
- وضع `authenticated` (مو `local_trusted`) لأنه على الإنترنت.

## الربط باللوحة (مرة وحدة، لين تحطها بنفسها)
1. من Paperclip أنشئ board API token.
2. في Cloudflare ← Worker `well-ads` ← Settings ← Variables and Secrets:
   - `PAPERCLIP_URL` = رابط Paperclip (https)
   - `PAPERCLIP_TOKEN` = الـ board token
3. افتح تاب **المايسترو** ← **اربط**: ينشئ لشركتك شركة في Paperclip ويحفظ رقمها (`companies.paperclip_company_id`).

## كيف يشتغل
- **كلّف المايسترو:** مهمة (issue) بحالة `todo`، تروح لإيجنت محدد أو المايسترو يوزعها.
- **الموافقات:** طلبات الإيجنتس (توظيف، تجاوز ميزانية، موافقة) تطلع للمالكة: وافق / ارفض. قبل أي قرار نتأكد إن الموافقة تابعة لشركتك.
- كل فعل ينسجل في `audit_log` مع الشركة.
