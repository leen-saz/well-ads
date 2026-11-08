// Transcribe, one step at a time. A job is advanced by whoever asks next: the page while it is open, the 5-minute cron
// otherwise. A step takes the job's lock first, so two askers never run the same step. Every step is one Gemini call
// (or the upload of the file to Google), which keeps each request inside what a Worker may do.
import { audit, env as authEnv, sb, type AuthEnv, type Cfg } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { usageCtx } from '../../lib/usage';
import { GeminiError, WHY, deleteFile, fileState, gemini, uploadFile, type GeminiEnv, type Part } from '../../lib/llm';
import { complianceOf } from '../../lib/library';
import { check } from '../compliance/compliance';
import { rulesFor } from '../knowledge/knowledge';
import { MAX_ATTEMPTS, SUMMARY_SYSTEM, libraryDoc, parseSummary, personalNotes, summaryPrompt, windowPrompt, windows, type Job } from './transcribe';

export type TEnv = GeminiEnv & { FILES?: R2Bucket };
export const LOCK_MS = 120_000;
export const STALE_MS = 120_000;
const iso = (t: number) => new Date(t).toISOString();
const rows = (d: unknown): Job[] => (Array.isArray(d) ? (d as Job[]) : []);

// Takes the job for one step, or null when it is done, not this company's, or another asker holds it
export async function acquire(cfg: Cfg, id: number, co: string, now = Date.now()): Promise<Job | null> {
  const path = scoped(`/rest/v1/transcribe_jobs?id=eq.${id}&status=in.(queued,processing)&or=(locked_until.is.null,locked_until.lt.${iso(now)})`, co);
  const r = await sb<Job[]>(cfg, path, { method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' }, body: { status: 'processing', locked_until: iso(now + LOCK_MS), updated_at: iso(now) } });
  return rows(r.data)[0] ?? null;
}

async function save(cfg: Cfg, job: Job, patch: Partial<Job> & Record<string, unknown>): Promise<Job> {
  // the lock is released unless the step asks to keep it shut for a while (a busy provider)
  const locked_until = 'locked_until' in patch ? patch.locked_until : null;
  const next = { ...job, ...patch, locked_until, updated_at: new Date().toISOString() } as Job;
  await sb(cfg, scoped(`/rest/v1/transcribe_jobs?id=eq.${job.id}`, job.company_id), { method: 'PATCH', admin: true, headers: { Prefer: 'return=minimal' },
    body: { ...patch, locked_until, updated_at: next.updated_at } });
  return next;
}

// The original file goes as soon as the job is over, either way: only text stays
async function cleanup(e: TEnv, job: Job, f: typeof fetch): Promise<void> {
  if (job.r2_key) await e.FILES?.delete(job.r2_key).catch(() => {});
  if (job.gemini_file) await deleteFile(e, job.gemini_file, f);
}
async function fail(e: TEnv, cfg: Cfg, job: Job, why: string, f: typeof fetch): Promise<Job> {
  await cleanup(e, job, f);
  await audit(cfg, { co: job.company_id, ...(job.created_by_id ? { uid: job.created_by_id } : {}) }, 'transcribe_failed', { target: { id: job.id } });
  return save(cfg, job, { status: 'failed', error: why, r2_key: null, gemini_file: null, gemini_uri: null });
}

export async function stepJob(e: TEnv, cfg: Cfg, job: Job, f: typeof fetch = fetch): Promise<Job> {
  const ctx = usageCtx(cfg, { co: job.company_id, ...(job.created_by_id ? { uid: job.created_by_id } : {}) }, 'transcribe');
  const wins = windows(job.seconds);
  try {
    // 0: the file goes from R2 to Google as a stream
    if (!job.gemini_uri) {
      const obj = job.r2_key ? await e.FILES?.get(job.r2_key) : null;
      if (!obj?.body) return fail(e, cfg, job, 'الملف ما انحفظ، ارفعه مرة ثانية', f);
      const file = await uploadFile(e, obj.body, job.mime, job.bytes, job.title, f);
      return save(cfg, job, { gemini_file: file.name, gemini_uri: file.uri, step: 1 });
    }
    // Video is processed after the upload: wait for it, a step that finds it still processing changes nothing
    const st = await fileState(e, job.gemini_file!, job.mime, f);
    if (st.state === 'FAILED') return fail(e, cfg, job, 'ما قدرنا نقرا الملف، جرّب صيغة ثانية', f);
    if (st.state !== 'ACTIVE') return save(cfg, job, {});
    // 1…n: one window of the recording
    if (job.step <= wins.length) {
      const w = wins[job.step - 1]!, video = job.mime.startsWith('video/');
      const parts: Part[] = [{ file: { mime: job.mime, uri: job.gemini_uri }, ...(video ? { from: w.from, to: w.to } : {}) }, { text: windowPrompt(w.from, w.to, job.step === wins.length) }];
      const out = await gemini(e, 'transcribe', { parts, max_tokens: 8000, temperature: 0.1 }, f, ctx);
      return save(cfg, job, { segments: [...job.segments, { from: w.from, to: w.to, text: out.text }], step: job.step + 1, attempts: 0 });
    }
    // n+1: the summary, the library draft, and the files deleted
    const transcript = job.segments.map(x => x.text).join('\n');
    let sum = null;
    try { sum = parseSummary((await gemini(e, 'transcribe', { system: SUMMARY_SYSTEM, parts: [{ text: summaryPrompt(transcript, job.purpose) }], max_tokens: 3000, json: true }, f, ctx)).text); }
    catch (err) { if (err instanceof GeminiError && (err.code === 'capped' || err.code === 'no_key')) throw err; /* the transcript is still worth keeping */ }
    const summary = sum ?? { summary: 'ما قدرنا نلخّص النص، النص كامل تحت.', hook: '', offer: '', actions: [] };
    const notes = personalNotes(transcript);
    const content = libraryDoc(job.title, summary, transcript, job.purpose);
    const lib = await sb<{ id: number }[]>(cfg, '/rest/v1/library_items', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' }, body: {
      company_id: job.company_id, module: 'transcribe', kind: 'text', title: `${job.title} · تفريغ`.slice(0, 120), content, platform: '', service: '',
      compliance_result: complianceOf(check(content, await rulesFor(cfg, job.company_id))), created_by: job.created_by, created_by_id: job.created_by_id } });
    const libraryId = Array.isArray(lib.data) ? lib.data[0]?.id : undefined;
    await cleanup(e, job, f);
    await audit(cfg, { co: job.company_id, ...(job.created_by_id ? { uid: job.created_by_id } : {}) }, 'transcribe_done', { target: { id: job.id, seconds: job.seconds, library: libraryId ?? null } });
    return save(cfg, job, { status: 'done', step: job.steps, r2_key: null, gemini_file: null, gemini_uri: null, result: { ...summary, notes, ...(libraryId ? { library_id: libraryId } : {}) } });
  } catch (err) {
    const code = err instanceof GeminiError ? err.code : 'failed';
    if (code === 'rate_limited') return save(cfg, job, { locked_until: iso(Date.now() + 60_000) });
    if (code === 'no_key' || code === 'capped') return fail(e, cfg, job, WHY[code], f);
    if (job.attempts + 1 >= MAX_ATTEMPTS) return fail(e, cfg, job, 'ما قدرنا نفرّغ الملف، جرّب مرة ثانية', f);
    return save(cfg, job, { attempts: job.attempts + 1 });
  }
}

// The 5-minute cron: one job nobody has touched for two minutes gets its next step (the page was closed)
export async function runTranscribe(e: TEnv & AuthEnv, now = Date.now(), f: typeof fetch = fetch): Promise<number> {
  let cfg: Cfg;
  try { cfg = authEnv(e); } catch { return 0; }
  if (!e.GEMINI_API_KEY) return 0;
  const r = await sb<Job[]>(cfg, `/rest/v1/transcribe_jobs?select=*&status=in.(queued,processing)&updated_at=lt.${iso(now - STALE_MS)}&or=(locked_until.is.null,locked_until.lt.${iso(now)})&order=updated_at.asc&limit=1`, { admin: true });
  const job = rows(r.data)[0];
  if (!job) return 0;
  const got = await acquire(cfg, job.id, job.company_id, now);
  if (!got) return 0;
  await stepJob(e, cfg, got, f);
  return 1;
}
