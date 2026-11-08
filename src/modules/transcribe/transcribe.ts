// Transcribe: what an upload may be, how a long file is cut into windows, the two prompts, the reading of the summary, and the
// warning for personal numbers. Pure, so the routes, the cron and the tests share it. Prompts are this project's own.
export const MB = 1024 * 1024;
// A Worker request body is limited to about 100 MB; a longer recording is split before the upload
export const MAX_BYTES = 95 * MB;
export const MAX_SECONDS = 4 * 3600;
export const WINDOW = 600;          // seconds transcribed in one step
export const MAX_OPEN = 3;          // files being transcribed at once per company
export const MAX_ATTEMPTS = 3;

export const TYPES: Record<string, string> = {
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/flac': 'flac', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
};
export const PURPOSES = { meeting: 'اجتماع', ad: 'إعلان أو مقطع' } as const;
export type Purpose = keyof typeof PURPOSES;

export interface Upload { title: string; purpose: Purpose; mime: string; bytes: number; seconds: number }
export function cleanUpload(q: { title?: unknown; purpose?: unknown; mime?: unknown; bytes?: unknown; seconds?: unknown }): Upload | { error: string } {
  const mime = String(q.mime || '').split(';')[0]!.trim().toLowerCase();
  if (!(mime in TYPES)) return { error: 'هالصيغة مو مدعومة. ارفع mp3 أو m4a أو wav أو mp4' };
  const bytes = Math.floor(Number(q.bytes));
  if (!(bytes > 0)) return { error: 'الملف فاضي' };
  if (bytes > MAX_BYTES) return { error: `الملف أكبر من ${MAX_BYTES / MB} ميقا. قسّمه لأجزاء وارفعها وحدة وحدة` };
  const seconds = Math.round(Number(q.seconds));
  if (!(seconds >= 1)) return { error: 'ما قدرنا نعرف مدة الملف' };
  if (seconds > MAX_SECONDS) return { error: `المدة أطول من ${MAX_SECONDS / 3600} ساعات. قسّم الملف` };
  const purpose: Purpose = String(q.purpose) === 'ad' ? 'ad' : 'meeting';
  return { title: String(q.title || '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'ملف بدون عنوان', purpose, mime, bytes, seconds };
}

// A file of `seconds` is read in windows of WINDOW seconds. Steps: 0 sends the file, 1…n one window each, n+1 the summary.
export const windows = (seconds: number): { from: number; to: number }[] =>
  Array.from({ length: Math.max(1, Math.ceil(seconds / WINDOW)) }, (_, i) => ({ from: i * WINDOW, to: Math.min(seconds, (i + 1) * WINDOW) }));
export const stepsFor = (seconds: number): number => windows(seconds).length + 2;

export const mmss = (s: number): string => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function windowPrompt(from: number, to: number, last: boolean): string {
  return [
    `فرّغ الكلام المسموع من ${mmss(from)} إلى ${mmss(to)} من التسجيل، كما قيل بالضبط.`,
    'احتفظ بلهجة المتكلم ولا تحوّلها للفصحى. اكتب كل مقطع كلام في سطر يبدأ بالوقت بين قوسين مربعين مثل [03:25].',
    'لو تغيّر المتكلم ابدأ سطر جديد. الجزء اللي ما انفهم اكتب مكانه [غير واضح]. لا تضيف شرح ولا تلخيص ولا عناوين، ولا تكتب شي ما سمعته.',
    last ? 'هذا آخر جزء من التسجيل.' : 'التسجيل أطول من هالجزء، فاكتب لين الوقت المطلوب بس.',
  ].join('\n');
}

export const SUMMARY_SYSTEM = 'أنت مساعد يلخّص نصوص مفرّغة لفريق تسويق شركة رعاية صحية منزلية في السعودية. الجواب JSON فقط، بالعربي، بدون أي شي خارجه. لا تخترع شي ما ورد في النص.';
export function summaryPrompt(transcript: string, purpose: Purpose): string {
  const ask = purpose === 'ad'
    ? '"summary": ملخص بسطرين لفكرة المقطع، "hook": أول جملة أو مشهد في أول 3 ثواني (فاضي لو ما انسمع)، "offer": العرض أو السعر لو انذكر (فاضي لو لا)، "actions": []'
    : '"summary": ملخص من 3 إلى 5 أسطر لأهم ما قيل وما تقرر، "hook": "", "offer": "", "actions": قائمة بنود العمل، كل بند {"task": "...", "owner": "المسؤول لو انذكر وإلا فاضي", "due": "الموعد لو انذكر وإلا فاضي"}';
  return `النص المفرّغ:\n"""\n${transcript.slice(0, 120_000)}\n"""\n\nأرجع JSON بهالمفاتيح: ${ask}`;
}

export interface Summary { summary: string; hook: string; offer: string; actions: { task: string; owner: string; due: string }[] }
const s = (x: unknown, n: number) => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export function parseSummary(text: string): Summary | null {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  let j: Record<string, unknown>;
  try { j = JSON.parse(m[0]); } catch { return null; }
  const summary = s(j.summary, 1500);
  if (!summary) return null;
  const actions = (Array.isArray(j.actions) ? j.actions : []).slice(0, 30).flatMap(a => {
    const o = (a && typeof a === 'object' ? a : { task: a }) as Record<string, unknown>;
    const task = s(o.task, 300);
    return task ? [{ task, owner: s(o.owner, 80), due: s(o.due, 80) }] : [];
  });
  return { summary, hook: s(j.hook, 300), offer: s(j.offer, 300), actions };
}

// Personal numbers in a transcript (the PRD keeps patient data out): counts only, never the numbers
const DIGITS = (t: string) => t.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
export function personalNotes(text: string): { kind: 'phone' | 'id' | 'patient'; n: number }[] {
  const t = DIGITS(text).replace(/(?<=\d)[\s-](?=\d)/g, '');
  const phone = (t.match(/(?:\+?966|00966|0)5\d{8}/g) || []).length;
  const id = (t.match(/(?<!\d)[12]\d{9}(?!\d)/g) || []).length;
  const patient = (text.match(/المريض|المريضة|اسم المريض|رقم الملف/g) || []).length;
  return ([['phone', phone], ['id', id], ['patient', patient]] as const).filter(([, n]) => n > 0).map(([kind, n]) => ({ kind, n }));
}
export const NOTE_AR = { phone: 'رقم جوال', id: 'رقم هوية أو إقامة', patient: 'ذكر مريض' } as const;

// The library draft: summary, action items, then the timed transcript
export function libraryDoc(title: string, sum: Summary, transcript: string, purpose: Purpose): string {
  const lines = ['الملخص', sum.summary];
  if (purpose === 'ad') { if (sum.hook) lines.push('', 'الهوك (أول 3 ثواني)', sum.hook); if (sum.offer) lines.push('', 'العرض', sum.offer); }
  else if (sum.actions.length) lines.push('', 'بنود العمل', ...sum.actions.map(a => `- ${a.task}${a.owner ? ` (${a.owner})` : ''}${a.due ? ` · ${a.due}` : ''}`));
  lines.push('', 'النص كامل', transcript);
  return `${title}\n\n${lines.join('\n')}`.slice(0, 20_000);
}

export type Status = 'queued' | 'processing' | 'done' | 'failed';
export interface Job {
  id: number; company_id: string; created_by: string | null; created_by_id: string | null; title: string; purpose: Purpose; mime: string; bytes: number; seconds: number;
  r2_key: string | null; status: Status; step: number; steps: number; attempts: number; gemini_file: string | null; gemini_uri: string | null;
  segments: { from: number; to: number; text: string }[]; result: { summary?: string; hook?: string; offer?: string; actions?: Summary['actions']; notes?: { kind: string; n: number }[]; library_id?: number };
  error: string | null; locked_until: string | null; created_at: string; updated_at: string;
}
// What the page gets: progress and the result, never storage keys or provider file names
export const view = (j: Job, full = false) => ({
  id: j.id, title: j.title, purpose: j.purpose, seconds: j.seconds, status: j.status, step: j.step, steps: j.steps, error: j.error, created_at: j.created_at,
  ...(full || j.status === 'done' ? { result: j.result } : {}),
  ...(full ? { transcript: j.segments.map(x => x.text).join('\n') } : {}),
});
