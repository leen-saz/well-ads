// شات التدريب: الإيجنت يسأل سؤال سؤال لين تكتمل المعرفة، والمدرب يجاوب، وكل جواب ينحفظ بند معرفة يتعدل بعدين.
// الأسئلة الأساسية ثابتة (QUESTIONS). لما تخلص، الذكاء الاصطناعي يقرا المعرفة ويسأل عن أهم شي ناقص، لين يقول اكتملت.
import { KINDS, tidy, type Entry, type Kind } from './knowledge';
import { AI_MODEL, type AiRun } from '../content/content';

export interface Question { topic: string; kind: Kind; title: string; q: string }

export const QUESTIONS: Question[] = [
  { topic: 'services', kind: 'service', title: 'الخدمات', q: 'وش الخدمات اللي تقدمها؟ اكتب كل خدمة ووش تشمل.' },
  { topic: 'prices', kind: 'service', title: 'الأسعار', q: 'كم سعر كل خدمة؟ وهل فيه رسوم زيارة أو سعر يختلف حسب المنطقة أو الوقت؟' },
  { topic: 'audience', kind: 'note', title: 'العميل', q: 'مين عميلك؟ العمر والجنس والحالة اللي يدوّر لها حل.' },
  { topic: 'areas', kind: 'note', title: 'المناطق والأوقات', q: 'وين تقدم خدماتك؟ المدن والأحياء وأوقات العمل.' },
  { topic: 'booking', kind: 'note', title: 'طريقة الحجز', q: 'كيف العميل يحجز؟ رقم، واتساب، تطبيق، أو رابط؟' },
  { topic: 'why_us', kind: 'claim', title: 'ليش نحن', q: 'ليش العميل يختارك بدل غيرك؟ اكتب الأشياء اللي تقدر تثبتها.' },
  { topic: 'claims', kind: 'claim', title: 'ادعاءات معتمدة', q: 'وش الجمل المعتمدة اللي تقدر تقولها عن نفسك؟ مثل الترخيص وسنوات الخبرة وعدد الكوادر.' },
  { topic: 'offers', kind: 'note', title: 'العروض', q: 'وش العروض الحالية؟ ومدتها وشروطها؟' },
  { topic: 'tone', kind: 'voice', title: 'النبرة', q: 'كيف تبي العلامة تتكلم؟ اللهجة والنبرة، وكلمات تحبها وكلمات ما تحبها.' },
  { topic: 'forbidden', kind: 'forbidden', title: 'الممنوع', q: 'وش الكلمات أو الادعاءات اللي ما تبيها تنكتب أبداً؟' },
  { topic: 'references', kind: 'reference', title: 'مراجع الأسلوب', q: 'مين الكتّاب أو المنافسين اللي يعجبك أسلوب كتابتهم؟ حط الاسم أو الرابط، والصق نموذج من كتابتهم.' },
  { topic: 'winners', kind: 'winner', title: 'إعلان نجح', q: 'الصق نص إعلان نجح معك، وقل وش اللي نجّحه برأيك.' },
];

// Topics already answered (switched-off answers count: they wait for approval, not for a new answer)
export function nextQuestion(entries: Pick<Entry, 'topic'>[], skip: string[] = []): Question | null {
  const done = new Set([...entries.map(e => e.topic).filter(Boolean), ...skip]);
  return QUESTIONS.find(q => !done.has(q.topic)) || null;
}

const AI_FORMAT = { type: 'json_schema', json_schema: { type: 'object', required: ['done'], properties: {
  done: { type: 'boolean' }, question: { type: 'string' }, kind: { type: 'string', enum: Object.keys(KINDS) } } } };

export function followUpPrompt(entries: Entry[], asked: string[]): string {
  const known = entries.map(e => `- [${KINDS[e.kind]?.ar || e.kind}] ${e.title ? e.title + ': ' : ''}${e.body.slice(0, 300)}`).join('\n');
  return `أنت تجمع معلومات عن شركة رعاية صحية في السعودية عشان كتّاب الإعلانات والمحتوى يكتبون عنها صح.
هذي المعرفة اللي عندنا:
${known || '- ما فيه'}
أسئلة انسألت قبل (لا تكررها): ${asked.join(' | ') || 'ما فيه'}
وش أهم معلومة وحدة ناقصة يحتاجها كاتب الإعلانات؟ اسأل عنها سؤال واحد قصير بالسعودي، مخاطبة المذكر.
لو المعرفة تكفي لكتابة إعلانات ومحتوى دقيق، رد done=true.
رد JSON فقط: {"done":false,"question":"...","kind":"service|note|claim|voice|forbidden|reference|winner"}`;
}

export function parseFollowUp(text: string): Question | 'done' | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as { done?: unknown; question?: unknown; kind?: unknown };
    if (j.done === true) return 'done';
    const q = tidy(j.question, 300);
    if (!q) return null;
    const kind = String(j.kind) in KINDS ? (String(j.kind) as Kind) : 'note';
    return { topic: `ai-${Date.now().toString(36)}`, kind, title: 'سؤال إضافي', q };
  } catch { return null; }
}

// After the fixed questions: one more from the AI, or done. No AI (or a bad answer) = done for now.
export async function followUp(ai: AiRun | undefined, entries: Entry[], asked: string[]): Promise<Question | null> {
  if (!ai) return null;
  try {
    const out = await ai(AI_MODEL, { messages: [{ role: 'user', content: followUpPrompt(entries, asked) }], max_tokens: 200, response_format: AI_FORMAT });
    const r = (out as { response?: unknown })?.response;
    const q = parseFollowUp(typeof r === 'string' ? r : JSON.stringify(r ?? ''));
    return q && q !== 'done' && !asked.includes(q.q) ? q : null;
  } catch { return null; }
}

// A training answer -> a knowledge row. Fixed topics take kind and question from QUESTIONS, never from the page.
export function answerRow(input: Record<string, unknown>): { row?: Pick<Entry, 'kind' | 'title' | 'body' | 'price' | 'modules' | 'source' | 'topic' | 'question'>; error?: string } {
  const topic = String(input.topic || '');
  const body = tidy(input.answer, 2000);
  if (!body) return { error: 'اكتب الجواب' };
  const fixed = QUESTIONS.find(q => q.topic === topic);
  if (fixed) return { row: { kind: fixed.kind, title: fixed.title, body, price: null, modules: [], source: 'training', topic, question: fixed.q } };
  if (!/^ai-[a-z0-9]{1,12}$/.test(topic)) return { error: 'سؤال غير معروف' };
  const question = tidy(input.question, 300);
  if (!question) return { error: 'سؤال غير معروف' };
  const kind = String(input.kind) in KINDS ? (String(input.kind) as Kind) : 'note';
  return { row: { kind, title: 'سؤال إضافي', body, price: null, modules: [], source: 'training', topic, question } };
}
