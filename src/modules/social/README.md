# السوشال (`social`)

الحالة: **جاهز**

- منشور واحد لكذا منصة
- جدولة بوقت النشر
- ما ينشر إلا باعتماد المدير اللي يحدده المالك (`companies.social_approvers`، migration 013). بدون اختيار: المالك بس. ما فيه وضع تلقائي.

**الملفات:** module.ts، routes.ts، social.ts (التحقق والنشر)، cron.ts (النشر كل 5 دقايق)، Page.astro، `public/modules/social/client.js`، social.test.ts

**النشر (ما يُنشر مرتين):** كل منصة تحفظ نتيجتها في `social_posts.results` وهي تشتغل (sending / processing / publishing)، وعليها يقوم الاسترجاع وإعادة المحاولة.
- فيديو انستقرام: ينتظر الـ container لين `FINISHED` (يكمل في دورة الـ cron الجاية، وحد أقصى 20 دقيقة) قبل `media_publish`.
- فيسبوك: فيديو عبر `/videos`، وعدة صور عبر `attached_media`. انستقرام: عدة صور = carousel. المنشور إما فيديو واحد أو صور.
- منشور عالق في `publishing` أكثر من 15 دقيقة: يُعاد حجزه ويكمل من النتائج المحفوظة. اللي نُشر ما يتكرر، واللي ما بدأ يبدأ، واللي ما وصلنا رده يصير «unconfirmed» ويقرر المعتمد.
- إعادة المحاولة: مرة وحدة، للمنصات الفاشلة بس، للمعتمد بس (`retried_at`، migration 023).
- اختيار الصفحة: ربط ميتا بعدة صفحات ما يربط أي وحدة؛ المالك يختار من تاب السوشال (`/api/social/pages`).
- فحص الجاهزية بدون نشر: `/api/social/connection` (المالك).
- الاختبارات: `publish.test.ts` على Graph API وهمي بحالة (`graph-mock.ts`)، و`routes.test.ts`.
