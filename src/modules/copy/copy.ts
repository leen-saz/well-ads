// الكوبي رايتر (docs/learning-loops.md، C1): إعداد لكل مشروع، ومنافسين بنصوصهم، وبطاقة نمط لكل منافس،
// ونصوص سعودية تمر على فاحص الصوت والامتثال. البطاقة حسابات ثابتة (بدون LLM)، والـ LLM للكتابة بس.
import { analyze } from '../voice/voice';
import { check, type Rule } from '../compliance/compliance';

// Ad copy per platform, with each placement's fields and lengths (characters; 0 = the platform has no such field).
// max = primary text, head = headline, desc = description. Lengths from the platforms' ad specs (what shows uncut).
export const KINDS: Record<string, { ar: string; max: number; head: number; desc: number; hint: string }> = {
  meta: { ar: 'إعلان ميتا (فيسبوك وانستقرام)', max: 500, head: 40, desc: 30, hint: 'أول 125 حرف من النص الأساسي هي اللي تبان قبل «المزيد»' },
  snap: { ar: 'إعلان سناب شات', max: 0, head: 34, desc: 0, hint: 'عنوان واحد فوق الإعلان، والباقي في التصميم' },
  tiktok: { ar: 'إعلان تيك توك', max: 100, head: 0, desc: 0, hint: 'نص قصير تحت الفيديو' },
  google: { ar: 'إعلان قوقل (بحث)', max: 0, head: 30, desc: 90, hint: 'عنوان ووصف لكل نسخة، وقوقل يركّبها' },
  reel: { ar: 'نص على فيديو (ريلز وستوري)', max: 120, head: 0, desc: 0, hint: 'كلام يظهر على الفيديو، سطرين بالكثير' },
};
export const DEFAULT_KIND = 'meta';

export interface Competitor { id: string; name: string; url: string; platform: string; samples: string[] }
export interface Project {
  name: string; service: string; audience: string; offer: string; cta: string; voice: string;
  banned: string[]; competitors: Competitor[];
}

const s = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const HOSTS: [RegExp, string][] = [[/(^|\.)facebook\.com$|(^|\.)fb\.com$/, 'facebook'], [/(^|\.)instagram\.com$/, 'instagram'], [/(^|\.)tiktok\.com$/, 'tiktok'],
  [/(^|\.)(x|twitter)\.com$/, 'x'], [/(^|\.)snapchat\.com$/, 'snapchat'], [/(^|\.)linkedin\.com$/, 'linkedin']];

export function platformOf(url: string): string {
  try { const h = new URL(url).hostname.replace(/^www\./, ''); return HOSTS.find(([re]) => re.test(h))?.[1] ?? 'web'; } catch { return ''; }
}

// A competitor: a name, a public https link, or both; up to 20 pasted texts of theirs (ads, posts)
export function cleanCompetitor(c: Record<string, unknown>, id: string): Competitor | null {
  const name = s(c.name, 80);
  const raw = s(c.url, 300);
  const url = /^https:\/\/[^\s]+$/i.test(raw) && platformOf(raw) ? raw : '';
  if (!name && !url) return null;
  const samples = (Array.isArray(c.samples) ? c.samples : []).map(x => String(x ?? '').trim().slice(0, 1500)).filter(x => x.length >= 8).slice(0, 20);
  return { id, name: name || url, url, platform: url ? platformOf(url) : '', samples };
}

export function cleanProject(b: Record<string, unknown>, prev?: Project): Project | { error: string } {
  const name = s(b.name ?? prev?.name, 80);
  if (!name) return { error: 'اكتب اسم المشروع' };
  const banned = [...new Set((Array.isArray(b.banned) ? b.banned : prev?.banned ?? []).map(x => s(x, 40)).filter(Boolean))].slice(0, 50);
  const list = Array.isArray(b.competitors) ? b.competitors : prev?.competitors ?? [];
  const competitors = list.slice(0, 10).map((c, i) => cleanCompetitor((c ?? {}) as Record<string, unknown>, s((c as Competitor)?.id, 20) || `c${Date.now().toString(36)}${i}`))
    .filter((c): c is Competitor => !!c);
  const pick = (k: keyof Project, max: number) => s(b[k] ?? prev?.[k], max);
  return { name, service: pick('service', 200), audience: pick('audience', 200), offer: pick('offer', 200), cta: pick('cta', 80), voice: pick('voice', 400), banned, competitors };
}

