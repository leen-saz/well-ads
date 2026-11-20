# PRD: وِل، نظام القرار التسويقي (الإصدار 2)

| | |
|---|---|
| **الحالة** | معتمد من لين (2026-11-19)، ومعه موافقتها على Q1. التنفيذ PR لكل مرحلة (القسم 7) |
| **التاريخ** | 2026-11-19 · تحديث 2026-11-20 (قرار لين: MCP واحد للتنفيذ، ووضع «تلقائي» للإعلانات) |
| **المالكة** | لين (`leen-saz`) |
| **الريبو** | `leen-saz/well-ads` |
| **يحلّ محل** | لا شيء. وصف السلوك القائم قبل النقل محفوظ في `docs/prd-baseline-2026-10.md` (كان `docs/prd.md`) ويبقى مرجعاً لما يجب ألا ينكسر |

> **تحديث 2026-11-20 (قرارا لين):**
> 1. **كل شي يمر عبر MCP واحد:** خادم MCP خاص فينا هو طبقة التنفيذ الوحيدة لكل فعل على أي منصة (قراءة وكتابة: الإعلانات، النشر، الصندوق، الأرقام، صحة الحسابات). الإيجنتس وروتات الواجهة والمهام المجدولة كلها تنادي نفس الأدوات، وما فيه موديول يكلّم API منصة مباشرة. القسم الجديد 3.0، وتغيّرت الأقسام 3.2 و3.3 و3.4 و3.6 و3.8 و5 و6 و7.
> 1b. **«MCP لكل ريبو»:** خادم وِل داخل ريبو `well-ads` نفسه، ما يتشارك مع هوفن ولا Apipeline، وبدون أي اعتمادية بين الريبوهات.
> 1c. **«ويكون صلاحية كتابة»:** إيجنتس وِل تستخدم نطاق `read-write` افتراضياً؛ نطاق القراءة بس للعملاء من برّا. صلاحيات الكتابة المطلوبة لكل منصة في 3.0، ومرحلة لإعادة ربط الحسابات بها في 7.
> 2. **وضع «تلقائي» للإعلانات:** لكل إيجنت، تفعّله لين بنفسها، يقدر الميديا باير ينشئ ويعدّل ويوقف الحملات والمجموعات والإعلانات والميزانيات بدون انتظار اعتماد، داخل حواجز ثابتة وبمفتاح إيقاف واحد. «بموافقتي» يبقى الافتراضي. القسم 3.6.
>
> **قاعدة الكتابة:** كل ما يُذكر عن الوضع الحالي معه مسار ملف أو ميجريشن أو اختبار. ما لم نتحقق منه مكتوب صراحة «غير متحقق». ما ورد عن Zernio منقول من مرجع لين ويحتاج تحققاً قبل أي قرار (المرحلة M7).

---

## 1. نظرة عامة

### 1.1 المنتج
«وِل» نظام قرار تسويقي متكامل: يجمع أرقام منصات الإعلانات والتحليلات وإقفالات الـ CRM، ويقترح قرارات (ميزانية، إيقاف، مادة جديدة)، وينتج المحتوى (نص، تصميم، صوت، فيديو)، وينشره بعد الاعتماد، ويقيس أثر كل قرار. يعمل على Cloudflare Workers (Astro + React/shadcn + Hono)، وقاعدة Supabase، وملفات R2، وسحب بيانات بايثون في GitHub Actions، ومصمَّم لعدة شركات منذ البداية (`docs/adr/0006-saas-on-cloudflare.md`). الشركة الأولى هي «وِل».

### 1.2 المستخدمون
| الدور | ما يحتاجه | الصلاحية اليوم |
|---|---|---|
| **المالكة (لين)** | قرار سريع وموثوق، واعتماد كل ما يغيّر حساباً أو يُنشر، وإيقاف فوري عند الخطر | كل شيء، وحدها ترفع زر الطوارئ وتفعّل التنفيذ الحقيقي (`docs/media-buyer/execution.md`) |
| **المعتمِد** | قائمة واحدة لما ينتظر اعتماده | `companies.social_approvers` (`supabase/migrations/013_social_approver.sql`) وصلاحية «موافقة» على التاب |
| **عضو الفريق (إنتاج، محتوى، ميديا باير)** | أدوات الإنتاج والجدولة والرد على الجمهور | اللوحات والأقسام التي تختارها له المالكة (`012_access_levels.sql`) |
| **مدير القسم** | أرقام قسمه فقط | نطاق `departments` |
| **الإيجنتس والأدوات** | قراءة الأرقام واقتراح الإجراءات دون تنفيذ | مفتاح قراءة واحد `READ_API_KEY` (`docs/api-v1.md`) |

### 1.3 المشكلة
1. **التشتت:** ما ينتظر الاعتماد موزّع على صفحات (المنشورات في السوشال، الإجراءات في لوحة القرارات، الدروس في كل تاب)، ولا يوجد عدّاد واحد يبيّن للمعتمِد ما ينتظره.
2. **التنفيذ ناقص:** النظام يقترح ولا يستطيع إنشاء حملة أو تعزيز منشور. الكتابة اليوم محصورة في تعديل ميزانية وإيقاف/تشغيل على ميتا وسناب (`src/modules/buyer/exec/`).
3. **التعلّم لا يغلق الحلقة:** النتائج تُقاس بعد 3 و7 أيام فقط عند فتح التبويب (`POST /api/buyer/outcomes`، `docs/learning-loops.md`)، والدرس لا يدخل في الاقتراح التالي.
4. **الجمهور خارج النظام:** التعليقات والرسائل تُدار من تطبيقات المنصات، بلا سجل ولا اعتماد.
5. **النشر يعتمد على Postiz:** يحتاج خادماً مستقلاً (VM بذاكرة 4GB وTemporal) وترخيصه AGPL، وبعض سلوكه غير متحقق (`docs/social-engine.md` «Not verified»).
6. **واجهتان:** نظام تنسيق قديم `public/assets/app.css` ونظام Tailwind/shadcn `src/styles/ui.css` بمتغيرات منفصلة (`--ui-*`)، فيتكرر العمل ويختلف الشكل.

### 1.4 الأهداف
- **G1:** مكان واحد للاعتماد، بعدّاد حي في القائمة الجانبية، وزمن اعتماد أقصر.
- **G2:** تنفيذ إعلاني أوسع (إنشاء وتعديل وتعزيز) **دون كسر قاعدة الاعتماد**، بحدود ثابتة في الكود وسجل كامل.
- **G3:** حلقة تعلّم مغلقة: كل قرار يُقاس تلقائياً بعد 3 و7 أيام، والدرس يظهر مع الاقتراح التالي لنفس القاعدة.
- **G4:** نشر متعدد المنصات بطلب واحد، بنص مخصّص لكل منصة، وطابور مواعيد، وتقويم.
- **G5:** صندوق وارد موحّد للتعليقات والرسائل، بالرد والإخفاء عبر الاعتماد.
- **G6:** طبقة مطوّرين وإيجنتس آمنة: مفاتيح بصلاحيات، و`Idempotency-Key`، وwebhooks صادرة، وخادم MCP.
- **G7:** نظام تصميم واحد (توكنات واحدة، وضع داكن، ⌘K)، وإزالة `app.css` تدريجياً.

### 1.5 خارج النطاق
- **واتساب:** لا ربط ولا رسائل ولا صندوق وارد له، إلا إذا طلبته لين صراحة في هذه المحادثة.
- **تيك توك عبر API:** يبقى عبر MCP فقط (`src/lib/mcp-oauth.ts`، `pipeline/tiktok/mcp.py`). لا تطبيق مطوّر لتيك توك إعلانات.
- **أتمتة كاملة افتراضياً:** لا شيء يُنفَّذ أو يُنشر دون اعتماد، إلا ما تفعّله لين صراحة لإيجنت محدد (القسم 3.7).
- **Scraping** لحسابات المنافسين أو أي منصة.
- **البث الجماعي (broadcasts)** للرسائل الخاصة في هذا الإصدار: يحتاج موافقات وسياسات مراسلة لكل منصة، ويُؤجَّل (سؤال مفتوح Q9).
- إعادة كتابة السحب (`pipeline/`) أو تغيير الحزمة التقنية.

---

## 2. الوضع الحالي

### 2.1 يعمل اليوم
| المجال | ما يعمل | الدليل |
|---|---|---|
| السحب | كل ساعة: Meta Graph، Google Ads، Snapchat، GA4، وتيك توك عبر MCP. التشغيل يبدأ من Cron في الـ Worker لأن جدولة GitHub لم تعمل | `src/lib/cron.ts:1-3`، `.github/workflows/refresh.yml`، `wrangler.jsonc` (`"7 * * * *"`) |
| تاريخ تيك توك | محفوظ في R2 خاص `private/tiktok/tiktok.json`، يُقرأ ويُكتب في كل تشغيل | `refresh.yml:93-139` |
| التحليلات | ملخص الأداء، الأقسام، الكرييتف، التسليم الفعلي (delivery)، الإقفالات `paid_all` من الـ CRM | `src/modules/overview/` (`analytics.ts`، `delivery.ts`، `judge.ts`)، `011_crm_leads.sql` |
| القرارات | اقتراحات القواعد، المراجع، حكم التسويق، الاعتماد/الرفض/التراجع | `src/modules/buyer/` (`playbook.ts`، `buyer.ts`)، `src/modules/auditor/` |
| التنفيذ بالاعتماد | ميزانية/إيقاف/تشغيل على ميتا وسناب: تجربة بلا تنفيذ افتراضياً، سقف 20% (صلب 50%)، تغيير واحد لكل كيان كل 48 ساعة، زر طوارئ، قراءة قبل وبعد، تراجع | `src/modules/buyer/exec/guards.ts`، `032_buyer_actions.sql` (فهرس `buyer_actions_one_live`)، `tests/unit/buyer-exec.test.ts` |
| النشر | فيسبوك وانستقرام بمحركنا (Graph)، وتيك توك وX ولينكدإن عبر Postiz، بعد اعتماد معتمِد مسمّى، Cron كل 5 دقائق، منع النشر المزدوج | `src/modules/social/cron.ts`، `engine.ts`، `postiz.ts`، `postiz.test.ts`، `013_social_approver.sql`، `023_social_recovery.sql` |
| الإنتاج | المحتوى، الكوبي رايتر، التصميم، الصوت، الفويس أوفر، المكتبة | `src/modules/{content,copy,design,voice,voiceover}/`، `020_library.sql` |
| الرصد | أخبار، Reddit، YouTube (بمفتاح)، X عبر Grok (مدفوع، اختياري) | `src/modules/listening/fetcher.ts`، `README.md` |
| المعرفة والامتثال | قاعدة المعرفة، صوت العلامة، فاحص الامتثال | `src/modules/{knowledge,compliance}/` |
| المايسترو والمدقق | صحة الداتا، سجل التدقيق، Paperclip | `src/modules/maestro/`، `src/modules/auditor/` |
| API للقراءة | `/api/v1/*` قراءة فقط بمفتاح واحد، 60 طلباً/دقيقة | `src/lib/apiv1.ts`، `docs/api-v1.md` |
| المراقبة | تنبيه عند تقادم البيانات أكثر من 3 ساعات (webhook أو Resend) | `src/lib/watchdog.ts` |
| تعدد الشركات | `company_id` و`scoped()` على الجداول الجديدة | `src/lib/tenant.ts`، `006_companies.sql`، `docs/review-2026-11.md` R-01..R-03 |
| النسخ الاحتياطي | أسبوعي مشفّر، واختبار استرجاع شهري | `db-backup.yml`، `db-restore-test.yml` |
| الواجهة | 12 مكوّن shadcn، Tailwind v4 بلا preflight، خطوط ثمانية، Lucide، Motion | `src/components/ui/`، `src/styles/ui.css`، `public/assets/fonts/`، `package.json` |

