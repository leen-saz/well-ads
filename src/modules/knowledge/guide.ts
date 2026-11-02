// دليل العلامة (PDF) ← بنود معرفة مقترحة: Workers AI يحوّل الـ PDF لنص (toMarkdown)، ونموذج المحتوى يطلع منه
// صوت العلامة والممنوع والادعاءات والألوان. كل بند ينحفظ موقوف (source = brand_file) لين يراجعه المدير ويفعّله.
import { tidy, type Entry, type Kind } from './knowledge';

export const GUIDE_KINDS: Kind[] = ['voice', 'forbidden', 'claim', 'note'];
export const MAX_TEXT = 24000;   // the part of the guide the model reads
export const MAX_PROPOSALS = 25;

export function guidePrompt(text: string): string {
  return `هذا نص دليل علامة تجارية لشركة رعاية صحية في السعودية. طلّع منه بنود معرفة يستخدمها كتّاب الإعلانات والمحتوى.
الأنواع:
- voice: نبرة وصوت العلامة وطريقة الكلام (مثال: "ودود وواثق، جمل قصيرة").
- forbidden: كلمة أو ادعاء ممنوع ينكتب (كلمة أو عبارة قصيرة في كل بند).
- claim: جملة أو حقيقة معتمدة عن الشركة تنكتب بنصها.
- note: أي شي ثاني مهم، ومنها ألوان العلامة بأكوادها والخطوط.
خذ اللي مكتوب في الدليل بس، ولا تخترع. بحد أقصى ${MAX_PROPOSALS} بند.
رد JSON فقط: [{"kind":"voice|forbidden|claim|note","title":"عنوان قصير","body":"..."}]

نص الدليل:
${text.slice(0, MAX_TEXT)}`;
}

// Only well-formed proposals of the allowed kinds, trimmed, without duplicates
export function parseProposals(raw: string): Pick<Entry, 'kind' | 'title' | 'body'>[] {
  const m = String(raw || '').match(/\[[\s\S]*\]/);
  if (!m) return [];
  let list: unknown;
  try { list = JSON.parse(m[0]); } catch { return []; }
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>(), out: Pick<Entry, 'kind' | 'title' | 'body'>[] = [];
  for (const x of list as Record<string, unknown>[]) {
    const kind = String(x?.kind || '') as Kind, body = tidy(x?.body, 1000), title = tidy(x?.title, 120);
    if (!GUIDE_KINDS.includes(kind) || body.length < 2 || seen.has(kind + body)) continue;
    seen.add(kind + body);
    out.push({ kind, title, body });
    if (out.length >= MAX_PROPOSALS) break;
  }
  return out;
}

type Md = { format: string; data?: string; error?: string };
export type ToMarkdown = (doc: { name: string; blob: Blob }) => Promise<Md>;
// The guide's text, or why not
export async function guideText(toMarkdown: ToMarkdown, bytes: ArrayBuffer): Promise<{ text?: string; error?: string }> {
  let r: Md;
  try { r = await toMarkdown({ name: 'guide.pdf', blob: new Blob([bytes], { type: 'application/pdf' }) }); } catch { return { error: 'ما قدرت أقرا الـ PDF الحين، جرّب بعد شوي' }; }
  const text = r.format !== 'error' ? String(r.data || '').replace(/\n{3,}/g, '\n\n').trim() : '';
  if (text.length < 50) return { error: 'الـ PDF ما فيه نص يتقرا (ممكن يكون صور بس)' };
  return { text };
}
