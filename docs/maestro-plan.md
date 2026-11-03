# خطة تاب «المدير»: منسّق الإيجنتس

«المدير» (`/maestro/`) هو مكانك لإدارة الإيجنتس: توزّع المهام على إيجنت كل تاب، تتابع حالتها، توافق أو ترفض، وتشوف أداء كل إيجنت وصرفه. الإيجنتس نفسهم يشتغلون داخل Paperclip، واللوحة تكلمه من الـ Worker. الإعداد في `docs/paperclip.md`.

## وش يقدّم Paperclip، ووش عندنا (2026-11-04)

| الميزة | في Paperclip | في تابنا | الفجوة |
|---|---|---|---|
| مهام (issues) وحالاتها | `GET/POST /companies/{id}/issues`، `PATCH /issues/{id}` | لوحة: قائمة وأعمدة، فلاتر، بحث، مهمة جديدة | ما تقدر تغيّر الحالة أو تعيد الإسناد من اللوحة |
| مدير يوزّع (CEO) | الـ CEO يسوّي مهام فرعية (`parentId`، `goalId`) لإيجنتسه، حسب ملف `AGENTS.md` حقه | «المدير يختار» يخلي المهمة بدون إيجنت | ما نعرض المهام الفرعية ولا الأهداف |
| مهام كل تاب | مشاريع (`projects`) وفلتر `projectId` | مشروع `Well · <التاب>` لكل تاب (PR #130) | — |
| موافقات | `hire_agent`، `approve_ceo_strategy`؛ وافق، ارفض، **اطلب تعديل**، مع `decisionNote` | وافق / ارفض | اطلب تعديل، والملاحظة، وتفاصيل الطلب |
| ميزانيات | لكل إيجنت ولكل شركة، بالسنت، `0` = بدون سقف، تحذير 80% وإيقاف 100% | صرف كل إيجنت وسقفه، وصرف الشركة (PR #124) | تعديل السقف من اللوحة (نخليه في Paperclip) |
| أداء كل إيجنت | `costs/by-agent?from&to`، `heartbeat-runs?agentId` (نجح، فشل، مدة)، المهام المنجزة بـ `assigneeAgentId&status=done` | ما فيه | **كرت أداء** |
| ملخص الشركة | `GET /companies/{id}/dashboard` (الإيجنتس، المهام، الصرف، التشغيلات باليوم) | نحسبه من القوائم | نستخدم الملخص الجاهز |
| Heartbeat وجدولة | `heartbeat/invoke`، `pause`، `resume`، وroutines بجدول | ما فيه | زر «صحّه الحين» و«أوقف» (لاحقاً) |
| التصعيد | الإيجنت يحط المهمة `blocked` بتعليق ويصعّد لسلسلة مديره (`chainOfCommand`) | المتوقفة تطلع في الوارد | نعرض سبب التوقف (آخر تعليق) |
| محادثة | تعليقات المهمة `GET/POST /issues/{id}/comments`؛ التعليق يصحّي الإيجنت المسند؛ الـ @mention ما يصحّي | ما فيه | **محادثة مع المدير** |
| سجل النشاط | `GET /companies/{id}/activity` | `audit_log` حقنا بس | نعرض نشاط الإيجنت في كرته (لاحقاً) |

**ملاحظة:** نقاط النهاية `heartbeat-runs` و `costs?from&to` و `budgets/overview` موجودة في كود Paperclip وما هي موثقة، فممكن تتغيّر. نقرأها بحذر: لو ما ردّت، الكرت يعرض اللي يقدر عليه.

## 1. كيف «المدير» يوزّع الشغل على إيجنت كل تاب
- لكل تاب مشروع في Paperclip اسمه `Well · <مفتاح التاب>` (مثل `Well · social`). المهمة اللي تختار لها تاب تروح لمشروعه.
- لو اخترت إيجنت: Paperclip يصحّيه أول ما تنسند له، ويستلم المهمة (checkout) ويشتغل.
- لو خليتها «المدير يختار»: تنسند لإيجنت الـ CEO، وهو يقسمها مهام فرعية لإيجنتس التابات حسب تعليماته في `AGENTS.md`.
- في Paperclip: كل تاب له إيجنت (أو أكثر) يرفع تقاريره للـ CEO (`reportsTo`)، وتعليماته تقول له يشتغل على مشروع تابه بس.
- أي شي حساس (نشر، صرف، إيقاف إعلان) يرجع لك موافقة قبل التنفيذ.

## 2. كرت أداء لكل إيجنت
في تبويب «الإيجنتس»، كل إيجنت له كرت فيه، لهالشهر (والفترة تتغيّر: 7 أيام، 30 يوم):
- **مهام خلصت** ومهام شغالة ومتوقفة.
- **الصرف** من سقفه، وعدد التشغيلات.
- **نسبة النجاح**: التشغيلات اللي `succeeded` من كل التشغيلات المنتهية.
- **متوسط وقت المهمة**: من `startedAt` لـ `completedAt` للمهام اللي خلصت.
- **آخر خطأ** لو فيه، وآخر مرة اشتغل.

من: `costs/by-agent`، `heartbeat-runs?agentId=`، و`issues?assigneeAgentId=&status=done`. Endpoint واحد عندنا `GET /api/maestro/agent?id=` يجمعها ويرجّع أرقام بس (ما نرجّع سجلات التشغيل كاملة).

## 3. محادثة مع «المدير»
لوحة جانبية في التاب تكلم فيها «المدير». ثلاث أفعال لها أزرار واضحة، والباقي كلام حر:
- **أسند مهمة:** «سوّ 5 منشورات للسوشال الأسبوع الجاي» ← يطلع لك نموذج المهمة معبّى (التاب، الإيجنت، الأولوية) وتأكد قبل الإرسال.
- **اسأل عن الحالة:** «وين وصلت مهام التصميم؟» ← اللوحة ترد من بيانات Paperclip مباشرة (بدون نموذج): المهام الشغالة والمتوقفة لهالتاب.
- **وافق:** الموافقات اللي تنتظرك تطلع في المحادثة بأزرار وافق / ارفض / اطلب تعديل، مع ملاحظة.
- **كلام حر:** ينحفظ كتعليق على مهمة ثابتة «محادثة المدير» مسندة لإيجنت الـ CEO. التعليق يصحّيه، ويرد بتعليق في الـ heartbeat الجاي. اللوحة تحدّث المحادثة كل شوي، وتقول لك «المدير يكتب…» لين يرد.
- كل رسالة وكل فعل ينسجل في `audit_log`. الإسناد يحتاج صلاحية تعديل، والموافقة تحتاج صلاحية موافقة، زي الحين.

## 4. وش يشتغل على Grok
- **كل إيجنتس Paperclip:** الـ CEO (اللي يرد عليك في المحادثة ويوزع) وإيجنتس التابات. كل واحد adapter `grok_local`، نموذج `grok-4.7`، ومفتاح `XAI_API_KEY` داخل Paperclip. التفاصيل في `docs/paperclip.md`.
- **ما يشتغل على Grok:** اللوحة نفسها. ردود «الحالة» والأرقام وكرت الأداء من بيانات Paperclip مباشرة بدون أي نموذج، فما لها تكلفة. التابات الثانية (التصميم، الكتابة…) لها نماذجها في `src/lib/llm.ts` وما تتغيّر بهالخطة.
- التكلفة كلها على حساب xAI، ومحكومة بسقف كل إيجنت في Paperclip.

## الترتيب (PRs صغيرة)
1. هالخطة.
2. كرت الأداء لكل إيجنت.
3. المحادثة: الحالة والموافقات (بدون نموذج) أول، بعدين الكلام الحر مع الـ CEO.
4. الموافقة بـ «اطلب تعديل» وملاحظة، وسبب التوقف في الوارد.
5. «صحّه الحين» و«أوقف» لكل إيجنت.

## المصادر
- Paperclip: https://github.com/paperclipai/paperclip و https://docs.paperclip.ing
- المهام والتعليقات: https://github.com/paperclipai/paperclip/blob/main/docs/api/issues.md
- الموافقات: https://github.com/paperclipai/paperclip/blob/main/docs/api/approvals.md
- التكاليف: https://github.com/paperclipai/paperclip/blob/main/docs/api/costs.md و https://github.com/paperclipai/paperclip/blob/main/server/src/routes/costs.ts
- التشغيلات: https://github.com/paperclipai/paperclip/blob/main/server/src/routes/agents.ts و https://github.com/paperclipai/paperclip/blob/main/packages/db/src/schema/heartbeat_runs.ts
- الملخص: https://github.com/paperclipai/paperclip/blob/main/docs/api/dashboard.md
- التوزيع: https://github.com/paperclipai/paperclip/blob/main/docs/guides/board-operator/delegation.md
- المحادثة والتعليقات: https://github.com/paperclipai/paperclip/blob/main/docs/guides/agent-developer/comments-and-communication.md
- Grok: https://docs.paperclip.ing/reference/adapters/grok-local.md
