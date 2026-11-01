// Voice (الصوت): Well's brand voice as rules, a copy checker, read-aloud timing for voice-over scripts,
// and an optional rewrite with Workers AI. Listening runs in the browser (speech synthesis, free).
import { check } from '../compliance/compliance';

export const GUIDE: { title: string; do: string; dont: string }[] = [
  { title: 'سعودي واضح', do: 'لهجة سعودية بيضاء يفهمها الكل: "يجيك البيت"، "احجز الحين".', dont: 'فصحى رسمية ثقيلة: "نقدم لكم خدماتنا المتميزة".' },
  { title: 'قريب ومهني', do: 'كلام ودود فيه ثقة الطبيب: "فريقنا الطبي المرخّص".', dont: 'مبالغة أو تهويل: "عرض لا يفوت!!!".' },
  { title: 'جمل قصيرة', do: 'جملة وحدة لكل فكرة، أقل من 14 كلمة.', dont: 'جمل طويلة فيها أكثر من فكرة.' },
  { title: 'فائدة قبل الميزة', do: 'ابدأ بوش يستفيد العميل: "ترتاح في بيتك".', dont: 'ابدأ بالمواصفات التقنية.' },
  { title: 'دعوة واضحة', do: 'كل نص ينتهي بخطوة: "احجز"، "تواصل معنا".', dont: 'نص بدون ما يقول للعميل وش يسوي.' },
  { title: 'آمن طبياً', do: 'نتائج تختلف من شخص لآخر، وبعد تقييم طبي.', dont: 'ضمان، شفاء، "الأفضل"، أرقام وعود.' },
];

// Whole words only (Arabic has no \b): "بس" must not match inside "بسيطة"
const words = (list: string[]) => new RegExp(`(?<!\\p{L})(?:${list.join('|')})(?!\\p{L})`, 'gu');
const SAUDI = words(['وش', 'ايش', 'الحين', 'يجيك', 'يجيكم', 'تبي', 'تبغى', 'نبي', 'ودك', 'عشان', 'زي', 'كذا', 'ابشر', 'أبشر', 'هلا', 'خلك', 'خل', 'لين', 'اللي', 'زين', 'حياك', 'حياكم', 'بس']);
const MSA = words(['نقدم لكم', 'يسعدنا', 'نود', 'لدينا', 'حيث', 'كما أن', 'بالإضافة إلى', 'الذي', 'التي', 'سوف', 'لكي', 'لذلك', 'متميزة', 'المتميزة', 'عملاؤنا الكرام']);
const CTA = /(?<!\p{L})(احجز|تواصل|كلمنا|راسلنا|اتصل|سجل|سجّل|اطلب|اعرف أكثر|ابدأ|book|call|contact)/iu;
const EMOJI = /\p{Extended_Pictographic}/gu;

export interface Check { ok: boolean; title: string; detail: string }
export function analyze(text: string) {
  const t = String(text || '').trim().slice(0, 4000);
  const words = t.split(/\s+/).filter(Boolean);
  const sentences = t.split(/[.!؟?\n،]+/).map(s => s.trim()).filter(Boolean);
  const long = sentences.filter(s => s.split(/\s+/).length > 14);
  const saudi = (t.match(SAUDI) || []).length, msa = (t.match(MSA) || []).length;
  const dialect = saudi && !msa ? 'saudi' : msa && !saudi ? 'msa' : saudi || msa ? 'mixed' : 'neutral';
  const emojis = (t.match(EMOJI) || []).length;
  const latin = (t.match(/[A-Za-z]{3,}/g) || []).length;
  const compliance = check(t);
  const checks: Check[] = [
    { ok: dialect === 'saudi' || dialect === 'neutral', title: 'اللهجة', detail: dialect === 'msa' ? 'النص فصحى رسمية، خله سعودي واضح.' : dialect === 'mixed' ? 'فيه خلط بين الفصحى والسعودي، خله على وحدة.' : 'سعودي واضح.' },
    { ok: !long.length, title: 'طول الجمل', detail: long.length ? `${long.length} جملة أطول من 14 كلمة. قسّمها.` : 'الجمل قصيرة.' },
    { ok: CTA.test(t), title: 'الدعوة للخطوة', detail: CTA.test(t) ? 'فيه دعوة واضحة.' : 'أضف خطوة: "احجز" أو "تواصل معنا".' },
    { ok: emojis <= 3, title: 'الإيموجي', detail: emojis > 3 ? `${emojis} إيموجي، خلها 3 أو أقل.` : 'مناسب.' },
    { ok: latin <= 2, title: 'كلمات إنجليزية', detail: latin > 2 ? `${latin} كلمات إنجليزية، اكتبها بالعربي لو تقدر.` : 'مناسب.' },
    { ok: !compliance.some(h => h.level !== 'info'), title: 'الامتثال', detail: compliance.length ? compliance.map(h => `${h.title} «${h.match}»`).join('، ') : 'ما فيه ملاحظات.' },
  ];
  const score = Math.round((100 * checks.filter(c => c.ok).length) / checks.length);
  // Saudi voice-over runs at about 2.3 words a second
  const seconds = Math.round(words.length / 2.3);
  return { words: words.length, sentences: sentences.length, dialect, score, checks, seconds, compliance };
}

export function rewritePrompt(text: string, seconds: number): string {
  const max = Math.max(8, Math.round(seconds * 2.3));
  return `أعد كتابة هذا النص بصوت علامة Well (رعاية صحية منزلية في السعودية):
- لهجة سعودية بيضاء واضحة، ودودة ومهنية، مخاطبة المذكر.
- جمل قصيرة، الفائدة قبل الميزة، وينتهي بدعوة واضحة ("احجز" أو "تواصل معنا").
- بدون ضمان نتائج، بدون "علاج نهائي"، بدون "الأفضل"، بدون أرقام وعود.
- الحد الأقصى ${max} كلمة (فويس أوفر ${seconds} ثانية).
رد بالنص الجديد بس، بدون شرح.

النص:
${text}`;
}