### 2.2 مبني لكنه غير مفعّل
| البند | الحالة | الدليل |
|---|---|---|
| حلقة التعلّم | `judgeOutcome` و`tune` موجودان، والقياس يحدث فقط عند فتح التبويب، والتوصية بالتعديل تُنسخ يدوياً إلى PR | `src/modules/buyer/learn.ts:1-3`، `035_buyer_outcomes.sql`، `docs/learning-loops.md` |
| التنفيذ الحقيقي على سناب | المحوّل مختبر على محاكاة مكتوبة يدوياً فقط، لم تجرِ أي كتابة حقيقية | `docs/media-buyer/execution.md` «Snap: still unverified»، `exec.test.ts` (`it.todo`) |
| حارس الميجريشن | `MIGRATIONS_STRICT=1` يجعل `/api/health` يفشل والنشر يتوقف، لكنه **معطّل افتراضياً** | `docs/migrations.md`، `deploy.yml:161-173` |
| ربط Meta وGoogle Ads بـ OAuth | الكود جاهز وينتظر `META_APP_ID/SECRET` و`GOOGLE_ADS_CLIENT_ID/SECRET` | `src/lib/connectors.ts:35,189-202` |
| YouTube في الرصد | ينتظر `YOUTUBE_API_KEY` | `src/modules/listening/fetcher.ts:83` |
| النشر عبر Postiz | مبني من التوثيق، **لم يُختبر على خادم حقيقي** | `docs/social-engine.md` «Not verified» |
| الوضع الداكن | `@custom-variant dark` معرّف، بلا توكنات داكنة ولا مفتاح تبديل | `src/styles/ui.css:11` |
| الخطوة القديمة `execute` | كاتب ثانٍ على ميتا بمفتاح السحب، يوصى بإزالتها | `docs/media-buyer/execution.md` «الخطوة القديمة» |

### 2.3 ناقص
| البند | ملاحظة |
|---|---|
| مركز اعتماد موحّد وعدّادات حية | لا يوجد. القائمة الجانبية JavaScript يدوي (`public/assets/sidebar.js`، 162 سطراً) بلا عدّادات |
| لوحة أوامر ⌘K | لا يوجد. اختصارات محلية فقط في لوحة القرارات (`public/assets/control.js:425`) |
| Toasts موحّدة | دالة يدوية `toast()` في `public/assets/common.js:161` |
| تقويم النشر، ونص لكل منصة، وطابور مواعيد | `social_posts` فيها `body` واحد لكل المنصات (`007_social.sql`) |
| Webhooks عند نجاح/فشل النشر | لا يوجد |
| فحص صحة الحسابات الدوري ومهلة قبل الفصل | تاريخ الانتهاء معروض فقط (`connectors.ts:193,228`)، لا فحص دوري |
| صندوق الوارد | لا يوجد |
| إنشاء حملة/مجموعة/إعلان، تعزيز منشور، جماهير، رفع مواد، أحداث تحويل | لا يوجد |
| تقارير ثقيلة غير متزامنة وتنبيهات أداء | لا يوجد (تنبيه تقادم البيانات فقط) |
| مفاتيح API متعددة بصلاحيات، `Idempotency-Key`، webhooks صادرة، خادم MCP عام | لا يوجد |
| منشورات تيك توك العضوية | الموصّل الحالي لا يعطيها (`pipeline/organic.py:28-29`) |
| أهداف اللمس على الجوال | لم تُقس على جهاز حقيقي (`docs/ux-audit-2026-11-12.md:11`) |

### 2.4 بنود مفتوحة تخص لين
- مفاتيح: `META_APP_ID`، `META_APP_SECRET`، `GOOGLE_ADS_CLIENT_ID`، `GOOGLE_ADS_CLIENT_SECRET`، `YOUTUBE_API_KEY`.
- ملفات `013_listening.sql` و`013_social_approver.sql` إن لم تُطبَّق (تحقق من «المدير ← صحة الداتا ← المايقريشنات»).
- فرع `tiktok-data` العام وتاريخه، وملف الاختبار القديم في التاريخ (`docs/review-2026-11.md` R-16، R-17): الحذف قرار لين.
- تناقض أرقام الربط بالإعلان بين ثلاث صفحات (`docs/ux-audit-2026-11-12.md` الملاحظة 1) وقائمة المعتمِدين تعرض كل الإيميلات (السطر 91).

---

## 3. النطاق

كل بند أدناه: قصة المستخدم، السلوك، الواجهة، البيانات، الـ API، الحواجز، معايير القبول، الاختبار. **قواعد مشتركة لكل البنود:**
- كل جدول جديد فيه `company_id uuid not null references companies(id)`، وRLS مفعّل، و`revoke all from anon, authenticated`، وكل استعلام عبر `scoped()`.
- كل ميجريشن جديد ينتهي بسطر `schema_migrations` (`docs/migrations.md`)، ويأخذ الرقم التالي (038 فما بعد).
- كل إجراء يغيّر شيئاً خارج النظام (نشر، رد، تعديل إعلان) يمر بالمسار: **مقترح ← اعتماد ← حواجز ← تنفيذ ← قراءة بعده ← سجل**، ويُسجَّل في `audit_log`.
- لا أسرار في الريبو ولا القاعدة ولا السجل ولا الردود. الواجهة تعرف «مضاف/ناقص» فقط.
- كل نص واجهة عربي أولاً، يخاطب المستخدم بالمذكر، مع ترجمة في `i18n-en.js`.
- البيانات في الاختبارات صناعية، والمحاكاة تفشل عند أي نداء لعنوان حقيقي.

### 3.0 طبقة التنفيذ الموحّدة: Well MCP (قرار لين 2026-11-20)

**القصة:** بصفتي المالكة، أبي مكان واحد يمر منه كل فعل على أي منصة، بنفس الصلاحيات ونفس السجل ونفس الحواجز، سواء ضغطته أنا من الواجهة أو سوّاه إيجنت أو مهمة مجدولة.

**القرار:**
- **MCP لكل ريبو (قرار لين):** خادم وِل يعيش داخل ريبو `well-ads` (`src/mcp/`) ويخدم وِل بس. لا خادم مشترك مع هوفن أو Apipeline، ولا مكتبة مشتركة بين الريبوهات: كل ريبو عنده MCP خاص فيه.
- **خادم MCP واحد خاص فينا** (`src/mcp/`) في نفس الـ Worker على Cloudflare: `/mcp` بـ Streamable HTTP، ومصادقة OAuth 2.1 + PKCE للعملاء من برّا (الإيجنتس والأدوات).
- **هو طبقة التنفيذ الوحيدة:** روتات الواجهة، والمهام المجدولة (Cron)، والإيجنتس كلهم ينادون نفس الأدوات:
  - من داخل الـ Worker بنداء داخلي (`callTool(ctx, name, args)`) بنفس التحقق والصلاحية والسجل؛
  - ومن برّا عبر `/mcp`.
- **ما فيه موديول يكلّم API منصة مباشرة.** اختبار يفشل لو ظهر عنوان منصة (`graph.facebook.com`، `adsapi.snapchat.com`، `googleads.googleapis.com`، `business-api.tiktok.com`، Postiz…) خارج `src/mcp/adapters/`.
- **النمط مأخوذ من Zernio:**
  - طريقة مصادقة وحدة، وشكل طلب واحد؛
  - Platform Adapter لكل شبكة؛
  - Token Vault ومجدّد للتوكنات؛
  - Idempotency لكل ما يصرف؛
  - مهام غير متزامنة للشغل الثقيل؛
  - أحداث وwebhooks صادرة؛
  - عزل كل شركة.
- **Zernio نفسه** ممكن يكون Adapter اختياري (مثلاً للنشر العضوي)، **مو اعتمادية**.

**شكل الطلب الواحد:**
- **الأداة:** اسمها `<المجال>.<الكيان>.<الفعل>`، مثل `ads.campaign.create` و`ads.budget.update` و`social.post.publish` و`inbox.comment.reply` و`insights.ads.read` و`accounts.health.check`.
- **السياق (`ctx`)** يتحدد في السيرفر ولا يجي من المتصفح:
  - `company_id`؛
  - `actor` (`human` / `agent:<name>` / `api` / `cron`)؛
  - `scope` (`read` أو `write`)؛
  - `mode` (`approve` أو `auto`)؛
  - `idempotency_key`.
- **الجواب** موحّد: `{ ok, data | error: { code, message } , job_id?, audit_id }`.

**الطبقات داخل الخادم:**
| الطبقة | وش تسوي | من وين تجي اليوم |
|---|---|---|
| Tool registry + schema | تعريف كل أداة ومدخلاتها والتحقق منها | جديد |
| Auth + scopes | جلسة المستخدم داخلياً؛ OAuth 2.1/PKCE أو مفتاح من برّا؛ نطاق `read` أو `read-write` | `requireUser` (`src/lib/auth.ts`)، `READ_API_KEY` (`docs/api-v1.md`) |
| Policy (السياسة) | `approve`: الفعل يصير طلب في مركز الاعتماد. `auto`: ينفّذ داخل حواجز الإيجنت (3.6) | `buyer_actions` (032)، مركز الاعتماد (3.1) |
| Guardrails | السقوف، النطاق المعلَّم، 48 ساعة، زر الطوارئ | `src/modules/buyer/exec/guards.ts` |
| Idempotency (24 ساعة) | نفس المفتاح ونفس الطلب = نفس الجواب؛ مفتاح بطلب مختلف = `409` | فهرس `buyer_actions_one_live`؛ جدول جديد `mcp_idempotency` |
| Platform adapters | واحد لكل شبكة: Meta، Snapchat، Google، TikTok (عبر TikTok MCP الرسمي كـ upstream، `src/lib/mcp-oauth.ts`)، X وLinkedIn (عبر Postiz، أو Zernio اختياري)، GA4 | `src/modules/buyer/exec/{meta,snap}.ts`، `src/modules/social/{social,postiz}.ts`، فحوص `src/lib/account-health.ts` |
| Token Vault + refresher | توكنات كل شركة في Vault بأسماء `conn:<company>:NAME`، ومهمة ساعية تجدد اللي يقرب انتهاؤه | Vault (005)، ADR-0004، ADR-0006 |
| Async jobs | الشغل الثقيل (تقارير، رفع مواد، سحب تاريخ طويل) يرجع `job_id` ويتابع في الخلفية | Workflows (`JOURNEY` في `wrangler.jsonc`) + جدول `mcp_jobs` |
| Events / webhooks | `post.published`، `ad_action.applied`، `account.disconnected`… للخارج، موقّعة | 3.8 |
| Audit | كل نداء كتابة: من، أي أداة، قبل/بعد، النتيجة، `idempotency_key` | `audit_log` |

