import type { ModuleMeta } from '../types';

export const meta: ModuleMeta = {
  key: 'compliance', ar: "الامتثال", en: "Compliance", group: 'agents', status: 'soon',
  icon: "<path d=\"M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z\"/>",
  does: ["يفحص الإعلانات والمحتوى على قواعد وزارة الصحة وسياسات المنصات", "يطلع تنويه بس، ما يمنع النشر"],
  doesEn: ["Checks ads and content against MOH rules and platform policies", "Shows a notice only, never blocks publishing"],
};
