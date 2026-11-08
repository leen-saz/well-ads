import type { ModuleMeta } from '../types';

export const meta: ModuleMeta = {
  key: 'transcribe', ar: "التفريغ", en: "Transcribe", group: 'create', status: 'live',
  icon: "<path d=\"M4 6h16\"/><path d=\"M4 12h10\"/><path d=\"M4 18h14\"/><circle cx=\"19\" cy=\"12\" r=\"1\"/>",
  does: ["ارفع صوت أو فيديو (اجتماع، إعلان منافس، مقطع تيك توك) ويطلع لك نص باللهجة مع التوقيت", "ملخص وبنود عمل للاجتماعات، والهوك في أول 3 ثواني والعرض للإعلانات", "الملفات الطويلة تنفرّغ على خطوات في الخلفية، والملف ينحذف بعد التفريغ ويبقى النص بس", "النتيجة تنحفظ في المكتبة كمسودة، وتنبيه لو فيه رقم جوال أو هوية"],
  doesEn: ["Upload audio or video (a meeting, a competitor ad, a TikTok clip) and get a dialect transcript with timestamps", "A summary and action items for meetings, the first-3-seconds hook and the offer for ads", "Long files are transcribed in steps in the background; the file is deleted afterwards and only the text stays", "The result is saved to the library as a draft, with a warning if a phone or ID number shows up"],
};
