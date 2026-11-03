// الكوبي رايتر (docs/learning-loops.md، C1): إعداد لكل مشروع، ومنافسين بنصوصهم، وبطاقة نمط لكل منافس،
// ونصوص سعودية تمر على فاحص الصوت والامتثال. البطاقة حسابات ثابتة (بدون LLM)، والـ LLM للكتابة بس.
import { analyze } from '../voice/voice';
import { check, type Rule } from '../compliance/compliance';

export const KINDS: Record<string, { ar: string; max: number }> = {
  ad: { ar: 'إعلان (نص أساسي)', max: 600 },
  post: { ar: 'بوست عضوي', max: 1200 },
  caption: { ar: 'كابشن قصير', max: 220 },
  story: { ar: 'ستوري / سناب', max: 120 },
};

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
  const k = KINDS[kind] ?? KINDS.ad!;
  const style = cards.map(({ name, card }) => `- ${name}: متوسط ${card.avgWords} كلمة، والجملة ${card.avgSentence} كلمة، وأسئلة في ${card.questions}% من النصوص، وإيموجي ${card.emojiPer} لكل نص`
    + `${card.openers.length ? `، وافتتاحياتهم: ${card.openers.map(o => `«${o.text}»`).join('، ')}` : ''}${card.dialect.length ? `، وكلماتهم السعودية: ${card.dialect.map(d => d.word).join('، ')}` : ''}`
    + `${card.ctas.length ? `، ودعوتهم: ${card.ctas.map(c => c.word).join('، ')}` : ''}.`).join('\n');
  return [
    `أنت كاتب إعلانات سعودي. اكتب ${count} نسخ مختلفة من «${k.ar}» بلهجة سعودية بيضاء واضحة، قريبة ومهنية، جمل قصيرة.`,
    `المشروع: ${p.name}. الخدمة: ${p.service || '—'}. الجمهور: ${p.audience || 'عام في السعودية'}. العرض: ${p.offer || '—'}. الدعوة للخطوة: ${p.cta || 'احجز'}.`,
    p.voice ? `صوت العلامة: ${p.voice}` : '',
    style ? `خذ النمط (الطول والإيقاع والافتتاحية ونوع الدعوة) من هالمنافسين، بدون ما تنسخ ولا جملة منهم:\n${style}` : '',
    hooks.length ? `افتتاحيات نجحت عندنا (أرخص ليد): ${hooks.slice(0, 5).map(h => `«${h}»`).join('، ')}` : '',
    `ممنوع: ادعاءات علاجية أو "مضمون" أو "الأفضل" أو "الوحيد"، وأي مبالغة، وشهادات مرضى${p.banned.length ? `، وهالكلمات: ${p.banned.join('، ')}` : ''}.`,
    `كل نسخة أقل من ${k.max} حرف. رجّع JSON بس: [{"hook":"…","body":"…","cta":"…"}]`,
  ].filter(Boolean).join('\n');
}

export interface Draft { hook: string; body: string; cta: string }
export function parseDrafts(raw: string, max: number): Draft[] {
  const m = String(raw || '').match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]) as unknown[];
    return arr.map(x => x as Record<string, unknown>).map(x => ({ hook: s(x.hook, 200), body: String(x.body ?? '').trim().slice(0, max), cta: s(x.cta, 80) }))
      .filter(d => d.hook || d.body).slice(0, 5);
  } catch { return []; }
}

// No AI binding (or a bad answer): plain drafts from the setup, so the tab still works
export function fallbackDrafts(p: Project, count: number): Draft[] {
  const cta = p.cta || 'احجز موعدك';
  const offer = p.offer ? ` ${p.offer}.` : '';
  const out: Draft[] = [
    { hook: `تبي ${p.service || p.name} بدون مشوار؟`, body: `فريقنا يجيك لين بيتك.${offer}`, cta },
    { hook: `${p.service || p.name}، بالطريقة اللي تريحك`, body: `فريقنا معك من أول خطوة.${offer}`, cta },
    { hook: `وش تحتاج تعرف عن ${p.service || p.name}؟`, body: `نجاوبك على كل سؤال قبل ما تقرر.${offer}`, cta },
  ];
  return out.slice(0, count);
}

// Every draft gets the voice checks (dialect, sentence length, CTA, emoji) and the compliance rules,
// plus the project's own banned words. Notices only: nothing is blocked (Leen's rule).
export function review(d: Draft, p: Project, extra: Rule[] = []) {
  const text = [d.hook, d.body, d.cta].filter(Boolean).join('\n');
  const v = analyze(text);
  const banned = p.banned.filter(w => text.includes(w));
  return { ...d, text, score: v.score, dialect: v.dialect, checks: v.checks, compliance: check(text, extra), banned };
}
