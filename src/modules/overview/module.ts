import type { ModuleMeta } from '../types';

export const meta: ModuleMeta = {
  key: 'overview', ar: "ملخص الأداء", en: "Performance summary", group: 'measure', status: 'live',
  icon: "<path d=\"M3 3v16a2 2 0 0 0 2 2h16\"/><path d=\"m19 9-5 5-4-4-3 3\"/>",
  does: ["أهم الأرقام للفترة مقارنة باللي قبلها", "رسم يومي للصرف والنتائج", "جدول الإعلانات: ترتيب وبحث وفلترة حسب المنصة", "اضغط على إعلان وتطلع لك أرقامه اليومية"],
  doesEn: ["Key numbers vs the previous period", "Daily spend and results chart", "Ads table: sort, search, filter by platform", "Click an ad to see its daily numbers"],
  pages: [{ path: 'creative', ar: "المواد الإعلانية", en: "Creatives",
    icon: "<rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><circle cx=\"9\" cy=\"9\" r=\"2\"/><path d=\"m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21\"/>" }],
};
