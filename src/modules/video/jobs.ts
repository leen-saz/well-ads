// The job lifecycle: queued → running (submitted upstream) → done | failed | cancelled.
// A job is one clip. `advance()` moves ONE job one step and is safe to call twice at once: every change is a conditional
// PATCH on the state the caller saw, so only one caller wins. It runs when the page polls (and could run from a cron).
//   - retries: a busy engine or a dropped network puts the job back to `queued` with a growing wait, up to max_attempts
//   - cap: before every upstream call, a tab over its monthly cap stops the job (code cap_reached), nothing is sent
//   - cost: written to ai_usage once, when the clip is done (cost_recorded is flipped first, so a second caller skips it)
import { sb, audit, type Cfg } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { overCap, recordFlat, type UsageCtx } from '../../lib/usage';
import { videoCost } from '../../lib/prices';
import { EngineError, validate, type ClipInput, type Engine } from './engine';
import { engineOf } from './engines';

export interface Job {
  id: number; company_id: string; project_id: number; shot_no: number; engine: string; params: ClipInput;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'; attempts: number; max_attempts: number; next_attempt_at: string;
  upstream_ref: string | null; result_key: string | null; error_code: string | null; est_cost_usd: number; cost_recorded: boolean;
  created_by_id: string | null; created_at: string; updated_at: string; finished_at: string | null;
}
export const J_COLS = 'id,company_id,project_id,shot_no,engine,params,status,attempts,max_attempts,next_attempt_at,upstream_ref,result_key,error_code,est_cost_usd,cost_recorded,created_by_id,created_at,updated_at,finished_at';
export interface JobEnv { FILES?: R2Bucket | undefined; HIGGSFIELD_API_KEY?: string | undefined; HIGGSFIELD_API_SECRET?: string | undefined; HIGGSFIELD_SEEDANCE_MODEL?: string | undefined }

export const MAX_CLIPS = 12;
const STUCK_CLAIM_MS = 5 * 60_000, TIMEOUT_MS = 30 * 60_000, MAX_VIDEO_BYTES = 150 * 1024 * 1024;
export const backoffMs = (attempts: number): number => Math.min(10 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));

// What a code means to the user (plain words; the code itself is never shown)
export const SAY: Record<string, string> = {
  cap_reached: 'وصل الحد الشهري لصرف الفيديو، تواصل مع الإدارة',
  not_ready: 'ما اكتمل تجهيزه، بلّغ الإدارة',
  auth: 'ما اكتمل تجهيزه، بلّغ الإدارة',
  rejected: 'المحرك رفض اللقطة، عدّل الوصف وجرّب',
  blocked: 'المحرك منع هالمحتوى، غيّر الوصف',
  timeout: 'الفيديو أخذ وقت أطول من المعتاد وتوقف، جرّب مرة ثانية',
  network: 'محرك الفيديو ما ردّ، جرّب بعد شوي',
  rate: 'محرك الفيديو مشغول، جرّب بعد شوي',
  upstream: 'محرك الفيديو مشغول، جرّب بعد شوي',
  failed: 'ما انولدت اللقطة، جرّب مرة ثانية',
  no_video: 'ما انولدت اللقطة، جرّب مرة ثانية',
  store_failed: 'انولدت اللقطة بس ما انحفظت، جرّب مرة ثانية',
};
export const sayOf = (code: string | null): string => (code && SAY[code]) || (code ? SAY.failed! : '');

const rows = <T>(d: unknown): T[] => (Array.isArray(d) ? d : []) as T[];

// Validates the clips against the engine, then queues one job per clip. Nothing goes upstream here.
export async function createJobs(cfg: Cfg, user: { co: string; uid?: string; email?: string }, projectId: number, engine: Engine, clips: Record<string, unknown>[]): Promise<{ jobs?: Job[]; problems?: string[]; status?: number }> {
  if (!clips.length) return { problems: ['ما فيه لقطات'], status: 400 };
  if (clips.length > MAX_CLIPS) return { problems: [`الحد ${MAX_CLIPS} لقطة بالطلب`], status: 400 };
  const problems: string[] = [], inputs: ClipInput[] = [];
  clips.forEach((c, n) => { const v = validate(engine.caps, c); if (v.input) inputs.push(v.input); else problems.push(...v.problems.map(p => `اللقطة ${n + 1}: ${p}`)); });
  if (problems.length) return { problems, status: 400 };
  const r = await sb<Job[]>(cfg, '/rest/v1/video_jobs', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' },
    body: inputs.map((p, n) => ({ company_id: user.co, project_id: projectId, shot_no: n + 1, engine: engine.id, params: p, est_cost_usd: videoCost(engine.id, p.resolution, p.seconds).usd, created_by_id: user.uid ?? null })) });
  const jobs = rows<Job>(r.data);
  if (!r.ok || jobs.length !== inputs.length) return { problems: ['ما انحفظ الطلب'], status: 500 };
  await audit(cfg, user, 'video_jobs_queued', { target: { project: projectId, clips: jobs.length, engine: engine.id } });
  return { jobs };
}

// One conditional change: only if the job is still in the state `from` (and, for queued jobs, at the same attempt count)
async function move(cfg: Cfg, job: Job, from: Job['status'], patch: Record<string, unknown>): Promise<Job | null> {
  const r = await sb<Job[]>(cfg, scoped(`/rest/v1/video_jobs?id=eq.${job.id}&status=eq.${from}&attempts=eq.${job.attempts}`, job.company_id), { method: 'PATCH', admin: true,
    headers: { Prefer: 'return=representation' }, body: { updated_at: new Date().toISOString(), ...patch } });
  return rows<Job>(r.data)[0] ?? null;
}