// ---- Style card: how a competitor writes, counted (no LLM), each finding with real examples
const DIALECT = ['وش', 'ابي', 'ابغى', 'تبي', 'تبغى', 'الحين', 'كذا', 'زين', 'مره', 'مرة', 'حياك', 'يعطيك', 'شلون', 'ليش', 'عشان', 'وايد', 'يالله', 'هلا'];
const CTAS = ['احجز', 'سجل', 'سجّل', 'تواصل', 'كلمنا', 'راسلنا', 'اطلب', 'اتصل', 'اضغط', 'اعرف أكثر', 'لا تفوت', 'استفسر', 'زورونا'];
const EMOJI = /\p{Extended_Pictographic}/gu;
const words = (t: string) => t.split(/\s+/).filter(Boolean);
const opener = (t: string) => words(t.replace(EMOJI, ' ')).slice(0, 3).join(' ');

export interface StyleCard {
  samples: number; avgWords: number; avgSentence: number; questions: number; emojiPer: number; hashtags: number;
  numbers: number; openers: { text: string; n: number }[]; dialect: { word: string; n: number }[]; ctas: { word: string; n: number }[];
  examples: { opener: string[]; cta: string[] };
}

export function styleCard(samples: string[]): StyleCard | null {
  const list = samples.map(x => x.trim()).filter(Boolean);
  if (!list.length) return null;
  const count = (arr: string[]) => [...arr.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const sents = list.flatMap(t => t.split(/[.!؟?\n]+/).map(x => x.trim()).filter(Boolean));
  const allWords = list.flatMap(t => words(t).map(w => w.replace(/[^\p{L}\p{N}]/gu, '')));
  const pct = (n: number) => Math.round((100 * n) / list.length);
  const ctaHits = list.flatMap(t => CTAS.filter(c => t.includes(c)));
  return {
    samples: list.length,
    avgWords: Math.round(list.reduce((a, t) => a + words(t).length, 0) / list.length),
    avgSentence: sents.length ? Math.round(sents.reduce((a, t) => a + words(t).length, 0) / sents.length) : 0,
    questions: pct(list.filter(t => /[؟?]/.test(t)).length),
    emojiPer: Math.round((10 * list.reduce((a, t) => a + (t.match(EMOJI) || []).length, 0)) / list.length) / 10,
    hashtags: pct(list.filter(t => /#\S/.test(t)).length),
    numbers: pct(list.filter(t => /\d|٪|%|ريال|ر\.س/.test(t)).length),
    openers: count(list.map(opener).filter(Boolean)).slice(0, 5).map(([text, n]) => ({ text, n })),
    dialect: count(allWords.filter(w => DIALECT.includes(w))).slice(0, 8).map(([word, n]) => ({ word, n })),
    ctas: count(ctaHits).slice(0, 5).map(([word, n]) => ({ word, n })),
    examples: { opener: list.slice(0, 3).map(t => t.split(/[.!؟?\n]/)[0]!.trim().slice(0, 120)), cta: list.filter(t => CTAS.some(c => t.includes(c))).slice(0, 2).map(t => t.slice(-140)) },
  };
}

// ---- Writing
export function writePrompt(p: Project, kind: string, count: number, cards: { name: string; card: StyleCard }[], hooks: string[]): string {
  const k = KINDS[kind] ?? KINDS[DEFAULT_KIND]!;
  const fields = [
    k.max ? `"hook": أول سطر يوقف التمرير، "body": باقي النص الأساسي (hook + body أقل من ${k.max} حرف)` : '"hook": "" و "body": ""',
    k.head ? `"headline": عنوان أقل من ${k.head} حرف` : '"headline": ""',
    k.desc ? `"description": وصف أقل من ${k.desc} حرف` : '"description": ""',
    '"cta": نص زر الإعلان (كلمتين)',
  ];
  const style = cards.map(({ name, card }) => `- ${name}: متوسط ${card.avgWords} كلمة، والجملة ${card.avgSentence} كلمة، وأسئلة في ${card.questions}% من النصوص، وإيموجي ${card.emojiPer} لكل نص`
    + `${card.openers.length ? `، وافتتاحياتهم: ${card.openers.map(o => `«${o.text}»`).join('، ')}` : ''}${card.dialect.length ? `، وكلماتهم السعودية: ${card.dialect.map(d => d.word).join('، ')}` : ''}`
    + `${card.ctas.length ? `، ودعوتهم: ${card.ctas.map(c => c.word).join('، ')}` : ''}.`).join('\n');
  return [
    `أنت كاتب إعلانات مدفوعة سعودي. اكتب ${count} نسخ مختلفة من «${k.ar}» بلهجة سعودية بيضاء واضحة، قريبة ومهنية، جمل قصيرة. هدف الإعلان: ليد أو حجز.`,
    `ملاحظة المنصة: ${k.hint}. كل نسخة بزاوية مختلفة (المشكلة، الراحة، العرض، سؤال).`,
    `المشروع: ${p.name}. الخدمة: ${p.service || '—'}. الجمهور: ${p.audience || 'عام في السعودية'}. العرض: ${p.offer || '—'}. الدعوة للخطوة: ${p.cta || 'احجز'}.`,
    p.voice ? `صوت العلامة: ${p.voice}` : '',
    style ? `خذ النمط (الطول والإيقاع والافتتاحية ونوع الدعوة) من هالمنافسين، بدون ما تنسخ ولا جملة منهم:\n${style}` : '',
    hooks.length ? `افتتاحيات نجحت عندنا (أرخص ليد): ${hooks.slice(0, 5).map(h => `«${h}»`).join('، ')}` : '',
    `ممنوع: ادعاءات علاجية أو "مضمون" أو "الأفضل" أو "الوحيد"، وأي مبالغة، وشهادات مرضى${p.banned.length ? `، وهالكلمات: ${p.banned.join('، ')}` : ''}.`,
    `الحقول: ${fields.join('، ')}.`,
    `رجّع JSON بس: [{"hook":"…","body":"…","headline":"…","description":"…","cta":"…"}]`,
  ].filter(Boolean).join('\n');
}

export interface Draft { hook: string; body: string; headline?: string; description?: string; cta: string }
export function parseDrafts(raw: string, max: number): Draft[] {
  const m = String(raw || '').match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]) as unknown[];
    return arr.map(x => x as Record<string, unknown>).map(x => ({ hook: s(x.hook, 200), body: String(x.body ?? '').trim().slice(0, max || 600), headline: s(x.headline, 120), description: s(x.description, 200), cta: s(x.cta, 80) }))
      .filter(d => d.hook || d.body || d.headline).slice(0, 5);
  } catch { return []; }
}

