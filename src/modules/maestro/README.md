# المدير (`maestro`)

الحالة: **جاهز**

- مهام للإيجنتس وحالتها
- موافقات المالكة
- يشتغل على Paperclip
- المحادثة: كل رسالة تصحّي إيجنت الـ CEO في Paperclip (مدفوع على Grok)، فالحد 10 رسائل بالدقيقة لكل مستخدم (من `audit_log`). هذا حارس تكلفة مو حماية: لو تعطّلت قراءة `audit_log` الرسالة تمشي، فلا تعتمد عليه كحد أمان. اللي ينكتب في Paperclip فيه اسم المستخدم بس، بدون إيميله.

**الملفات:** module.ts، routes.ts، paperclip.ts (عميل Paperclip)، Page.astro، `public/modules/maestro/client.js`، maestro.test.ts
