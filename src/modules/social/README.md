# السوشال (`social`)

الحالة: **جاهز**

- منشور واحد لكذا منصة
- جدولة بوقت النشر
- ما ينشر إلا باعتماد المدير اللي يحدده المالك (`companies.social_approvers`، migration 013). بدون اختيار: المالك بس. ما فيه وضع تلقائي.

**الملفات:** module.ts، routes.ts، social.ts (التحقق والنشر)، cron.ts (النشر كل 5 دقايق)، Page.astro، `public/modules/social/client.js`، social.test.ts
