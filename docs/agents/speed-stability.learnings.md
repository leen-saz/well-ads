# دروس speed-stability

سجل التعلّم لهذا الإيجنت. يقرؤه الإيجنت في بداية كل جولة ويحدّثه في نهايتها، والمدير يقرؤه يومياً من main. النطاق والحدود في [speed-stability.md](speed-stability.md).

القواعد: درس واحد لكل بند، الأحدث فوق، بدون أسرار وبدون أرقام أعمال أو أسماء عملاء. كل درس له مصدر عام برابط وتاريخ، أو دليل من الريبو (ملف أو PR). ما رُفض يُسجَّل مع سببه حتى لا يتكرر.

## الدروس

### 2026-11-12 · مهلة لطلب إطلاق الـ workflow من cron
- **الدرس:** `dispatchRefresh` و`dispatchWorkflow` كانا يستدعيان GitHub بدون مهلة داخل `ctx.waitUntil`. Cloudflare تقطع `waitUntil` بعد 30 ثانية، فطلب معلّق يقتل الاستدعاء قبل كتابة حالة الفشل في R2 ولا تظهر في صحة الداتا. أضفنا `AbortSignal.timeout(10s)` ودمجنا الدالتين في مساعد واحد.
- **المصدر:** https://developers.cloudflare.com/workers/best-practices/workers-best-practices/ (حد 30 ثانية لـ waitUntil، الصفحة محدّثة 2026-10-12)، https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/timeout_static (يرمي TimeoutError، Baseline منذ 2024-04).
- **الأثر:** PR هذه الجولة. ملاحظة اختبار: `AbortSignal.timeout` لا يتأثر بـ fake timers في vitest، فالاختبار يستبدله بإشارة ملغاة مسبقاً.
- **مؤجل:** مراجعة بقية استدعاءات fetch الخارجية في `src/` للمهلة (حجم متوسط)؛ لا يوجد `timeout-minutes` ناقص في workflows (كلها لها مهلة ما عدا ci.yml الذي يستدعي workflow مشتركاً من eng-policies).

<!-- القالب:
### YYYY-MM-DD · عنوان قصير
- **الدرس:** سطر واحد.
- **المصدر:** رابط عام أو ملف/PR.
- **الأثر:** طبّقناه في PR رقم X / مؤجل / مرفوض لأن...
-->
