import type { ModuleMeta } from '../types';

export const meta: ModuleMeta = {
  key: 'vision', ar: "وصف الصور", en: "Image description", group: 'create', status: 'live',
  icon: "<rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\"/><circle cx=\"9\" cy=\"9\" r=\"2\"/><path d=\"m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21\"/><path d=\"M14 3v4\"/>",
  does: ["ارفع صورة إعلان (حقنا أو حق منافس) ويطلع وصفها بالعربي ونص بديل جاهز", "النص اللي داخل الصورة بحروفه، والعرض والهوك والدعوة", "ملاحظات الامتثال بنفس قواعد باقي النظام، وتنبيه لو فيه أشخاص", "الصورة ما تنحفظ، ويبقى الناتج وتحفظه في المكتبة"],
  doesEn: ["Upload an ad image (ours or a competitor's) and get an Arabic description and ready alt text", "The text inside the image as written, plus the offer, the hook and the call to action", "Compliance notes on the same rules as the rest of the system, and a warning when people appear", "The image itself is not kept; the result is, and you can save it to the library"],
};
