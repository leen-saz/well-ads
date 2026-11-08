// /api/transcribe/*: upload audio or video, step the job along, read the jobs and their results. Reading needs view on the tab,
// everything else edit. Files stay in R2 under transcribe/<company>/ only until the job is over.
import { sb, json, readJson, handle, requireUser, audit, missingSchema, notApplied, type AuthEnv } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { overCap, usageCtx } from '../../lib/usage';
import { WHY, deleteFile, geminiReady, notReady } from '../../lib/llm';
import { MAX_BYTES, MAX_OPEN, PURPOSES, TYPES, cleanUpload, stepsFor, view, type Job } from './transcribe';
import { acquire, stepJob, type TEnv } from './service';

const MIGRATION = 'migration 023_transcribe.sql';
type Env = AuthEnv & TEnv;
const rows = (d: unknown): Job[] => (Array.isArray(d) ? (d as Job[]) : []);
const COLS = 'id,company_id,created_by,created_by_id,title,purpose,mime,bytes,seconds,r2_key,status,step,steps,attempts,gemini_file,gemini_uri,segments,result,error,locked_until,created_at,updated_at';
const keyOf = (co: string) => `transcribe/${co}/${crypto.randomUUID().replace(/-/g, '')}`;
async function one(cfg: Parameters<typeof sb>[0], co: string, id: number): Promise<Job | null> {
  if (!(id > 0)) return null;
  return rows((await sb<Job[]>(cfg, scoped(`/rest/v1/transcribe_jobs?id=eq.${id}&select=${COLS}`, co), { admin: true })).data)[0] ?? null;
}

export const jobs = { GET: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'transcribe');
  const r = await sb<Job[]>(cfg, scoped(`/rest/v1/transcribe_jobs?select=${COLS}&order=created_at.desc&limit=30`, user.co), { admin: true });
  if (!r.ok) return json(missingSchema(r) ? 503 : 500, { error: missingSchema(r) ? notApplied(MIGRATION) : 'ما قدرت أقرأ الملفات' });
  const ready = geminiReady(e);
  return json(200, { jobs: rows(r.data).map(j => view(j)), ready, why: ready ? '' : notReady(user), purposes: PURPOSES, types: Object.keys(TYPES), max_mb: MAX_BYTES / 1048576 });
}) };

export const job = { GET: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'transcribe');
  const j = await one(cfg, user.co, parseInt(new URL(request.url).searchParams.get('id') || '', 10));
  return j ? json(200, { job: view(j, true) }) : json(404, { error: 'الملف مو موجود' });
}) };

// The file itself is the request body (type in Content-Type, length in Content-Length); the rest rides in the query
export const upload = { POST: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'transcribe', { write: true });
  if (!geminiReady(e)) return json(503, { error: notReady(user) });
  if (!e.FILES) return json(503, { error: 'رفع الملفات مو مفعّل في هالبيئة' });
  const q = new URL(request.url).searchParams;
  const c = cleanUpload({ title: q.get('title'), purpose: q.get('purpose'), mime: request.headers.get('content-type'), bytes: request.headers.get('content-length'), seconds: q.get('seconds') });
  if ('error' in c) return json(400, { error: c.error });
  const ctx = usageCtx(cfg, user, 'transcribe');
  if (ctx && await overCap(ctx, 'transcribe')) return json(429, { error: WHY.capped });
  const open = await sb<{ id: number }[]>(cfg, scoped(`/rest/v1/transcribe_jobs?select=id&status=in.(queued,processing)&limit=${MAX_OPEN}`, user.co), { admin: true });
  if (!open.ok) return json(missingSchema(open) ? 503 : 500, { error: missingSchema(open) ? notApplied(MIGRATION) : 'ما قدرت أبدأ' });
  if (Array.isArray(open.data) && open.data.length >= MAX_OPEN) return json(429, { error: 'عندك ملفات قيد التفريغ، انتظر لين تخلص' });
  if (!request.body) return json(400, { error: 'الملف فاضي' });
  const key = keyOf(user.co);
  const put = await e.FILES.put(key, request.body, { httpMetadata: { contentType: c.mime } }).catch(() => null);
  if (!put || put.size !== c.bytes) { await e.FILES.delete(key).catch(() => {}); return json(400, { error: 'الملف ما وصل كامل، جرّب مرة ثانية' }); }
  const r = await sb<Job[]>(cfg, '/rest/v1/transcribe_jobs', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' }, body: {
    company_id: user.co, created_by: user.email, created_by_id: user.uid, title: c.title, purpose: c.purpose, mime: c.mime, bytes: c.bytes, seconds: c.seconds, r2_key: key, steps: stepsFor(c.seconds) } });
  const made = rows(r.data)[0];
  if (!r.ok || !made) { await e.FILES.delete(key).catch(() => {}); return json(missingSchema(r) ? 503 : 500, { error: missingSchema(r) ? notApplied(MIGRATION) : 'ما انحفظ الملف' }); }
  await audit(cfg, user, 'transcribe_started', { target: { id: made.id, seconds: c.seconds, bytes: c.bytes, purpose: c.purpose } });
  return json(200, { ok: true, job: view(made) });
}) };

// Runs the job's next step (the page calls this in a loop while it is open)
export const step = { POST: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'transcribe', { write: true });
  const id = parseInt(String((await readJson(request, 2000)).id), 10);
  const j = await one(cfg, user.co, id);
  if (!j) return json(404, { error: 'الملف مو موجود' });
  if (j.status === 'done' || j.status === 'failed') return json(200, { job: view(j) });
  const got = await acquire(cfg, j.id, user.co);
  if (!got) return json(200, { job: view(j), busy: true });   // another step is running: ask again in a few seconds
  return json(200, { job: view(await stepJob(e, cfg, got)) });
}) };

// Stops a job and deletes its file
export const cancel = { POST: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'transcribe', { write: true });
  const j = await one(cfg, user.co, parseInt(String((await readJson(request, 2000)).id), 10));
  if (!j) return json(404, { error: 'الملف مو موجود' });
  if (j.status === 'done' || j.status === 'failed') return json(200, { job: view(j) });
  if (j.r2_key) await e.FILES?.delete(j.r2_key).catch(() => {});
  if (j.gemini_file) await deleteFile(e, j.gemini_file);
  await sb(cfg, scoped(`/rest/v1/transcribe_jobs?id=eq.${j.id}`, user.co), { method: 'PATCH', admin: true, headers: { Prefer: 'return=minimal' },
    body: { status: 'failed', error: 'أوقفته', r2_key: null, gemini_file: null, gemini_uri: null, locked_until: null, updated_at: new Date().toISOString() } });
  await audit(cfg, user, 'transcribe_cancelled', { target: { id: j.id } });
  return json(200, { job: view({ ...j, status: 'failed', error: 'أوقفته' }) });
}) };
