import type { ModuleMeta } from '../types';

export const meta: ModuleMeta = {
  key: 'compliance', ar: "الامتثال", en: "Compliance", group: 'agents', status: 'live',
  icon: "<path d=\"M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z\"/>",
  does: ["يفحص نصوص الإعلانات على قواعد وزارة الصحة وهيئة الغذاء والدواء وسياسات المنصات", "يوضح الكلمة المخالفة وليش، ويقترح صياغة أسلم", "فاحص لأي نص قبل ما تنشره", "يطلع تنويه بس، ما يمنع النشر"],
  doesEn: ["Checks ad copy against MOH, SFDA and platform health-ad rules", "Shows the risky words, why, and a safer wording", "A checker for any text before you publish it", "A notice only, never blocks publishing"],
};
