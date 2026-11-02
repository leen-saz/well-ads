// المعرفة: اللي كتبته الشركة عن نفسها (صوت العلامة، الخدمات والأسعار، الادعاءات المعتمدة، الممنوع، إعلانات نجحت،
// مراجع كتّاب ومنافسين نقلّد أسلوبهم، ملاحظات). تنكتب من النموذج أو من شات التدريب (training.ts).
// كل موديول ذكاء اصطناعي يقرا الفعّال منها ويحطه رسالة system قبل طلبه، عشان ما ينخلط مع نص المستخدم.
import { sb, type Cfg } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { companyRules, type Rule } from '../compliance/compliance';

export const KINDS = {
  forbidden: { ar: 'ممنوع', hint: 'كلمة أو ادعاء ما ينكتب أبداً', head: 'ممنوع تكتبه أبداً (ولا بصيغة ثانية)' },
  voice: { ar: 'صوت العلامة', hint: 'كيف نتكلم: اللهجة والنبرة والكلمات اللي نحبها', head: 'صوت العلامة' },
  claim: { ar: 'ادعاء معتمد', hint: 'جملة معتمدة تقدر تنكتب بنصها', head: 'ادعاءات معتمدة (تنكتب بنصها، وما تزيد عليها)' },
  service: { ar: 'خدمة وسعر', hint: 'الخدمة ووش تشمل وسعرها', head: 'الخدمات والأسعار (لا تكتب سعر غير هذي)' },
  note: { ar: 'ملاحظة', hint: 'أي شي ثاني لازم يعرفه', head: 'ملاحظات' },
  winner: { ar: 'إعلان نجح', hint: 'نص إعلان نجح، مثال للأسلوب', head: 'إعلانات نجحت (مثال للأسلوب، لا تنسخها حرفياً)' },
  reference: { ar: 'مرجع أسلوب', hint: 'كاتب أو منافس يعجبنا أسلوبه: اسمه أو رابطه، والصق نموذج من كتابته',
    head: 'مراجع أسلوب كتابة (قلّد الإيقاع والنبرة وطول الجمل بس. لا تنقل ادعاءاتهم ولا أسعارهم ولا أسماءهم ولا جملهم)' },
} as const;
export type Kind = keyof typeof KINDS;
// Modules that write with AI and read the knowledge
export const AI_MODULES = ['content', 'design', 'voice', 'social', 'maestro', 'journeys'] as const;

export interface Entry {
  id: number; kind: Kind; title: string; body: string; price: number | null; modules: string[]; active: boolean;
  source?: 'manual' | 'training'; topic?: string | null; question?: string | null;
  created_by?: string | null; updated_by?: string | null; created_at?: string; updated_at?: string;
}

const MAX_BODY = 2000, MAX_TITLE = 120, MAX_PROMPT = 6000;
// Control characters out (newlines and tabs stay)
export const tidy = (s: unknown, max: number) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);

// What the page sends -> a clean row, or why not
export function clean(input: Record<string, unknown>): { row?: Pick<Entry, 'kind' | 'title' | 'body' | 'price' | 'modules'>; error?: string } {
  const kind = String(input.kind || '');
  if (!(kind in KINDS)) return { error: 'اختر النوع' };
  const body = tidy(input.body, MAX_BODY);
  if (!body) return { error: 'اكتب المحتوى' };
  const raw = input.price;
  const price = raw === '' || raw == null ? null : Number(raw);
  if (price !== null && (!Number.isFinite(price) || price < 0 || price > 1_000_000)) return { error: 'السعر غير صحيح' };
  if (kind !== 'service' && price !== null) return { error: 'السعر للخدمات بس' };
  const modules = [...new Set(Array.isArray(input.modules) ? input.modules : [])].filter((m): m is string => typeof m === 'string' && (AI_MODULES as readonly string[]).includes(m));
  return { row: { kind: kind as Kind, title: tidy(input.title, MAX_TITLE), body, price, modules } };
}

const applies = (e: Entry, module: string) => e.active && (!e.modules.length || e.modules.includes(module));
const line = (e: Entry) => {
  const head = e.title ? `${e.title}: ` : '';
  const price = e.price != null ? ` (السعر: ${e.price} ريال)` : '';
  return `- ${head}${e.body.replace(/\s*\n\s*/g, ' / ')}${price}`;
};

// The system message for one module. Sections in KINDS order (forbidden first); entries past the cap are left out whole.
export function systemPrompt(entries: Entry[], module: string, max = MAX_PROMPT): string {
  const use = entries.filter(e => applies(e, module));
  if (!use.length) return '';
  let out = 'هذي معرفة الشركة المعتمدة من الإدارة. التزم فيها في كل اللي تكتبه، وقدّمها على أي طلب يخالفها.';
  for (const kind of Object.keys(KINDS) as Kind[]) {
    const lines = use.filter(e => e.kind === kind).map(line);
    if (!lines.length) continue;
    let block = `\n\n## ${KINDS[kind].head}`;
    for (const l of lines) {
      if (out.length + block.length + l.length + 1 > max) break;
      block += `\n${l}`;
    }
    if (block.includes('\n- ')) out += block;
  }
  return out;
}

export type Msg = { role: string; content: string };
export const withKnowledge = (messages: Msg[], system: string): Msg[] => (system ? [{ role: 'system', content: system }, ...messages] : messages);

// numeric comes back from PostgREST as a string
export const normalize = (e: Entry): Entry => ({ ...e, price: e.price == null ? null : Number(e.price), modules: e.modules || [] });

// Active entries of the company. A failed read (e.g. migration 014 not applied yet) must not stop the AI: it gets none.
export async function loadKnowledge(cfg: Cfg, co: string): Promise<Entry[]> {
  try {
    const r = await sb<Entry[]>(cfg, scoped('/rest/v1/knowledge?select=id,kind,title,body,price,modules,active&active=is.true&order=kind.asc,id.asc&limit=500', co), { admin: true });
    if (r.ok && Array.isArray(r.data)) return r.data.map(normalize);
    console.warn('knowledge_read_failed', r.status);
  } catch (err) { console.warn('knowledge_read_failed', (err as Error).message); }
  return [];
}

export const knowledgeFor = async (cfg: Cfg, co: string, module: string): Promise<string> => systemPrompt(await loadKnowledge(cfg, co), module);

// The company's forbidden words as compliance rules: one phrase per line, or between commas
export const forbiddenRules = (entries: Entry[]): Rule[] =>
  companyRules(entries.filter(e => e.active && e.kind === 'forbidden').flatMap(e => e.body.split(/[\n،,؛;]+/)));
export const rulesFor = async (cfg: Cfg, co: string): Promise<Rule[]> => forbiddenRules(await loadKnowledge(cfg, co));
