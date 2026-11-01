// تابات نظام الإيجنتس اللي لسا ما جهزت: تطلع في القائمة الجانبية بتاق "قريباً"، وكل وحدة تفتح صفحة /soon/ تشرح وش بتسوي.
// القائمتين (common.js للوحة القرارات والربط، وnav.js للتحليلات والكرييتف) تقرا من هنا عشان ما تختلف.
// الأيقونات مسارات Lucide (خط 1.75).
export const SOON = [
  { key: 'debugger', ar: 'التتبع', en: 'Tracking',
    icon: '<path d="m8 2 1.9 1.9M16 2l-1.9 1.9"/><path d="M9 7.1V7a3 3 0 1 1 6 0v.1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6Z"/><path d="M12 20v-9M6.5 13H3M21 13h-3.5"/>',
    does: ['يربط الموقع ببكسلات ميتا وسناب وتيك توك عن طريق Google Tag Manager', 'CAPI من السيرفر بدون تكرار الأحداث', 'Debugger يعرض كل حدث يطلع من الموقع لحظة بلحظة', 'تكلفة الليد المؤهل الحقيقية بدل CPA الظاهر'],
    doesEn: ['Connects the site to Meta, Snap and TikTok pixels through Google Tag Manager', 'Server-side CAPI without duplicate events', 'Debugger showing every site event live', 'True cost per qualified lead instead of platform CPA'] },
  { key: 'compliance', ar: 'الامتثال', en: 'Compliance',
    icon: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
    does: ['يفحص الإعلانات والمحتوى على قواعد وزارة الصحة وسياسات المنصات', 'يطلع تنويه بس، ما يمنع النشر'],
    doesEn: ['Checks ads and content against MOH rules and platform policies', 'Shows a notice only, never blocks publishing'] },
  { key: 'listening', ar: 'الرصد', en: 'Social listening',
    icon: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    does: ['يرصد وش ينقال عن Well والمنافسين', 'يفهم العميل السعودي: اللهجة والنية والموضوع', 'يغذي حلقة تعلّم في قاعدة بيانات مستقلة', 'يشتغل على GitHub Actions بنموذج مجاني'],
    doesEn: ['Tracks what people say about Well and competitors', 'Understands Saudi customers: dialect, intent, topic', 'Feeds a learning loop in its own database', 'Runs on GitHub Actions with a free model'] },
  { key: 'design', ar: 'التصميم', en: 'Design',
    icon: '<circle cx="13.5" cy="6.5" r="1"/><circle cx="17.5" cy="10.5" r="1"/><circle cx="8.5" cy="7.5" r="1"/><circle cx="6.5" cy="12.5" r="1"/><path d="M12 2a10 10 0 0 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.3A5.6 5.6 0 0 0 22 9.8C22 5.5 17.5 2 12 2Z"/>',
    does: ['رفع ملفات الهوية والأصول', 'فورم: نوع التصميم والمقاسات والفئة المستهدفة وصورة المنتج', 'النصوص طبقة فوق الصورة دايم'],
    doesEn: ['Upload brand identity files and assets', 'Form: design type, sizes, audience and product photo', 'All text is always an overlay layer'] },
  { key: 'voice', ar: 'الصوت', en: 'Voice',
    icon: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><path d="M12 18v4"/>',
    does: ['فويس أوفر بالسعودي مجاني', 'مكتبة أصوات جاهزة', 'تنزيل ملف الصوت'],
    doesEn: ['Free Saudi-Arabic voice-over', 'A library of ready voices', 'Download the audio file'] },
];