**النطاقات (قرار لين: «ويكون صلاحية كتابة»):**
- **إيجنتس وِل والواجهة والمهام المجدولة:** نطاق `read-write` افتراضياً. تشمل الكتابة:
  - الإعلانات: إنشاء وتعديل وإيقاف الحملات والمجموعات والإعلانات والميزانيات، والجماهير، والمواد؛
  - النشر؛
  - ردود الصندوق؛
  - أفعال الحسابات.
- **السياسة ما تتغيّر:** الكتابة تمر بالحواجز، وبدون «تلقائي» مفعّل للإيجنت تصير طلب اعتماد.
- **العملاء من برّا** (أدوات أو إيجنتس خارجية): نطاق `read` افتراضياً، و`read-write` بس لو لين أعطت المفتاح هالنطاق بنفسها.

**صلاحيات الكتابة المطلوبة من كل منصة** (الربط الحالي أغلبه قراءة، فيحتاج إعادة ربط في M12a). القائمة من توثيق المنصات كما نعرفه، **وتُراجع على التوثيق الرسمي وقت التنفيذ** لأن المنصات تغيّر أسماءها ومستويات الوصول:
| المنصة | للإعلانات | للنشر والصندوق | ملاحظات |
|---|---|---|---|
| ميتا (Facebook/Instagram) | `ads_management`، `ads_read`، `business_management` (إذا الحساب الإعلاني داخل Business Manager) | `pages_show_list`، `pages_read_engagement`، `pages_manage_posts`، `instagram_basic`، `instagram_content_publish`؛ للصندوق: `pages_manage_engagement`، `pages_read_user_content`، `instagram_manage_comments`، `pages_messaging`، `instagram_manage_messages` | Advanced Access ومراجعة تطبيق ميتا لكل صلاحية؛ مستخدم نظام بصلاحية على الحساب الإعلاني المعلَّم بس |
| تيك توك | عبر TikTok MCP الرسمي (قاعدة لين): أدوات كتابة لما يوفّرها الخادم. البديل الرسمي Business API بصلاحيات إدارة الإعلانات والحملات والجماهير والمواد | النشر العضوي: Content Posting API (`video.upload`، `video.publish`) أو عبر Postiz | النشر العام يحتاج تدقيق تطبيق تيك توك؛ قبله الخصوصية `SELF_ONLY` (`docs/social-engine.md`) |
| سناب شات | Marketing API بنطاق `snapchat-marketing-api` (قراءة وكتابة) | — | دور على الحساب الإعلاني المعلَّم بس؛ الكتابة الحقيقية لسا ما انتأكدت (`docs/media-buyer/execution.md`) |
| قوقل أدز | نطاق OAuth `https://www.googleapis.com/auth/adwords` + Developer token بمستوى وصول يسمح بالكتابة (Basic أو Standard) | — | طلب مستوى الوصول من قوقل يأخذ وقت |
| X | — | `tweet.read`، `tweet.write`، `users.read`، `offline.access` | الكتابة عبر الـ API تحتاج باقة مدفوعة |
| لينكدإن | `rw_ads` (Advertising API) | `w_member_social` للحساب، و`w_organization_social` + `r_organization_social` للصفحة (Community Management API) | يحتاج موافقة لينكدإن على المنتج |
| GA4 / Search Console | — | — | قراءة بس (`analytics.readonly`، `webmasters.readonly`)، ما نحتاج كتابة |

**ترحيل الموجود (بدون تغيير سلوك):**
- **تنفيذ الميديا باير:** محوّلات ميتا وسناب تنتقل إلى `src/mcp/adapters/`.
- **النشر:** محرك Graph وPostiz يصيرون Adapters، والـ Cron ينادي `social.post.publish`.
- **فحوص صحة الحسابات** (M5) تصير `accounts.health.check`.
- **السحب الساعي بالبايثون** (`pipeline/`، GitHub Actions): يبقى مؤقتاً لأنه شغل ثقيل خارج الـ Worker. ينتقل إلى أدوات `insights.*` كمهام غير متزامنة في مرحلة لاحقة (M20)، والقرار عند لين (Q13).

**القبول:**
- `grep` آلي في الاختبارات: لا عنوان منصة خارج `src/mcp/adapters/`.
- نفس الفعل من الواجهة ومن `/mcp` ومن الـ Cron يكتب نفس صف السجل بنفس الشكل.
- مفتاح `read` على أداة كتابة = `403`.
- نفس `idempotency_key` مرتين = فعل واحد.

**الاختبار:** محاكاة لكل Adapter، واختبار جدول الأدوات (كل أداة لها schema ونطاق وسياسة)، وsmoke لـ `/mcp` (`tools/list`، أداة قراءة، أداة كتابة تصير طلب اعتماد).

### 3.1 مركز الاعتماد والعدّادات الحية

**القصة:** بصفتي معتمِداً، أريد قائمة واحدة بكل ما ينتظر اعتمادي، وعدداً حياً في القائمة الجانبية، حتى لا يفوتني شيء ولا أتنقل بين الصفحات.

**السلوك:**
- صفحة `/approvals/` تجمع: منشورات تنتظر الاعتماد (`social_posts` غير معتمدة)، إجراءات الميديا باير (`buyer_actions.status='proposed'`)، مسودات الإعلانات (3.6)، ردود الصندوق (3.5)، والدروس الجديدة (`lessons.status='new'`).
- كل عنصر يظهر لمن يملك صلاحية اعتماده فقط (المعتمِد المسمّى للسوشال، صلاحية «موافقة» للقرارات).
- العدّاد في القائمة يتحدّث كل 60 ثانية وعند العودة للتبويب (`visibilitychange`)، دون اتصال دائم.
- الاعتماد يبقى في مساره الأصلي: الصفحة تستدعي نفس نقاط الـ API الحالية (مثل اعتماد المنشور في `src/modules/social/routes.ts:92`)، ولا تتجاوز أي حاجز.

**الواجهة:**
- تبويبات (Tabs): «الكل»، «النشر»، «الإعلانات»، «الردود»، «الدروس». كل عنصر بطاقة: ما الذي سيحدث، الأثر (مالي للإعلانات)، من أنشأه، متى، وأزرار «اعتمد» و«ارفض» (الرفض يطلب سبباً).
- العنصر المالي يفتح Dialog التأكيد الثاني القائم (نفس `execution.md` الخطوة 3).
- اختصارات: `J/K` للتنقل، `A` اعتماد (يفتح التأكيد ولا ينفّذ مباشرة)، `R` رفض.
- **فارغ:** «ما فيه شي ينتظرك. كل شي معتمد.» **خطأ:** «ما قدرنا نجيب القائمة. جرّب مرة ثانية» مع زر إعادة.

**البيانات (`038_approvals.sql`):** View `approval_queue` (union من الجداول أعلاه بأعمدة موحّدة: `company_id, kind, ref_id, title, created_at, created_by, money_effect`). لا جدول جديد.

**API:** `GET /api/approvals/counts` ← `{ total, social, ads, inbox, lessons }`؛ `GET /api/approvals/list?kind=&cursor=`.

**الحواجز:** العدد لا يكشف ما لا يملك المستخدم صلاحيته. لا نص منشورات أو رسائل في العدّاد.

**القبول:**
- العدّاد يطابق عدد العناصر في الصفحة لنفس المستخدم.
- مستخدم بلا صلاحية اعتماد يرى صفراً ولا يرى الصفحة في القائمة.
- اعتماد منشور من `/approvals/` يعطي نفس صف `audit_log` الناتج من صفحة السوشال.

**الاختبار:** وحدات للـ View والصلاحيات (`tests/unit/approvals.test.ts`)، وsmoke Playwright لصفحة فارغة وصفحة بعنصرين، واختبار «شركة أخرى ترى صفراً».

### 3.2 النشر v2: طلب واحد لعدة منصات، نص لكل منصة، طابور مواعيد، تقويم

**القصة:** بصفتي مسؤول محتوى، أريد كتابة المنشور مرة، وتعديل النص لكل منصة، ووضعه في أقرب موعد فارغ، ورؤية الأسبوع في تقويم.

**السلوك:**
- المنشور الواحد يحمل `overrides` لكل منصة (نص، وسائط). بلا تخصيص يُستخدم النص الأساسي.
- التحقق من حدود كل منصة يجري على النص النهائي لكل منصة (القائم في `engine.ts` و`CAPS`).
- **طابور المواعيد (queue slots):** لكل حساب أوقات أسبوعية (مثلاً الأحد 8م). «أضف للطابور» يضع المنشور في أول موعد فارغ بتوقيت الرياض.
- الاعتماد قبل النشر يبقى كما هو (`013_social_approver.sql`): الطابور لا يعتمد شيئاً.
- **التقويم:** عرض شهري وأسبوعي، سحب وإفلات لتغيير الموعد قبل الاعتماد فقط. المعتمد يحتاج إعادة اعتماد عند تغيير موعده.

**الواجهة:**
- محرر بتبويب لكل منصة مختارة، وعدّاد أحرف حي، وتنبيه عند تجاوز الحد، ومعاينة HTML للمنشور بشكل المنصة (لا صور ثابتة).
- أزرار: «أضف للطابور»، «حدّد موعد»، «احفظ مسودة». أيقونة قفل على المنشور المعتمد في التقويم.
- **فارغ (التقويم):** «ما فيه منشورات هالأسبوع. ابدأ بمنشور جديد» مع زر. **خطأ نشر:** شارة حمراء على المنصة الفاشلة مع رسالة المحرك المختصرة وزر «أعد المحاولة» (مرة واحدة، القائم في `023_social_recovery.sql`).
- **التقويم:** نقترح FullCalendar (MIT للعروض الأساسية) أو بناء عرض شهري بسيط بـ shadcn؛ القرار في M6 بعد قياس حجم الحزمة (هدف ≤ 60KB gzip للصفحة).

**التنفيذ (تحديث 2026-11-20):** النشر ينادي أداة `social.post.publish` في Well MCP (3.0)، والمحركات (Graph، Postiz، Zernio إن اعتُمد) Adapters تحته.

**البيانات (ميجريشن `039_social_v2.sql`، كان مقترح 041):**
```sql
alter table social_posts add column if not exists overrides jsonb not null default '{}'; -- { "<platform>": { "body": text, "media": [...] } }
alter table social_posts add column if not exists slot_id bigint;
create table social_slots (id bigserial primary key, company_id uuid not null, platform text not null,
  weekday smallint not null check (weekday between 0 and 6), at_local time not null, created_by text, created_at timestamptz default now(),
  unique (company_id, platform, weekday, at_local));
```

**API:** `POST /api/social/posts` يقبل `platforms[]` و`overrides`؛ `POST /api/social/queue` (يحسب الموعد في السيرفر)؛ `GET/POST/DELETE /api/social/slots`؛ `PATCH /api/social/posts/:id/time` (يرفض المعتمد إلا بإعادة اعتماد).

