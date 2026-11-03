# التصميم (`design`)

الحالة: **شغال**

- بريف من أفضل إعلانات الليدز آخر 30 يوم (أقل تكلفة ليد، 3 ليدز أو أكثر): الصيغة، طول النص، والافتتاحيات.
- نصوص مقترحة (عنوان، سطر ثاني، زر) من Workers AI المجاني لو مربوط، وإلا قوالب ثابتة. كل خيار يمر على قواعد الامتثال (`../compliance/compliance.ts`).
- معاينة على canvas لكل مقاس، والنص طبقة فوق الصورة بخط ثمانية. الصورة تنقرأ في المتصفح وما تنرفع، والتحميل PNG.

**نوع التصميم:** «صورة» (فوق) أو «موشن جرافيك» (`/design/?type=motion`، والرابط القديم `/maestro/video/` يحوّل له):
- التصميم والصوت المعتمدين ← ChatGPT يكتب خطة المشاهد بمعرفة الشركة وألوان هويتها ← معاينة على canvas بوقت الصوت، «تعديل» بنسخ جديدة، سجل النسخ، واعتماد النسخة النهائية (مستوى approve على التصميم). ليش موشن بالكود: `docs/motion-video.md`.
- الملفات: motion.ts، motion.test.ts، `public/modules/design/motion.js` و`frame.js`. الجداول `motion_projects` و`motion_versions` (migration 018)، والملفات في R2 تحت `motion/<company>/`.

API: `GET /api/design/options`، `POST /api/design/brief`، و`/api/design/videos|videofile|video|videoedit|videoapprove` للموشن. يعتمد على موديول الامتثال (ادمجه قبله).