const fail = (cfg: Cfg, job: Job, code: string) => move(cfg, job, job.status, { status: 'failed', error_code: code, finished_at: new Date().toISOString() });
// Back to the queue with a wait, or failed for good when the attempts are used
const retry = (cfg: Cfg, job: Job, code: string, now: number) => job.attempts >= job.max_attempts ? fail(cfg, job, code)
  : move(cfg, job, job.status, { status: 'queued', upstream_ref: null, error_code: code, next_attempt_at: new Date(now + backoffMs(job.attempts)).toISOString() });

// Copies the finished clip into our own storage (the engine's link expires). https only, no redirects, size limit.
export async function store(files: R2Bucket | undefined, co: string, url: string, f: typeof fetch = fetch): Promise<string | null> {
  if (!files) return null;
  try {
    if (new URL(url).protocol !== 'https:') return null;
    const r = await f(url, { redirect: 'error', signal: AbortSignal.timeout(60_000) });
    const len = Number(r.headers.get('content-length') || 0), type = (r.headers.get('content-type') || '').split(';')[0]!.trim().toLowerCase();
    if (!r.ok || !r.body || !(len > 0) || len > MAX_VIDEO_BYTES || !/^video\/(mp4|webm|quicktime)$/.test(type)) return null;
    const key = `video/${co}/${crypto.randomUUID()}.${type === 'video/webm' ? 'webm' : 'mp4'}`;
    await files.put(key, r.body, { httpMetadata: { contentType: type } });
    return key;
  } catch { return null; }
}

export interface Ctx { cfg: Cfg; env: JobEnv; usage?: UsageCtx | undefined; fetch?: typeof fetch; now?: number }

// Moves one job one step. Returns the job as it is afterwards.
export async function advance(c: Ctx, job: Job): Promise<Job> {
  const now = c.now ?? Date.now(), f = c.fetch ?? fetch, engine = engineOf(job.engine);
  const stamp = (s: string) => Date.parse(s) || 0;
  if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') return job;
  if (!engine) return (await fail(c.cfg, job, 'failed')) ?? job;

  // ---- queued: due → claim → check → submit
  if (job.status === 'queued') {
    if (stamp(job.next_attempt_at) > now) return job;
    if (!engine.configured(c.env)) return (await fail(c.cfg, job, 'not_ready')) ?? job;
    if (c.usage && await overCap(c.usage, 'video')) return (await fail(c.cfg, job, 'cap_reached')) ?? job;
    const claimed = await move(c.cfg, job, 'queued', { status: 'running', attempts: job.attempts + 1, error_code: null });
    if (!claimed) return job;   // someone else took it
    try {
      const { ref } = await engine.submit(c.env, claimed.params, f);
      return (await move(c.cfg, claimed, 'running', { upstream_ref: ref })) ?? claimed;
    } catch (err) {
      const ee = err instanceof EngineError ? err : new EngineError('network', true, '');
      return (ee.retryable ? await retry(c.cfg, claimed, ee.code, now) : await fail(c.cfg, claimed, ee.code)) ?? claimed;
    }
  }

  // ---- running
  if (!job.upstream_ref) {   // claimed but the Worker stopped before the engine answered
    return stamp(job.updated_at) + STUCK_CLAIM_MS < now ? (await retry(c.cfg, job, 'network', now)) ?? job : job;
  }
  if (stamp(job.updated_at) + TIMEOUT_MS < now) return (await fail(c.cfg, job, 'timeout')) ?? job;
  try {
    const s = await engine.status(c.env, job.upstream_ref, f);
    if (s.state === 'queued' || s.state === 'running') return job;
    if (s.state === 'failed') return (s.code === 'blocked' ? await fail(c.cfg, job, 'blocked') : await retry(c.cfg, job, s.code || 'failed', now)) ?? job;
    const key = await store(c.env.FILES, job.company_id, s.url!, f);
    if (!key) return (await retry(c.cfg, job, 'store_failed', now)) ?? job;
    const done = await move(c.cfg, job, 'running', { status: 'done', result_key: key, error_code: null, finished_at: new Date().toISOString() });
    if (done) await costOnce(c, done, engine);
    return done ?? job;
  } catch (err) {
    // the status call itself failed: a busy engine is retried at the next poll, anything else ends the job
    if (err instanceof EngineError && !err.retryable) return (await fail(c.cfg, job, err.code)) ?? job;
    return job;
  }
}

// Writes the clip's cost once: the flag is flipped first by a conditional PATCH, so two callers never both record
async function costOnce(c: Ctx, job: Job, engine: Engine): Promise<void> {
  const flip = await sb<Job[]>(c.cfg, scoped(`/rest/v1/video_jobs?id=eq.${job.id}&cost_recorded=eq.false`, job.company_id), { method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' }, body: { cost_recorded: true } });
  if (!rows<Job>(flip.data).length) return;
  const p = job.params, cost = videoCost(engine.id, p.resolution, p.seconds);
  await recordFlat(c.usage, 'video', { provider: 'higgsfield', model: engine.id, usd: cost.usd, priced: cost.priced });
}

// A job the user stops: only before it is sent. Once the engine is working, the clip is paid for anyway.
export const cancel = (cfg: Cfg, job: Job) => job.status === 'queued' ? move(cfg, job, 'queued', { status: 'cancelled', finished_at: new Date().toISOString() }) : Promise.resolve(null);