**الحواجز:** النص المخصّص يمر بفاحص الامتثال (تنبيه) قبل الاعتماد. تغيير موعد منشور معتمد يُسقط الاعتماد ويُسجَّل.

**القبول:** منشور واحد لثلاث منصات بثلاثة نصوص يُنشر كل نص على منصته؛ «أضف للطابور» يختار أول موعد فارغ بتوقيت الرياض؛ سحب منشور معتمد في التقويم يعيده لحالة «ينتظر الاعتماد».

**الاختبار:** وحدات لحساب أول موعد (بما فيه منتصف الليل الرياض/UTC، والدرس R-13 في `docs/review-2026-11.md`)، ولدمج `overrides`؛ اختبار على `postiz-mock.ts` و`graph-mock.ts` أن كل منصة تتلقى نصها فقط.

### 3.3 محرك النشر: تقييم Zernio بديلاً لـ Postiz، وwebhooks النشر

> **تحديث 2026-11-20:** المحرك صار Adapter تحت Well MCP (3.0). Zernio خيار Adapter، مو اعتمادية. التقييم أدناه يبقى كما هو، والنتيجة تحدد هل نضيف Adapter Zernio.


**القصة:** بصفتي المالكة، أريد محرك نشر لا يحتاج خادماً أديره، ويخبرني فوراً بنجاح النشر أو فشله.

**السلوك (مرحلتان):**
1. **تقييم (spike، وثيقة فقط):** `docs/adr/0009-publishing-engine.md` يقارن Postiz وZernio على: الترخيص (Postiz AGPL)، التشغيل (Postiz يحتاج VM وTemporal)، دعم `Idempotency-Key`، webhooks، المنصات (تيك توك، X، لينكدإن)، ملكية تطبيقات المنصات (تطبيقنا أم تطبيقهم)، مكان حفظ البيانات (PDPL)، السعر، وحدود المعدّل. يُختبر Zernio بمنشور تجريبي واحد لكل منصة على حساب تجربة **بعد موافقة لين ومفتاح تدخله بنفسها**.
2. **التنفيذ (إن اعتمدت لين):** `src/modules/social/zernio.ts` محرك ثالث بجانب `native` و`postiz` في `engine.ts`، بنفس العقد (التحقق، الاستيراد، الإنشاء مرة واحدة، المتابعة). يُختار المحرك لكل منصة من الإعدادات، فالتحويل تدريجي ويمكن الرجوع. **فيسبوك وانستقرام يبقيان على محركنا.** تيك توك عضوي يبقى خارج أي محرك إلى أن تقرر لين (Q4)، لأن قاعدة MCP تخص بيانات تيك توك.

**Webhooks النشر:**
- **واردة:** إن دعم المحرك webhooks، نقطة `POST /api/social/hooks/:engine` موقّعة HMAC تحدّث `results` فوراً بدل الانتظار؛ يبقى الاستطلاع احتياطاً.
- **صادرة:** حدث `post.published` و`post.failed` عبر طبقة الـ webhooks الصادرة (3.8)، وتنبيه للمعتمِد (Sonner داخل التطبيق، وإيميل اختياري عبر Resend القائم في `watchdog.ts`).

**البيانات:** `companies.social_engines jsonb` (`{ "x": "zernio", "linkedin": "postiz" }`)؛ لا تغيير على `social_posts.results`.

**الحواجز:** لا إعادة لنداء الإنشاء أبداً بلا مفتاح idempotency من المحرك (القاعدة القائمة في `social-engine.md` «Never double-post»). توقيع كل webhook وارد ورفض ما يتجاوز 5 دقائق.

**القبول:** ADR معتمد من لين؛ عند التفعيل، منشور تجريبي لكل منصة ينجح، والتحويل بين المحركين لا يغيّر سلوك الاعتماد (اختبار «منشور غير معتمد = صفر نداءات» يمر على المحرك الجديد).

**الاختبار:** `zernio-mock.ts` بنفس أسلوب `postiz-mock.ts`؛ اختبار التوقيع والتكرار للـ webhook الوارد.

### 3.4 صحة الحسابات: فحص دوري، مهلة ساعة، مجموعات

