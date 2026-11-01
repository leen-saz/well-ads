import type { ModuleMeta } from '../types';

export const meta: ModuleMeta = {
  key: 'debugger', ar: "التتبع", en: "Tracking", group: 'agents', status: 'live',
  icon: "<path d=\"m8 2 1.9 1.9M16 2l-1.9 1.9\"/><path d=\"M9 7.1V7a3 3 0 1 1 6 0v.1\"/><path d=\"M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6Z\"/><path d=\"M12 20v-9M6.5 13H3M21 13h-3.5\"/>",
  does: ["يفحص التتبع من بياناتنا: منصة وقفت أرقامها، أو إعلان ليدز يصرف بدون ولا ليد", "يقارن ليدز كل منصة بليدز الـ CRM ويطلع الفرق", "ليدز بدون رقم إعلان، وروابط بدون UTM، ومنصات بدون CAPI", "كل مشكلة معها الحل، وكله قراءة بس"],
  doesEn: ["Checks tracking from our own data: a platform whose numbers stopped, or lead ads spending with no lead", "Compares each platform's leads with CRM leads", "Leads with no ad id, links without UTM, platforms without CAPI", "Each issue comes with its fix; read-only"],
};
