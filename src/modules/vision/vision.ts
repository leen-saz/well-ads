// Vision: what an image upload may be, the prompt, and the reading of the answer. Pure, so the routes and the tests share it.
// The prompt is this project's own wording.
export const MAX_DATA = 2_000_000;          // base64 characters: the browser shrinks every image first, so this is generous
export const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export interface Upload { title: string; mime: string; data: string; hash: string }
export function cleanUpload(b: Record<string, unknown>): Upload | { error: string } {
  const mime = String(b.mime || '').toLowerCase();
  if (!TYPES.includes(mime)) return { error: 'هالصيغة مو مدعومة. ارفع صورة jpg أو png أو webp' };
  const data = String(b.data || '');
  if (!data) return { error: 'ما وصلت الصورة' };
  if (data.length > MAX_DATA) return { error: 'الصورة كبيرة، صغّرها وجرّب مرة ثانية' };
  const hash = String(b.hash || '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) return { error: 'ما وصلت الصورة كاملة، جرّب مرة ثانية' };
  return { title: String(b.title || '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'صورة بدون عنوان', mime, data, hash };
}

export const SYSTEM = 'أنت تحلل صور إعلانات لفريق تسويق شركة رعاية صحية منزلية في السعودية. الجواب JSON فقط، بالعربي، بدون أي شي خارجه. لا تخمّن أسماء أشخاص ولا تذكر بيانات شخصية، ولا تضيف شي ما تشوفه في الصورة.';
export const PROMPT = `حلل الصورة وأرجع JSON بهالمفاتيح:
"description": وصف واضح للصورة من جملة إلى جملتين، كأنك تشرحها لشخص ما يقدر يشوفها،
"alt": نص بديل أقصر من 125 حرف بدون كلمة «صورة» في أوله،
"text": كل النص المكتوب داخل الصورة بحروفه ونفس لغته وترتيبه، سطر لكل مقطع (فاضي لو ما فيه نص)،
"offer": العرض أو السعر لو ظاهر (فاضي لو لا)،
"hook": العبارة الرئيسية اللي تشد الانتباه أول شي (فاضي لو لا)،
"cta": دعوة الإجراء لو موجودة مثل «احجز الحين» (فاضي لو لا)،
"people": true لو في الصورة وجه شخص أو أكثر، وإلا false.`;

export interface Result { description: string; alt: string; text: string; offer: string; hook: string; cta: string; people: boolean }
const s = (x: unknown, n: number) => String(x ?? '').replace(/[ \t]+/g, ' ').trim().slice(0, n);
export function parseResult(raw: string): Result | null {
  const m = /\{[\s\S]*\}/.exec(raw);
  if (!m) return null;
  let j: Record<string, unknown>;
  try { j = JSON.parse(m[0]); } catch { return null; }
  const description = s(j.description, 800);
  if (!description) return null;
  // the text inside the image keeps its lines; everything else is one line
  const text = String(j.text ?? '').split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n').slice(0, 4000);
  return { description, alt: s(j.alt, 125).replace(/\s+/g, ' '), text, offer: s(j.offer, 300), hook: s(j.hook, 300), cta: s(j.cta, 200), people: j.people === true };
}

// Everything the image says, for the compliance check (same rules as copy and the rest)
export const sayings = (r: Result): string => [r.text, r.offer, r.hook, r.cta].filter(Boolean).join('\n');
// What the library keeps
export const libraryDoc = (title: string, r: Result): string => [title, '', 'الوصف', r.description, '', 'النص البديل', r.alt, ...(r.text ? ['', 'النص داخل الصورة', r.text] : []),
  ...(r.offer ? ['', 'العرض', r.offer] : []), ...(r.hook ? ['', 'الهوك', r.hook] : []), ...(r.cta ? ['', 'الدعوة', r.cta] : [])].join('\n').slice(0, 20_000);

export interface Row {
  id: number; company_id: string; title: string; file_hash: string; mime: string; result: Result; compliance_result: { hits?: { rule: string; level: string; title: string; match: string; fix: string }[]; checked_at?: string };
  library_id: number | null; created_by: string | null; created_by_id: string | null; created_at: string;
}
export const view = (r: Row) => ({ id: r.id, title: r.title, result: r.result, compliance: r.compliance_result.hits || [], library_id: r.library_id, created_at: r.created_at });
