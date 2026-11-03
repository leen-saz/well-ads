// Voice (الصوت): Well's brand voice as rules, a copy checker, read-aloud timing for voice-over scripts,
// and an optional rewrite with Workers AI. Listening runs in the browser (speech synthesis, free).
import { check, type Rule } from '../compliance/compliance';

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
export function analyze(text: string, extra: Rule[] = []) {
  const t = String(text || '').trim().slice(0, 4000);
  const words = t.split(/\s+/).filter(Boolean);
  const sentences = t.split(/[.!؟?\n،]+/).map(s => s.trim()).filter(Boolean);
  const long = sentences.filter(s => s.split(/\s+/).length > 14);
  const saudi = (t.match(SAUDI) || []).length, msa = (t.match(MSA) || []).length;
  const dialect = saudi && !msa ? 'saudi' : msa && !saudi ? 'msa' : saudi || msa ? 'mixed' : 'neutral';
  const emojis = (t.match(EMOJI) || []).length;
  const latin = (t.match(/[A-Za-z]{3,}/g) || []).length;
  const compliance = check(t, extra);
  const checks: Check[] = [
    { ok: dialect === 'saudi' || dialect === 'neutral', title: 'اللهجة', detail: dialect === 'msa' ? 'النص فصحى رسمية، خله سعودي واضح.' : dialect === 'mixed' ? 'فيه خلط بين الفصحى والسعودي، خله على وحدة.' : 'سعودي واضح.' },
    { ok: !long.length, title: 'طول الجمل', detail: long.length ? `${long.length} جملة أطول من 14 كلمة. قسّمها.` : 'الجمل قصيرة.' },
    { ok: CTA.test(t), title: 'الدعوة للخطوة', detail: CTA.test(t) ? 'فيه دعوة واضحة.' : 'أضف خطوة: "احجز" أو "تواصل معنا".' },
    { ok: emojis <= 3, title: 'الإيموجي', detail: emojis > 3 ? `${emojis} إيموجي، خلها 3 أو أقل.` : 'مناسب.' },
    { ok: latin <= 2, title: 'كلمات إنجليزية', detail: latin > 2 ? `${latin} كلمات إنجليزية، اكتبها بالعربي لو تقدر.` : 'مناسب.' },
    { ok: !compliance.some(h => h.level !== 'info'), title: 'الامتثال', detail: compliance.length ? compliance.map(h => `${h.title} «${h.match}»: ${h.fix}`).join(' · ') : 'ما فيه ملاحظات.' },
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

// Voice generation: Gemini TTS (Google AI Studio key in GEMINI_API_KEY). The accent and tone go in the prompt;
// the model reads only the script after the colon. Model name can change without a deploy (GEMINI_TTS_MODEL).
export const TTS_MODEL = 'gemini-3.1-flash-tts-preview';
export const TTS_VOICES: { id: string; ar: string }[] = [
  { id: 'Charon', ar: 'شارون · رجالي هادي' }, { id: 'Orus', ar: 'أوروس · رجالي ثابت' }, { id: 'Puck', ar: 'بك · رجالي حيوي' },
  { id: 'Fenrir', ar: 'فنرير · رجالي متحمس' }, { id: 'Kore', ar: 'كوري · نسائي واثق' }, { id: 'Aoede', ar: 'إيدي · نسائي ناعم' },
  { id: 'Zephyr', ar: 'زفير · نسائي مشرق' }, { id: 'Leda', ar: 'ليدا · نسائي شبابي' },
];
export const ACCENTS: Record<string, string> = { najdi: 'نجدية سعودية (لهجة الرياض)', hijazi: 'حجازية سعودية (لهجة جدة)', gulf: 'خليجية', msa: 'عربية فصحى واضحة' };
export const TONES: Record<string, string> = { warm: 'دافئة وودودة', energetic: 'حماسية وسريعة شوي', calm: 'هادية ومطمّنة', formal: 'رسمية وواثقة' };

export function ttsInput(b: { text?: unknown; voice?: unknown; accent?: unknown; tone?: unknown }) {
  const text = String(b.text || '').trim().slice(0, 1500);
  const voice = TTS_VOICES.some(v => v.id === b.voice) ? String(b.voice) : 'Charon';
  const accent = String(b.accent || '') in ACCENTS ? String(b.accent) : 'najdi';
  const tone = String(b.tone || '') in TONES ? String(b.tone) : 'warm';
  return { text, voice, accent, tone };
}

export function ttsPrompt(i: { text: string; accent: string; tone: string }): string {
  return `اقرأ النص التالي بلهجة ${ACCENTS[i.accent]}، بنبرة ${TONES[i.tone]}، كأنك معلّق إعلان صوتي لشركة رعاية صحية منزلية:\n${i.text}`;
}

export function ttsBody(i: { text: string; voice: string; accent: string; tone: string }) {
  return {
    contents: [{ parts: [{ text: ttsPrompt(i) }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: i.voice } } } },
  };
}