> **الحالة:** مبني في M5 (#360). الفحوص تنتقل إلى أداة `accounts.health.check` في Well MCP (3.0)، وتجديد التوكنات ينضاف للـ Token Vault.


**القصة:** بصفتي المالكة، أريد معرفة الحساب الذي توقف قبل أن يفشل منشور أو يتوقف السحب، دون أن ينفصل الحساب لخطأ عابر.

**السلوك:**
- فحص كل ساعة (ضمن الـ Cron الساعي القائم `hourlyTasks` في `src/lib/cron.ts:62`، لأن الباقة المجانية تسمح بخمسة Cron فقط، `cron.ts:59`) لكل ربط: نداء قراءة رخيص (مثل `/me` في Graph).
- الحالات: `ok`، `degraded` (أول فشل)، `expiring` (ينتهي خلال 7 أيام، مثل تيك توك MCP 30 يوماً `mcp-oauth.ts:14`)، `disconnected`.
- **مهلة ساعة:** أول فشل يجعل الحساب `degraded` ويحدد `grace_until = now()+1h`. فشل بعد انتهاء المهلة = `disconnected` وتنبيه. نجاح خلال المهلة يعيده `ok` بلا تنبيه.
- **مجموعات الحسابات:** تجميع حسابات (مثلاً «القبالة»: صفحة فيسبوك + انستقرام + لينكدإن) لاختيارها مرة في النشر والصندوق والتقارير.

**الواجهة:** في `/connectors/` شارة حالة لكل حساب وآخر فحص، وزر «افحص الحين»، وزر «أعد الربط» عند `disconnected/expiring`. تبويب «المجموعات»: إنشاء، تسمية، إضافة حسابات. **فارغ:** «ما عندك مجموعات. جمّع حساباتك عشان تختارها مرة وحدة».

**البيانات (`039_account_health.sql`):**
```sql
create table account_health (company_id uuid not null, platform text not null, account_ref text not null,
  status text not null check (status in ('ok','degraded','expiring','disconnected')), last_check_at timestamptz,
  first_failed_at timestamptz, grace_until timestamptz, error_code text, expires_at timestamptz,
  primary key (company_id, platform, account_ref));
create table account_groups (id bigserial primary key, company_id uuid not null, name text not null, unique (company_id, name));
create table account_group_members (group_id bigint references account_groups on delete cascade, platform text, account_ref text,
  primary key (group_id, platform, account_ref));
```
`account_ref` معرّف المنصة فقط، و`error_code` رمز قصير (مثل `meta_190`) لا نص رسالة.

**API:** `GET /api/accounts/health`؛ `POST /api/accounts/health/check` (يدوي، معدّل محدود)؛ CRUD `/api/accounts/groups`.

**القبول:** فشل واحد ثم نجاح خلال ساعة = لا تنبيه؛ فشلان بينهما أكثر من ساعة = تنبيه واحد؛ لا رمز في أي رد.

**الاختبار:** وحدات للانتقال بين الحالات بوقت مزيّف؛ اختبار أن الفحص لا يكتب شيئاً على المنصات (قراءة فقط).

### 3.5 صندوق الوارد الموحّد

**القصة:** بصفتي مسؤول تواصل، أريد رؤية التعليقات والرسائل والإشارات في مكان واحد، والرد والإخفاء دون فتح كل تطبيق، وبرد معتمد.

**السلوك (مرحلتان):**
- **المرحلة 1 (M12):** تعليقات فيسبوك وانستقرام على منشورات الصفحة والإعلانات، عبر Graph بمحركنا: قراءة، رد، إخفاء/إظهار، إعجاب، حذف. الإشارات (mentions) في انستقرام.
- **المرحلة 2 (M13):** رسائل Messenger وInstagram Direct، وردود تلقائية بالكلمات المفتاحية (تعليق ← رد علني + رسالة خاصة)، وجهات اتصال، وتصنيفات.
- **خارج النطاق:** واتساب، تيك توك (قاعدة MCP، ولا أداة رسائل معتمدة)، المراجعات (Google Business Profile لاحقاً، Q9)، البريد، البث الجماعي.
- **الاعتماد:** الرد والحذف يمرّان بالاعتماد افتراضياً. الإخفاء (قابل للعكس) يُنفَّذ فوراً لمن يملك الصلاحية ويُسجَّل. الرد التلقائي لا يُرسَل إلا بعد اعتماد **القالب** (لا كل رد)، وبوضع «اعتماد لكل رد» افتراضياً حتى تفعّل لين «تلقائي» للقاعدة.
- **نوافذ المنصات:** ميتا تسمح بالرسالة الخاصة الرد على تعليق مرة واحدة وخلال مدة محددة، ورسائل Messenger خلال 24 ساعة من آخر رسالة للعميل. القيم تُقرأ من توثيق ميتا عند التنفيذ ولا تُكتب هنا تخميناً؛ النظام يمنع الإرسال خارج النافذة ويعرض السبب.
- **الجلب:** webhooks ميتا (اشتراك الصفحة `feed` و`messages`) إلى `POST /api/inbox/hooks/meta` مع التحقق من `X-Hub-Signature-256`، واستطلاع ساعي احتياطي.

**الواجهة:** ثلاثة أعمدة على الشاشة الواسعة (قائمة المحادثات، المحادثة، تفاصيل جهة الاتصال)، وعمود واحد بتبديل على الجوال. فلاتر: المنصة، النوع، الحالة (مفتوح/منتهي/مخفي)، التصنيف، مجموعة الحسابات. محرر الرد مع اقتراح من الكوبي رايتر وفاحص الامتثال. **فارغ:** «ما فيه رسائل جديدة». **خطأ ربط:** «الحساب محتاج إعادة ربط» مع رابط لصفحة الربط.

**البيانات (`045_inbox.sql`):**
```sql
create table inbox_contacts (id uuid primary key default gen_random_uuid(), company_id uuid not null, platform text not null,
  external_id text not null, display_name text, labels text[] default '{}', first_seen_at timestamptz, last_seen_at timestamptz,
  erased_at timestamptz, unique (company_id, platform, external_id));
create table inbox_threads (id uuid primary key default gen_random_uuid(), company_id uuid not null, platform text not null,
  account_ref text not null, kind text not null check (kind in ('comment','dm','mention')), external_id text not null,
  post_ref text, contact_id uuid references inbox_contacts, status text not null default 'open' check (status in ('open','done','hidden')),
  labels text[] default '{}', last_at timestamptz, unique (company_id, platform, external_id));
create table inbox_messages (id uuid primary key default gen_random_uuid(), company_id uuid not null, thread_id uuid references inbox_threads on delete cascade,
  direction text check (direction in ('in','out')), external_id text, body text, at timestamptz, deleted_at timestamptz,
  unique (company_id, external_id));
create table inbox_actions (id uuid primary key default gen_random_uuid(), company_id uuid not null, thread_id uuid references inbox_threads,
  kind text check (kind in ('reply','private_reply','dm','hide','unhide','like','delete')), body text, status text default 'proposed'
  check (status in ('proposed','rejected','sending','sent','failed')), idem_key text not null, created_by text, decided_by text,
  decided_at timestamptz, result jsonb, created_at timestamptz default now());
create unique index inbox_actions_one_live on inbox_actions (company_id, idem_key) where status in ('proposed','sending','sent');
create table auto_reply_rules (id bigserial primary key, company_id uuid not null, platform text not null, post_ref text,
  keywords text[] not null, public_reply text, private_reply text, mode text default 'approve' check (mode in ('approve','auto')),
  enabled boolean default false, approved_by text, approved_at timestamptz);
```

**API:** `GET /api/inbox/threads`، `GET /api/inbox/threads/:id`، `POST /api/inbox/threads/:id/actions` (ينشئ مقترحاً)، `POST /api/inbox/actions/:id/approve|reject`، `PATCH /api/inbox/threads/:id` (الحالة والتصنيف)، CRUD `/api/inbox/rules`، `POST /api/inbox/hooks/meta`.

**الحواجز:** لا إرسال بلا اعتماد (إلا قاعدة `auto` فعّلتها لين)، سقف للردود التلقائية (مثلاً 50 في الساعة لكل حساب، قابل للتعديل)، لا رد على نفس التعليق مرتين (الفهرس الفريد)، الحذف بتأكيد ثانٍ، ولا يُرسل نص رسالة العميل لأي نموذج ذكاء اصطناعي إلا بقرار لين (Q8). الإيميلات وأرقام الجوال داخل الرسائل تُخفى في السجل.

**القبول:** تعليق جديد يظهر خلال دقيقة (webhook) أو ساعة (احتياط)؛ رد معتمد يُنشر مرة واحدة حتى مع ضغطتين؛ رد قبل الاعتماد = صفر نداءات كتابة؛ قاعدة بكلمة «سعر» تُنشئ مقترح رد واحد لكل تعليق مطابق.

**الاختبار:** `graph-mock.ts` موسّع للتعليقات والرسائل؛ اختبار التوقيع؛ اختبار النافذة الزمنية؛ اختبار «شركة أخرى لا ترى المحادثة»؛ اختبار المسح (PDPL) يحذف النص ويبقي العدّ.

### 3.6 طبقة الكتابة الإعلانية: إنشاء وتعديل وتعزيز، بوضعين «بموافقتي» و«تلقائي»

**القصة:** بصفتي المالكة، أبي الميديا باير يجهّز ويعدّل الحملات بنفسه. في الوضع العادي كل شي ينتظر اعتمادي. ولما أفعّل «تلقائي» لإيجنت معيّن، يشتغل بدون انتظار داخل حدود أحددها، وأقدر أوقفه كله بضغطة.

**القرارات:**
- Q1 (2026-11-19): كل إنشاء/تعديل بموافقة لين.
- لين 2026-11-20: وضع «تلقائي» لكل إيجنت. **«بموافقتي» يبقى الافتراضي** لين ما تقلبه بنفسها.

**الأدوات (في Well MCP، 3.0):**
- `ads.campaign.create|update|pause|resume`
- `ads.adset.create|update|pause|resume`
- `ads.ad.create|update|pause|resume`
- `ads.budget.update`
- `ads.post.boost`
- `ads.audience.create` (بكسل، متفاعلين، مشابه؛ لا رفع قوائم عملاء: Q7)
- `ads.creative.upload`
- `ads.conversion.attach`
- المنصات: ميتا أولاً، سناب بعد إغلاق بند التحقق الحقيقي، جوجل لاحقاً. تيك توك عبر TikTok MCP لما يوفّر أداة كتابة معتمدة، وإلا «نفّذه يدوياً».

**الوضعان:**
| | «بموافقتي» (الافتراضي) | «تلقائي» (لكل إيجنت، تفعّله لين) |
|---|---|---|
| الفعل | يصير طلب في مركز الاعتماد (3.1) مع الأثر المالي | ينفّذ مباشرة إذا مر بكل الحواجز، وإلا يتحول لطلب اعتماد مع السبب |
| الإنشاء | يُنشأ **متوقفاً**، والتشغيل طلب ثاني | يُنشأ متوقفاً افتراضياً؛ إعداد `create_active` لكل إيجنت تقلبه لين لو تبي يطلق مباشرة |
| التنبيه | عند الطلب | بعد كل تنفيذ (Sonner داخل التطبيق + القناة المختارة) |

**الحواجز (إلزامية في الوضعين، في الكود وليس في الإعدادات وحدها):**
- **النطاق:** الحسابات الإعلانية والحملات اللي تعلّمها لين فقط (`managed_campaigns`، وحساب كامل لو علّمته). الإنشاء داخل حساب معلَّم يضيف الحملة الجديدة للنطاق تلقائياً.
- **سقف تغيير الميزانية اليومي:** لكل كيان، الافتراضي 20% في اليوم (توقيت الرياض)، وسقف صلب 50% (القائم في `guards.ts`).
- **سقف الصرف:**
  - يومي لكل حملة؛
  - يومي إجمالي للإيجنت؛
  - مجموع زيادات الميزانية اليومية (القائم).
  - غير محدد = ما فيه زيادة تتنفّذ تلقائياً.
- **تغيير واحد لنفس الكيان كل 48 ساعة** (التراجع مستثنى).
- **قراءة قبل الكتابة وبعدها:** لو القيمة تغيّرت عن المتوقع يلغى؛ بعد الكتابة نتأكد إنها صارت المطلوبة.
- **Idempotency 24 ساعة** على كل أداة تصرف.
- **سجل كامل:** قبل/بعد، الأداة، الإيجنت، الوضع، `idempotency_key`، النتيجة.
- **القياس التلقائي:** كل فعل يُقاس بعد 3 و7 أيام، والنتيجة تدخل حلقة التعلّم (3.7، مبني في M8). الإيجنت اللي نتائجه «أسوأ» في 3 من آخر 5 أفعال ينطفي «تلقائي» عنده ويرجع «بموافقتي» مع تنبيه للين.
- **مفتاح إيقاف واحد:** زر الطوارئ القائم (`control_settings` `guardrails.kill`) يوقف كل تنفيذ فوراً، تلقائي أو معتمد، ويقلب كل الإيجنتس إلى «بموافقتي». يُقرأ مرتين: عند الطلب وقبل الكتابة مباشرة.

**الواجهة:**
- **في لوحة القرارات ← «الأتمتة» (للمالكة فقط):** صف لكل إيجنت فيه:
  - المفتاح «بموافقتي / تلقائي»؛
  - الحدود (سقف التغيير، سقف الصرف اليومي، الأنواع المسموحة، `create_active`)؛
  - النطاق المعلَّم؛
  - آخر 10 أفعال مع نتائجها؛
  - وزر الطوارئ ظاهر دايم.
- **تفعيل «تلقائي»** يفتح AlertDialog يلخص الحدود ويطلب كتابة «أفعّل».
- **في «مسودات الإعلانات»:** شجرة الحزمة، ومعاينة HTML، والأثر المالي الأقصى، والحواجز اللي مرّت أو منعت. والأزرار: «اعتمد وأنشئ متوقفاً»، «عدّل»، «ارفض».
- **فارغ:** «ما فيه مسودات. جهّز حملة من «حملة جديدة»».
- **خطأ:** رمز قصير، ورابط للكيان في مدير الإعلانات.

**البيانات (ميجريشن جديد في مرحلته):**
- `buyer_actions` يتوسّع: `bundle_id`، `payload`، `created_entity_id`، `actor` (`human` / `agent:<name>` / `api` / `cron`)، `mode` (`approve` / `auto`).
- جداول جديدة:
  - `managed_campaigns` (أو حسابات كاملة)؛
  - `automation_settings`: لكل شركة وإيجنت: `enabled`، `limits jsonb` (`max_change_pct`، `daily_spend_cap`، `campaign_daily_cap`، `kinds`، `create_active`)، `enabled_by`، `enabled_at`، `disabled_reason`؛
  - `mcp_idempotency`: المفتاح، الأداة، بصمة الطلب، الجواب، ينتهي بعد 24 ساعة.

**القبول:**
- بدون «تلقائي»: أي أداة كتابة = طلب في مركز الاعتماد، وصفر نداءات للمنصة.
- مع «تلقائي» وداخل الحدود: ينفّذ ويُسجَّل ويُقاس بعد 3 و7 أيام.
- خارج الحدود: يتحول لطلب اعتماد مع السبب.
- زر الطوارئ أثناء «تلقائي»: لا تنفيذ، وكل الإيجنتس «بموافقتي».
- نفس `idempotency_key`: فعل واحد.

**الاختبار:**
- محاكاة Marketing API، واختبار لكل حاجز وكل وضع، واختبار التحول التلقائي إلى «بموافقتي» بعد النتائج السيئة.
- أول تنفيذ حقيقي على حملة تجربة بإشراف لين.

### 3.7 حلقة التعلّم: تشغيلها

**القصة:** بصفتي المالكة، أريد أن يُقاس كل قرار تلقائياً، وأن أرى مع الاقتراح التالي ماذا حدث في المرات السابقة لنفس القاعدة.

**السلوك:**
- القياس بعد 3 و7 أيام يصبح مهمة ساعية في `hourlyTasks` بدل فتح التبويب (يستدعي نفس منطق `POST /api/buyer/outcomes`)، بتوقيت الرياض (يغلق R-20 بعد موافقة لين على تغيير التواريخ).
- كل نتيجة تُكتب في `buyer_outcomes`، وعند تجمّع 8 نتائج واضحة لقاعدة (`tune` في `learn.ts`) يُنشأ درس في `lessons` (`module='ads'`، `status='new'`) يظهر في مركز الاعتماد.
- **التغذية:** بطاقة الاقتراح تعرض «سجل القاعدة»: عدد مرات التنفيذ، نسبة النجاح، آخر درس معتمد. **العتبات لا تتغير تلقائياً:** اقتراح تعديل العتبة يبقى PR تطويرياً تعتمده لين (`docs/media-buyer/learning-loop.md`).
- القرارات المرفوضة تُسجَّل كدليل سلبي (لا تدخل في نسبة النجاح).

**الواجهة:** في بطاقة الاقتراح سطر «القاعدة نجحت 6 من 8 مرات (آخر 90 يوم)» مع Tooltip يشرح. صفحة «وش تعلّمت» القائمة تعرض الدروس مع «اعتمد/تجاهل».

**البيانات:** `040_learning_on.sql`: `buyer_outcomes.measured_by text default 'cron'`، و`lessons.rule_id text`، وفهرس `(company_id, rule_id, status)`.

**القبول:** إجراء نُفّذ قبل 3 أيام يُقاس خلال ساعة دون فتح أي صفحة؛ لا يُقاس مرتين؛ الاقتراح يعرض سجل قاعدته؛ لا تتغير أي عتبة في `playbook.ts` تلقائياً.

**الاختبار:** وحدات بوقت مزيّف حول منتصف الليل الرياض؛ اختبار أن المهمة الساعية لا تكتب على أي منصة؛ اختبار عدم التكرار.

### 3.8 طبقة المطوّرين والإيجنتس

> **تحديث 2026-11-20:** صارت جزء من Well MCP (3.0): المفاتيح والنطاقات (`read` / `read-write`) والـ Idempotency والـ webhooks تخدم كل النداءات، داخلية وخارجية. التفاصيل أدناه تبقى، وأدوات `propose_*` صارت نفس أدوات الكتابة تحت سياسة «بموافقتي».


**القصة:** بصفتي مالكة لعدة إيجنتس وأدوات، أريد مفتاحاً لكل أداة بصلاحية محددة، ونداءات آمنة من التكرار، وإشعاراً عند الأحداث، وخادم MCP يقرأ ويقترح ولا ينفّذ.

**السلوك:**
- **مفاتيح API:** جدول مفاتيح لكل شركة، كل مفتاح بنطاق: `read` (مثل `/api/v1` اليوم) أو `propose` (ينشئ مقترحات تنتظر الاعتماد فقط). **لا نطاق تنفيذ.** المفتاح يُعرض مرة واحدة عند إنشائه، ويُحفظ SHA-256 فقط. `READ_API_KEY` القائم يبقى يعمل حتى تلغيه لين.
- **Idempotency:** كل `POST` في `/api/v1` وكل نداء ينشئ إنفاقاً يتطلب ترويسة `Idempotency-Key`. نفس المفتاح ونفس الجسم خلال 24 ساعة = نفس الرد المحفوظ؛ نفس المفتاح بجسم مختلف = `409`.
- **Webhooks صادرة:** أحداث: `approval.pending`، `post.published`، `post.failed`، `ad_action.applied`، `ad_action.failed`، `account.disconnected`، `alert.fired`، `report.ready`. توقيع HMAC-SHA256 في ترويسة `Well-Signature` مع طابع زمني، إعادة محاولة بتباعد (حتى 6 محاولات في 24 ساعة)، وإيقاف تلقائي بعد فشل متكرر مع تنبيه. الحمولة معرّفات وحالات وأعداد، **بلا نصوص رسائل عملاء ولا بيانات شخصية**.
- **خادم MCP عام:** `/mcp` (Streamable HTTP) في نفس الـ Worker عبر Hono، يصادق بمفتاح API. أدوات قراءة (`get_overview`، `list_ads`، `list_decisions`، `get_health`) وأدوات اقتراح (`propose_post`، `propose_ad_action`) تنشئ عناصر في مركز الاعتماد فقط. أدوات الاقتراح تتطلب `idempotency_key`.

**الواجهة:** صفحة «المطوّرين» في الإعدادات (للمالكة): المفاتيح (إنشاء، نسخ مرة واحدة، إلغاء، آخر استخدام)، الـ webhooks (رابط، أحداث، «أرسل حدث تجربة»، سجل آخر 50 تسليماً)، وتعليمات ربط MCP.

**البيانات (`042_dev_layer.sql`):**
```sql
create table api_keys (id uuid primary key default gen_random_uuid(), company_id uuid not null, name text not null,
  prefix text not null, hash text not null unique, scope text not null check (scope in ('read','propose')),
  created_by text, created_at timestamptz default now(), last_used_at timestamptz, revoked_at timestamptz);
create table idempotency_keys (company_id uuid not null, key text not null, route text not null, request_hash text not null,
  status int, response jsonb, created_at timestamptz default now(), expires_at timestamptz not null,
  primary key (company_id, key));
create table webhook_endpoints (id uuid primary key default gen_random_uuid(), company_id uuid not null, url text not null,
  events text[] not null, secret_name text not null, active boolean default true, created_by text, created_at timestamptz default now(),
  failures int default 0, disabled_at timestamptz);
create table webhook_deliveries (id bigserial primary key, company_id uuid not null, endpoint_id uuid references webhook_endpoints on delete cascade,
  event text not null, event_id uuid not null, status text default 'pending', attempts int default 0, next_at timestamptz,
  last_code int, created_at timestamptz default now(), unique (endpoint_id, event_id));
```
سرّ التوقيع في Vault (`secret_name`) لا في الجدول. حذف `idempotency_keys` المنتهية ضمن المهمة الساعية.

**الحواجز:** HTTPS فقط ولا عناوين داخلية أو IP خاصة لروابط webhooks (نفس منطق `src/modules/video/safe-fetch.ts`)؛ حد معدّل لكل مفتاح؛ مفتاح `propose` لا يصل لأي مسار تنفيذ (اختبار جدول المسارات مثل `tests/unit/route-table.test.ts`).

**القبول:** نفس `Idempotency-Key` مرتين = عنصر واحد في مركز الاعتماد؛ مفتاح `read` على `POST` = `403`؛ webhook بتوقيع صحيح يتحقق منه مثال الكود في التوثيق؛ رابط `http://10.0.0.1` مرفوض.

**الاختبار:** وحدات للتوقيع والتكرار والانتهاء؛ smoke لـ `/mcp` (`tools/list` و`propose_post`)؛ اختبار أن مفتاحاً ملغى يرجع `401` فوراً.

### 3.9 تقارير غير متزامنة وتنبيهات أداء

**القصة:** بصفتي المالكة، أريد تقريراً ثقيلاً (مثلاً 12 شهراً بكل الإعلانات) دون أن تتجمّد الصفحة، وتنبيهاً عندما تتجاوز تكلفة الليد حداً أحدده.

**السلوك:**
- **التقارير:** الطلب ينشئ مهمة، والتنفيذ في GitHub Actions (القائم لكل ما هو ثقيل، ADR-0003) أو في Workflow للـ Worker إن كان خفيفاً، والناتج CSV/JSON في R2 خاص برابط موقّع ينتهي خلال 24 ساعة، وإشعار «التقرير جاهز».
- **التنبيهات:** قواعد بسيطة لكل شركة: مقياس (CPL، الصرف اليومي، CTR، توقف التسليم)، شرط، حد، نطاق (منصة/حملة/قسم)، قناة (داخل التطبيق، إيميل، webhook). التقييم بعد كل سحب ساعي. التكرار مرة كل 6 ساعات كحد أقصى للقاعدة (نفس مبدأ `REPEAT_HOURS` في `watchdog.ts`).
- التنبيه **لا ينفّذ** شيئاً؛ يمكن أن يقترح إجراءً في مركز الاعتماد.

**الواجهة:** «التقارير»: قائمة المهام بحالتها، زر «تقرير جديد» (Dialog: الفترة، المستوى، الأعمدة). «التنبيهات»: قائمة القواعد بمفتاح تشغيل، وسجل آخر التنبيهات. **فارغ:** «ما فيه تنبيهات. أضف أول تنبيه».

**البيانات (`044_reports_alerts.sql`):** `report_jobs (id, company_id, kind, params jsonb, status, r2_key, requested_by, created_at, finished_at, error_code)`، `alert_rules (id, company_id, metric, op, threshold numeric, scope jsonb, channels text[], enabled, created_by)`، `alert_events (id, company_id, rule_id, fired_at, value numeric, delivered jsonb)`.

**API:** `POST/GET /api/reports`، `GET /api/reports/:id/download` (رابط موقّع)، CRUD `/api/alerts/rules`، `GET /api/alerts/events`.

**القبول:** تقرير 12 شهراً لا يتجاوز 30 ثانية من طلب الـ Worker (الطلب نفسه يرجع فوراً)؛ الرابط ينتهي بعد 24 ساعة؛ قاعدة تتحقق مرتين في 3 ساعات = تنبيه واحد.

**الاختبار:** وحدات لتقييم القواعد على بيانات صناعية؛ اختبار أن ملف التقرير لا يُخدم من المسارات العامة (مثل `private/` في R2).

### 3.10 بنود مفتوحة تُغلق ضمن هذا الإصدار
| البند | المطلوب | القبول |
|---|---|---|
| حارس الميجريشن | خطوة في `deploy.yml` قبل نشر الإنتاج تقارن `src/lib/migrations-list.ts` بـ `schema_migrations` وتوقف النشر عند النقص، وتفعيل `MIGRATIONS_STRICT=1` افتراضياً بعد تطبيق 033 وما بعده | نشر مع ميجريشن غير مطبّق يفشل برسالة تذكر اسم الملف |
| أهداف اللمس | كل عنصر تفاعلي ≥ 44×44px على الجوال (`.btn.sm` و`.btn.icon` اليوم 36px، `app.css:59,68`)، وفحص Playwright على 390px | اختبار smoke يمر على كل الصفحات الحية |
| منشورات تيك توك العضوية عبر MCP | إن وفّر خادم MCP لتيك توك أداة لمحتوى الحساب: سحبها في `pipeline/tiktok/mcp.py` إلى مفتاح `organic` في `tiktok.json` (الصيغة التي ينتظرها `pipeline/organic.py:29`). إن لم يوفّرها: يبقى «غير متاح» ونوثّق السبب | العضوي يعرض منشورات تيك توك، أو رسالة واضحة بالسبب |
| تاريخ تيك توك | محفوظ في R2 الخاص (يعمل). الباقي: قرار لين بحذف فرع `tiktok-data` العام وتاريخه (R-16) | قرار مسجّل |
| الخطوة القديمة `execute` | إزالتها بعد ثبات الطبقة الجديدة، لتبقى نقطة كتابة واحدة على ميتا | لا كاتب على ميتا خارج `src/modules/buyer/exec/` |
| تناقض أرقام الربط | رقم واحد للربط بالإعلان في `/overview` و`/maestro/health` و`/debugger` (إيجنت البيانات وCRM) | الثلاث صفحات تعرض نفس النسبة لنفس الفترة |

---

## 4. نظام الواجهة وتجربة الاستخدام

### 4.1 المبادئ (مأخوذة من نمط Zernio ومطبّقة على هوية وِل)
- **لون واحد للأفعال:** البنفسجي `#7E57FD` (`--accent` في `app.css:20`) للأزرار الأساسية والروابط النشطة فقط. الوردي `#F86080` للطوارئ والحذف فقط (كما ينص تعليق `app.css:22`).
- **خلفية دافئة ونص فحمي:** العاجي `#F6F0E3` خلفية، والنيلي `#1D1069` للنص، وأقسام «حبر» داكنة للملخصات المهمة.
- **مكوّنات متسقة، مسافات واسعة، أرقام حية، معاينات HTML بدل الصور، أقل عدد من الخطوات.**
- **عربي أولاً و RTL:** خصائص منطقية فقط (`ms-`/`pe-`/`start-`)، `components.json` فيه `rtl: true` (ADR-0007)، وخطوط ثمانية (Sans للواجهة، Serif للقراءة، Display للعناوين) من `public/assets/fonts/`، وأرقام جدولية `tabular-nums`.

### 4.2 مصدر واحد للتوكنات
- ملف واحد `src/styles/tokens.css` يعرّف التوكنات الدلالية (`--background`، `--foreground`، `--primary`، `--destructive`، `--muted`، `--border`، `--ring`، `--chart-1..5`، `--radius`) للفاتح، وتحت `.dark` و`[data-theme="dark"]` للداكن.
- `ui.css` يقرأ منه عبر `@theme inline`، و`app.css` يصبح طبقة توافق تعيد تعريف متغيراته القديمة (`--bg`، `--ink`، `--accent`...) من التوكنات الجديدة، فتتغير الصفحات القديمة مع الوضع الداكن دون إعادة كتابتها.
- اختبار تباين آلي (WCAG AA 4.5:1 للنص) على أزواج التوكنات في الوضعين.

### 4.3 الداكن للقوائم بس (قرار لين 2026-11-19)
القائمة الجانبية والقوائم المنسدلة داكنة دايم (لون وِل النيلي)، والمحتوى فاتح دايم، وما فيه مفتاح تبديل. مبني في M1 (#343): `public/assets/tokens.css` يعرّف السطوح الداكنة على `.side` و`.wl-side` و`.menu` والقوائم المنسدلة، وكل أزواج النص تمر AA.

### 4.4 القائمة الجانبية (shadcn Sidebar الرسمي)
- تستبدل `public/assets/sidebar.js` و`nav.js` بمكوّن `Sidebar` من shadcn (React island واحد في الـ layout)، بنفس المجموعات الست وترتيبها (`GROUPS`، `src/modules/registry.ts`) ونفس منطق الإخفاء والقفل.
- **عدّادات حية** بجانب «الاعتمادات» و«النشر» و«الصندوق» و«القرارات» من `GET /api/approvals/counts`.
- قابلة للطي (أيقونات فقط) وتحفظ حالتها، و`Sheet` على الجوال.
- كل عنصر بـ `data-slot` كما في shadcn الحديث.

### 4.5 لوحة الأوامر ⌘K والاختصارات
- `Ctrl/⌘+K` يفتح لوحة (`Command` من shadcn المبني على cmdk): انتقال لأي صفحة، «منشور جديد»، «تقرير جديد»، بحث في الحملات والمنشورات بالاسم، «شغّل زر الطوارئ» (يفتح التأكيد فقط).
- الاختصارات تُعرض بعنصر `kbd`. قائمة الاختصارات تفتح بـ `?`.
- لا اختصار ينفّذ فعلاً مالياً أو نشراً مباشرة: الاختصار يفتح التأكيد فقط.
- لا تتعارض مع حقول الإدخال (نفس شرط `control.js:425`).

### 4.6 المكوّنات المضافة
`sidebar`، `command`، `dialog`، `alert-dialog`، `tabs`، `tooltip`، `popover`، `sonner`، `calendar`، `textarea`، `label`، `switch`، `checkbox`، `separator`، `scroll-area`، `breadcrumb`، `avatar`. كل مكوّن يُضاف بـ `npx shadcn@latest add` ثم مراجعة الكلاسات المنطقية (ADR-0007).
- **Sonner** يستبدل `toast()` في `common.js:161` بغلاف بنفس التوقيع حتى تنتقل كل الصفحات.
- **Motion** (موجود في `package.json`) و`tw-animate-css` (موجود) للحركات القصيرة فقط، مع احترام `prefers-reduced-motion`.

### 4.7 حالات موحّدة
لكل شاشة: تحميل (Skeleton القائم `src/components/ui/skeleton.tsx`)، فارغ (جملة + فعل واحد)، خطأ (جملة بلا مصطلح تقني + «جرّب مرة ثانية»)، بلا صلاحية (قفل + من يمنحها). النصوص التقنية تبقى في صفحات المالكة فقط (ملاحظة الأوديت 10).

### 4.8 خطة إزالة `app.css`
1. M1: التوكنات الموحّدة وطبقة التوافق (لا تغيير شكل).
2. كل مرحلة تلمس صفحة تنقلها إلى مكوّنات shadcn وتحذف قواعدها من `app.css`.
3. مقياس: عدد أسطر `app.css` في كل PR (اليوم 478)، والهدف صفر في M17.

---

## 5. البنية والقرارات التقنية

| القرار | الاختيار | السبب والدليل |
|---|---|---|
| الحزمة | **نبقى:** Astro 7 + React islands + Tailwind v4 + shadcn + Hono على Workers | ADR-0001 وADR-0007؛ Next.js (حزمة Zernio) يحتاج OpenNext ولا يضيف ما نحتاجه |
| القاعدة | Supabase عبر REST بالمفتاح السري | ADR-0002، `docs/plan-progress.md` «Decisions» |
| المهام الدورية | داخل الـ Cron الساعي وCron الخمس دقائق القائمين | الباقة المجانية خمسة Cron للحساب (`src/lib/cron.ts:59`) |
| الطوابير (webhooks، الصندوق) | جدول + Cron الخمس دقائق الآن؛ Cloudflare Queues إن فعّلت لين Workers Paid (Q6) | Queues وContainers تحتاج Workers Paid (ADR-0006) |
| العمل الثقيل (تقارير كبيرة) | GitHub Actions، والناتج في R2 الخاص | ADR-0003، نفس نمط `refresh.yml` |
| الأسرار | أسرار الـ Worker لمفاتيح الكتابة، وVault لتوكنات الربط وأسرار الـ webhooks | ADR-0004، `execution.md` «الحدود التقنية» |
| محرك النشر | محركنا لميتا؛ Postiz أو Zernio للباقي حسب ADR-0009 | القسم 3.3 |
| **طبقة التنفيذ** | **Well MCP واحد (3.0)**، داخل ريبو `well-ads` بس (MCP لكل ريبو، لا خادم مشترك مع هوفن أو Apipeline)، في نفس الـ Worker: `/mcp` بـ Streamable HTTP، OAuth 2.1 + PKCE للعملاء من برّا، نداء داخلي لنفس الأدوات من الواجهة والـ Cron | قرار لين 2026-11-20؛ جلسات MCP بلا حالة، وDurable Objects فقط لو احتجنا اشتراكات طويلة |
| Adapters | واحد لكل شبكة تحت `src/mcp/adapters/`؛ TikTok عبر TikTok MCP الرسمي كـ upstream؛ Zernio Adapter اختياري | يمنع تكرار منطق المنصات في الموديولات |
| التقويم | بدون مكتبة (حُسم في M6، #361) | صفر اعتماديات جديدة |

**ADRs جديدة مطلوبة:** 0009 Well MCP طبقة التنفيذ الوحيدة، 0010 الكتابة الإعلانية ووضع «تلقائي»، 0011 صندوق الوارد والبيانات الشخصية، 0012 محرك النشر (Postiz / Zernio كـ Adapter).

---

## 6. الأمان والخصوصية (PDPL) والاعتماد والسجل

### 6.1 الاعتماد
| الفعل | الافتراضي | من يعتمد | قابل للأتمتة؟ |
|---|---|---|---|
| نشر منشور | اعتماد | المعتمِد المسمّى (`social_approvers`) أو المالكة | لا |
| رد/رسالة/حذف في الصندوق | اعتماد | صلاحية «موافقة» على الصندوق | الرد التلقائي فقط، بقالب معتمد وبقرار لين |
| إخفاء تعليق | فوري ويُسجَّل | صلاحية تعديل | — |
| ميزانية/إيقاف/تشغيل | اعتماد + تأكيد ثانٍ («بموافقتي») | صلاحية «موافقة»، شركة وِل | **نعم:** وضع «تلقائي» لكل إيجنت تفعّله لين، داخل حواجز 3.6 |
| إنشاء/تعديل حملة/مجموعة/إعلان | اعتماد، ويُنشأ متوقفاً | نفس السابق | **نعم:** «تلقائي» بنفس الحواجز؛ الإطلاق المباشر بإعداد `create_active` |
| رفع زر الطوارئ، تفعيل التنفيذ الحقيقي، تغيير السقوف، تفعيل «تلقائي» لإيجنت | — | **المالكة فقط** | لا |
| زر الطوارئ (تشغيله) | فوري | أي أحد عنده موافقة | يوقف كل تنفيذ ويقلب كل الإيجنتس إلى «بموافقتي» |

**كل فعل في الجدول يمر عبر Well MCP (3.0):** نفس الصلاحية ونفس السجل سواء جا من الواجهة أو إيجنت أو Cron أو عميل من برّا.

### 6.2 السجل (`audit_log`)
- كل اقتراح واعتماد ورفض وتنفيذ وفشل وتراجع، مع `company_id` (يُضاف إن لم يكن، ADR-0006 يذكر أن `audit_log` أخذ العمود).
- يُحفظ: من، متى، الفعل، المعرّفات، القيم قبل/بعد، رمز خطأ قصير، `actor` (إنسان/إيجنت/API)، ومعرّف المفتاح إن وُجد.
- **لا يُحفظ:** أسرار، نصوص رسائل المنصات، نصوص رسائل العملاء، أسماء أو إيميلات أو أرقام جوال العملاء.
- صفحة السجل تعرض فلاتر حسب النوع والفاعل، وتصدير CSV للمالكة.

### 6.3 نظام حماية البيانات الشخصية (PDPL)
البيانات الجديدة ذات الطبيعة الشخصية: أسماء المعلّقين والمراسلين ومعرّفاتهم ونصوص رسائلهم (الصندوق)، والجماهير. سياق وِل صحي، فقد تتضمن الرسائل بيانات صحية (بيانات حساسة).
- **تقليل البيانات:** نحفظ ما يلزم للرد فقط؛ لا نسحب الملفات الشخصية الكاملة.
- **الغرض:** خدمة العميل والرد عليه. لا استخدام لنصوص الرسائل في تدريب أو إعلانات.
- **الاحتفاظ:** نصوص الرسائل 180 يوماً من آخر نشاط ثم تُحذف ويبقى العدّ (افتراض، Q7).
- **حق الحذف:** زر «امسح بيانات هذا الشخص» يحذف النصوص ويضع `erased_at`، ويُسجَّل.
- **الوصول:** الصندوق مقفل افتراضياً، ويُفتح بالأدوار؛ الإيميلات وأرقام الجوال داخل النص تُخفى في القوائم وتظهر عند فتح المحادثة فقط.
- **النقل خارج المملكة:** Supabase وCloudflare ومحركات النشر قد تحفظ البيانات خارج المملكة؛ يحتاج تحققاً من منطقة مشروع Supabase وأساساً نظامياً للنقل (Q7).
- **النماذج اللغوية:** لا يُرسل نص رسالة عميل لنموذج خارجي إلا بقرار لين (Q8)؛ البديل Workers AI على Cloudflare.
- **رفع قوائم العملاء للجماهير:** خارج هذا الإصدار.
- **الحوادث:** إجراء موثّق في `docs/runbook.md` للإبلاغ والتعامل.

### 6.4 الأمان
- كل جدول جديد: `company_id`، RLS، `revoke` من `anon/authenticated`، و`scoped()`. اختبار «شركة أخرى» لكل مسار جديد (نمط `tests/unit/route-table.test.ts`).
- webhooks الواردة موقّعة ومحدودة بالزمن؛ الصادرة HTTPS عامة فقط.
- حد معدّل على كل مسار يكتب أو يرسل، ومنها `/api/auth/*` (R-25، قاعدة في Cloudflare).
- عدّاد ذري لحدود الإيجنتس المدفوعة (R-23).
- مفاتيح الكتابة الإعلانية مفصولة عن مفاتيح السحب (القائم).
- Well MCP: OAuth 2.1 + PKCE للعملاء من برّا، نطاقان (`read`، `read-write`)، كل توكن مربوط بشركة وحدة، وحد معدّل لكل عميل؛ لا توكن منصة يطلع من الخادم أبداً.
- لا عنوان منصة خارج `src/mcp/adapters/` (اختبار)، فما فيه طريق للكتابة على حساب إلا عبر السياسة والحواجز.

---

## 7. المراحل

كل مرحلة PR واحد صغير قدر الإمكان، يُدمج بكلمة «ادمج» فقط، ويُنشر بكلمة «انشر» / «انشر الإنتاج» فقط. المرحلة لا تبدأ قبل دمج ما تعتمد عليه.

**المنجز (حتى 2026-11-20):**
| # | المرحلة | الحالة |
|---|---|---|
| M0 | هذا المستند | ✅ مدموج (#342) |
| M1 | التوكنات، القوائم الداكنة، مكوّنات shadcn | ✅ مدموج (#343) |
| M2 | حارس الميجريشن + أهداف اللمس 44px | PR #344 |
| M3 | مركز الاعتماد (بدون SQL) | PR #345 |
| M4 | ⌘K + الاختصارات + العدّاد الحي | PR #346 |
| M5 | صحة الحسابات + المجموعات (SQL 038) | PR #360 |
| M6 | نص لكل منصة + الطابور + التقويم (SQL 039) | PR #361 |
| M8 | حلقة التعلّم تشتغل كل ساعة (بدون SQL) | PR #362 |

**الجاي (معاد ترتيبه بعد قرار MCP الواحد):**
| # | المرحلة | يعتمد على | ما تحتاجه لين |
|---|---|---|---|
| **M9** | **Well MCP النواة:** سجل الأدوات وشكل الطلب، `ctx` والنطاقات، السياسة (`approve`/`auto`)، Idempotency 24 ساعة، السجل، النداء الداخلي، `/mcp` (Streamable HTTP) بأدوات قراءة، OAuth 2.1 + PKCE، ADR-0009 | M3 | SQL (جدول `mcp_idempotency`) |
| **M10** | **نقل الموجود تحت MCP:** محوّلات ميتا وسناب، محركات النشر (Graph، Postiz)، فحوص الحسابات؛ واختبار «لا عنوان منصة خارج adapters» | M9، M5، M6 | لا شيء (بدون تغيير سلوك) |
| **M11** | Token Vault لكل شركة + مجدّد التوكنات + أحداث/webhooks صادرة + مهام غير متزامنة | M10 | SQL؛ قناة التنبيه |
| **M12a** | **إعادة ربط الحسابات بصلاحيات الكتابة:** صفحة الربط تطلب صلاحيات الكتابة في جدول 3.0 لكل منصة، وتبيّن الناقص لكل حساب («قراءة بس» / «كتابة»)، وفحص يتأكد إن التوكن فعلاً يقدر يكتب (طلب dry-run من المنصة لما تدعمه) | M11 | لين تعيد ربط كل حساب بنفسها وتوافق على الصلاحيات؛ مراجعة تطبيق ميتا ولينكدإن ومستوى وصول قوقل |
| **M12** | أدوات الكتابة الإعلانية (إنشاء/تعديل/إيقاف/ميزانية/تعزيز) بوضع «بموافقتي»، `managed_campaigns` | M12a، M8 | SQL؛ حملة تجربة؛ تعليم الحسابات/الحملات |
| **M13** | **وضع «تلقائي»** لكل إيجنت: الحدود، صفحة «الأتمتة»، التحول التلقائي لـ«بموافقتي» بعد النتائج السيئة، زر الطوارئ يقلب الكل | M12 | قرار السقوف (Q14)؛ تفعيل «تلقائي» بنفسها |
| **M14** | Adapter تيك توك عبر TikTok MCP (قراءة؛ العضوي إن توفّر) | M10 | لا شيء |
| **M15** | الصندوق 1 كأدوات MCP: تعليقات فيسبوك وانستقرام | M11 | SQL؛ `META_APP_ID/SECRET`؛ مراجعة ميتا؛ أجوبة Q7 وQ8 |
| **M16** | الصندوق 2: الرسائل الخاصة والرد التلقائي بالكلمات | M15 | صلاحيات الرسائل ومراجعة ميتا |
| **M17** | تقارير غير متزامنة + تنبيهات أداء (مهام MCP) | M11 | قناة التنبيه |
| **M18** | تقييم Zernio كـ Adapter اختياري (ADR-0012) | M10 | حساب Zernio تجريبي تدخله بنفسها |
| **M19** | جماهير، رفع مواد، أحداث تحويل | M12 | قرار Q7 (قوائم العملاء) |
| **M20** | نقل السحب الساعي إلى أدوات `insights.*` + إزالة خطوة `execute` القديمة + آخر قواعد `app.css` | M11 | قرار Q13 وR-16 |

**مفاتيح عامة تدخلها لين بنفسها (لا أطبعها ولا أكتبها):** `META_APP_ID`، `META_APP_SECRET`، `GOOGLE_ADS_CLIENT_ID`، `GOOGLE_ADS_CLIENT_SECRET`، `YOUTUBE_API_KEY`، ومفتاح Zernio إن اعتُمد.

**SQL معلّق على قاعدة Well:** `038_account_health.sql` و`039_social_v2.sql`. موصّل Supabase في هالجلسة يشوف مشاريع هوفن بس (`hoven-ads`، `hoven-dashboard`)، فما انطبقوا: يحتاج ربط مشروع وِل بالموصّل أو تشغيلهم يدوي.

---

## 8. المقاييس والمخاطر والأسئلة

### 8.1 مقاييس النجاح
| المقياس | الأساس | الهدف |
|---|---|---|
| وسيط زمن الاعتماد (من الاقتراح إلى القرار) | يُقاس بعد M3 من `audit_log` | نصف الأساس خلال 30 يوماً من M4 |
| نسبة القرارات المقاسة بعد 3 و7 أيام | جزئية (عند فتح التبويب فقط) | 100% من المنفّذة |
| كتابات على الحسابات بلا اعتماد | 0 (ADR-0008) | 0 دائماً، بتدقيق أسبوعي آلي على `audit_log` |
| نشر مزدوج | 0 | 0 |
| منشورات فشلت ونجحت بإعادة واحدة | يُقاس بعد M6 | ≥ 95% نجاح من أول مرة |
| زمن أول رد على تعليق | لا يُقاس اليوم | يُقاس بعد M12، والهدف تحدده لين |
| أسطر `app.css` | 478 | 0 في M17 |
| تكلفة الليد في الحملات المعلَّمة | الأساس قبل M11 | لا ارتفاع بعد M11 (حارس، لا هدف تحسين ملزم) |

### 8.2 المخاطر
| الخطر | الأثر | التخفيف |
|---|---|---|
| خطأ في الكتابة الإعلانية يصرف مالاً | عالٍ | الإنشاء متوقف، السقوف، `managed_campaigns`، idempotency، زر الطوارئ، أول تنفيذ بإشراف لين |
| مراجعة تطبيق ميتا تتأخر أو تُرفض | يؤخر M12-M13 | البدء بطلب المراجعة مبكراً؛ المرحلة 1 بصلاحيات أقل |
| بيانات صحية في الرسائل (PDPL) | قانوني | القسم 6.3، وقرارات Q7 وQ8 قبل M12 |
| Zernio وسيط ثالث يرى المحتوى والتوكنات | خصوصية واعتماد على مورد | ADR-0009 يتحقق من مكان البيانات وملكية التطبيقات، والتحويل لكل منصة قابل للرجوع |
| حدود الباقة المجانية (Cron، CPU، الطلبات) | توقف مهام | تجميع المهام في الـ Cron الساعي؛ Q6 |
| واجهتان أثناء النقل | تفاوت الشكل | طبقة التوافق في M1 |
| سناب غير متحقق في الكتابة | فشل أو كتابة خاطئة | لا توسيع لسناب قبل إغلاق بند التحقق |
| تناقض أرقام الربط بالإعلان | قرار ميزانية خاطئ | البند في 3.10 قبل M11 |

### 8.3 أسئلة للين (مع الاقتراح الافتراضي)
1. **Q1 (الكتابة الإعلانية) — محسوم: موافقة (2026-11-19).** قاعدتك «حسابات الإعلانات قراءة فقط» (عُدّلت في ADR-0008 للميزانية والإيقاف). نقترح: كل إنشاء/تعديل بموافقتك، وينشأ متوقفاً، ولا رفع ميزانية أكثر من 20% يومياً، وفقط على حملات تعلّمها أنت، مع idempotency وسجل كامل؛ والأتمتة الكاملة لكل إيجنت فقط عندما تفعّلينها. **موافقة؟**
2. **Q2:** المنصات المسموح لها بالكتابة الإعلانية في M11: ميتا فقط؟ (المقترح: نعم، سناب بعد التحقق، جوجل لاحقاً.)
3. **Q3:** هل نقيّم Zernio بديلاً لـ Postiz (M7)؟ (المقترح: نعم، تقييم فقط قبل أي قرار.)
4. **Q4:** نشر تيك توك العضوي: يبقى عبر Postiz/Zernio، أم يُوقف إلى أن يتوفر عبر MCP؟ (المقترح: يبقى عبر محرك النشر لأن قاعدة MCP تخص بيانات الإعلانات.)
5. **Q5:** التقويم: FullCalendar أم عرض مبني بـ shadcn؟ (المقترح: يُحسم بالقياس في M6.)
6. **Q6:** الترقية إلى Workers Paid (5$ شهرياً + استهلاك) لاستخدام Queues؟ (المقترح: ليس الآن.)
7. **Q7 (PDPL):** مدة حفظ نصوص الرسائل (المقترح 180 يوماً)، ومنطقة مشروع Supabase، وهل نؤجل رفع قوائم العملاء للجماهير (المقترح: نعم).
8. **Q8:** هل يُسمح بإرسال نص رسالة العميل لنموذج ذكاء اصطناعي لاقتراح الرد؟ (المقترح: Workers AI فقط، أو لا شيء.)
9. **Q9:** هل نضيف لاحقاً المراجعات (Google Business Profile) والبريد والبث الجماعي؟ (المقترح: بعد M13، كلٌّ بقرار.)
10. **Q10:** حذف فرع `tiktok-data` العام وتاريخه (R-16، R-17)؟
11. **Q11:** قرارات R-19 (نوافذ الاقتراحات) وR-20 (تواريخ النتائج) وR-21 (الدفعة الثانية)؟ المقترحات في `docs/review-2026-11.md` «Decisions for the owner».
12. **Q12:** إزالة خطوة `execute` القديمة من `refresh.yml` بعد M11؟ (المقترح: نعم.)
13. **Q13:** السحب الساعي بالبايثون (`pipeline/`) ينتقل لأدوات `insights.*` في Well MCP (M20)، أو يبقى في GitHub Actions؟ (المقترح: ينتقل تدريجياً، منصة منصة، بعد M11.)
14. **Q14 (وضع «تلقائي»):** السقوف الافتراضية لما تفعّلينه: تغيير ميزانية 20% يومياً للكيان، سقف صرف يومي لكل حملة وإجمالي للإيجنت (المبلغ تحددينه)، الإنشاء متوقف إلا لو قلبتي `create_active`. موافقة؟