// No AI binding (or a bad answer): plain drafts from the setup, so the tab still works
export function fallbackDrafts(p: Project, count: number, kind = DEFAULT_KIND): Draft[] {
  const k = KINDS[kind] ?? KINDS[DEFAULT_KIND]!;
  const cta = p.cta || 'احجز موعدك', what = p.service || p.name;
  const offer = p.offer ? ` ${p.offer}.` : '';
  const out: Draft[] = [
    { hook: `تبي ${what} بدون مشوار؟`, body: `فريقنا يجيك لين بيتك.${offer}`, headline: `${what} في بيتك`, description: 'احجز بخطوات بسيطة', cta },
    { hook: `${what}، بالطريقة اللي تريحك`, body: `فريقنا معك من أول خطوة.${offer}`, headline: `${what} بدون انتظار`, description: 'فريق مرخّص يجيك', cta },
    { hook: `وش تحتاج تعرف عن ${what}؟`, body: `نجاوبك على كل سؤال قبل ما تقرر.${offer}`, headline: `اسألنا عن ${what}`, description: 'نرد عليك اليوم', cta },
  ];
  return out.slice(0, count).map(d => fit(d, k));
}

// Fields the placement does not have are emptied; the rest stay as written (length is checked in review, not cut)
const fit = (d: Draft, k: { max: number; head: number; desc: number }): Draft =>
  ({ ...d, hook: k.max ? d.hook : '', body: k.max ? d.body : '', headline: k.head ? d.headline || '' : '', description: k.desc ? d.description || '' : '' });
export const fitDraft = (d: Draft, kind: string) => fit(d, KINDS[kind] ?? KINDS[DEFAULT_KIND]!);

// Each field against its limit: what the platform would cut
export function overLimits(d: Draft, kind: string): { field: string; len: number; max: number }[] {
  const k = KINDS[kind] ?? KINDS[DEFAULT_KIND]!, out: { field: string; len: number; max: number }[] = [];
  const main = [d.hook, d.body].filter(Boolean).join('\n').length;
  if (k.max && main > k.max) out.push({ field: 'النص الأساسي', len: main, max: k.max });
  if (k.head && (d.headline || '').length > k.head) out.push({ field: 'العنوان', len: (d.headline || '').length, max: k.head });
  if (k.desc && (d.description || '').length > k.desc) out.push({ field: 'الوصف', len: (d.description || '').length, max: k.desc });
  return out;
}

// Every draft gets the voice checks (dialect, sentence length, CTA, emoji) and the compliance rules,
// plus the project's own banned words. Notices only: nothing is blocked (Leen's rule).
export function review(d: Draft, p: Project, extra: Rule[] = [], kind = DEFAULT_KIND) {
  const text = [d.hook, d.body, d.headline, d.description, d.cta].filter(Boolean).join('\n');
  const v = analyze(text);
  const banned = p.banned.filter(w => text.includes(w));
  return { ...d, text, score: v.score, dialect: v.dialect, checks: v.checks, compliance: check(text, extra), banned, over: overLimits(d, kind) };
}
