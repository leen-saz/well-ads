import type { ModuleMeta } from '../types';

export const meta: ModuleMeta = {
  key: 'debugger', ar: "التتبع", en: "Tracking", group: 'agents', status: 'soon',
  icon: "<path d=\"m8 2 1.9 1.9M16 2l-1.9 1.9\"/><path d=\"M9 7.1V7a3 3 0 1 1 6 0v.1\"/><path d=\"M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6Z\"/><path d=\"M12 20v-9M6.5 13H3M21 13h-3.5\"/>",
  does: ["يربط الموقع ببكسلات ميتا وسناب وتيك توك عن طريق Google Tag Manager", "CAPI من السيرفر بدون تكرار الأحداث", "Debugger يعرض كل حدث يطلع من الموقع لحظة بلحظة", "تكلفة الليد المؤهل الحقيقية بدل CPA الظاهر"],
  doesEn: ["Connects the site to Meta, Snap and TikTok pixels through Google Tag Manager", "Server-side CAPI without duplicate events", "Debugger showing every site event live", "True cost per qualified lead instead of platform CPA"],
};
