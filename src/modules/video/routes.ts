// /api/video/*: video projects of the user's company and their clip jobs. Reads need the `video` dashboard, writes edit level.
// Nothing here publishes anything: a result is a draft inside the system (approval: later in this tab).
import { sb, json, readJson, handle, requireUser, audit, atLeast, isOwner, notEnabled, missingSchema, notApplied, type Cfg } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { usageCtx } from '../../lib/usage';
import { AD_SECONDS, AVATARS, RATIOS, avatarOf } from './engine';
import { DEFAULT_ENGINE, ENGINES, engineOf } from './engines';
import { J_COLS, advance, cancel, createJobs, sayOf, type Job, type JobEnv } from './jobs';

type VEnv = Parameters<typeof requireUser>[1] & JobEnv;
const MIG = '032_video.sql';
const P_COLS = 'id,title,source_url,brief,script,ratio,seconds,avatar_id,review_status,reviewed_by,reviewed_at,review_note,approved_by,approved_at,created_by,created_at,updated_at';
const rows = <T>(d: unknown): T[] => (Array.isArray(d) ? d : []) as T[];
const NOT_READY = 'ما اكتمل تجهيزه، بلّغ الإدارة';
const POLL_MAX = 6;

// A job as the page sees it: no engine reference, no storage key, no code (a sentence instead)
const view = (j: Job) => ({ id: j.id, project_id: j.project_id, shot_no: j.shot_no, status: j.status, kind: j.params?.kind, seconds: j.params?.seconds, ratio: j.params?.ratio,
  attempts: j.attempts, say: j.status === 'failed' ? sayOf(j.error_code) : j.status === 'queued' && j.error_code ? sayOf(j.error_code) : '', ready: !!j.result_key, finished_at: j.finished_at });

async function projectOf(cfg: Cfg, co: string, id: unknown) {
  const n = parseInt(String(id), 10);
  if (!(n > 0)) return null;
  const r = await sb<Record<string, unknown>[]>(cfg, scoped(`/rest/v1/video_projects?id=eq.${n}&select=${P_COLS}`, co), { admin: true });
  return rows<Record<string, unknown>>(r.data)[0] ?? null;
}

// What the tab can do: engines with their capability maps, the avatar skills, and whether it is ready. The secret names go to the owner only.
export const engines = { GET: handle(async (request, e: VEnv) => {
  const { cfg, user } = await requireUser(request, e, 'video');
  const owner = isOwner(user, cfg);
  return json(200, {
    ratios: RATIOS, seconds: AD_SECONDS, avatars: AVATARS.map(a => ({ id: a.id, ar: a.ar, en: a.en, does: a.does, doesEn: a.doesEn })),
    engines: ENGINES.map(g => ({ id: g.id, label: g.label, ready: g.configured(e), caps: g.caps, ...(owner && !g.configured(e) ? { secrets: g.secrets } : {}) })),
    ready: ENGINES.some(g => g.configured(e)), canEdit: atLeast(user, 'video', 'edit', cfg), owner,
  });
}) };

export const projects = {
  GET: handle(async (request, e: VEnv) => {
    const { cfg, user } = await requireUser(request, e, 'video');
    const id = new URL(request.url).searchParams.get('id');
    if (id) { const p = await projectOf(cfg, user.co, id); return p ? json(200, { project: p }) : json(404, { error: 'الفيديو مو موجود' }); }
    const r = await sb(cfg, scoped(`/rest/v1/video_projects?select=${P_COLS}&order=created_at.desc&limit=50`, user.co), { admin: true });
    if (missingSchema(r)) return json(200, { projects: [], setup: notApplied(user, MIG) });
    return json(200, { projects: rows(r.data) });
  }),
  POST: handle(async (request, e: VEnv) => {
    const { cfg, user } = await requireUser(request, e, 'video', { write: true });
    const b = await readJson(request);
    const ratio = String(b.ratio || '9:16'), seconds = Number(b.seconds || 15), avatar = b.avatar_id ? String(b.avatar_id) : '';
    if (!(RATIOS as readonly string[]).includes(ratio)) return json(400, { error: 'اختر المقاس' });
    if (!(AD_SECONDS as readonly number[]).includes(seconds)) return json(400, { error: 'اختر المدة: 15 أو 30 أو 60 ثانية' });
    if (avatar && !avatarOf(avatar)) return json(400, { error: 'اختر مهارة أفاتار من القائمة' });
    const title = String(b.title || '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'فيديو جديد';
    const r = await sb<Record<string, unknown>[]>(cfg, '/rest/v1/video_projects', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' },
      body: { company_id: user.co, title, ratio, seconds, avatar_id: avatar, created_by: user.email, created_by_id: user.uid } });
    if (missingSchema(r)) return json(503, { error: notApplied(user, MIG) });
    const p = rows<Record<string, unknown>>(r.data)[0];
    if (!r.ok || !p) return json(500, { error: 'ما انحفظ الفيديو' });
    await audit(cfg, user, 'video_created', { target: { id: p.id, ratio, seconds } });
    return json(200, { ok: true, project: p });
  }),
};

// Clips of a project. GET also moves the due ones forward (that is the polling); POST queues clips; PATCH stops a queued one.
export const jobs = {
  GET: handle(async (request, e: VEnv) => {
    const { cfg, user } = await requireUser(request, e, 'video');
    const p = await projectOf(cfg, user.co, new URL(request.url).searchParams.get('project'));
    if (!p) return json(404, { error: 'الفيديو مو موجود' });
    const r = await sb<Job[]>(cfg, scoped(`/rest/v1/video_jobs?project_id=eq.${p.id}&select=${J_COLS}&order=shot_no.asc`, user.co), { admin: true });
    const list = rows<Job>(r.data);
    const ctx = { cfg, env: e as JobEnv, usage: usageCtx(cfg, user) };
    let moved = 0;
    const out: Job[] = [];
    for (const j of list) { out.push(moved < POLL_MAX && (j.status === 'queued' || j.status === 'running') ? (moved++, await advance(ctx, j)) : j); }
    return json(200, { jobs: out.map(view) });
  }),
  POST: handle(async (request, e: VEnv) => {
    const { cfg, user } = await requireUser(request, e, 'video', { write: true });
    const b = await readJson(request, 60_000);
    const engine = engineOf(b.engine || DEFAULT_ENGINE);
    if (!engine) return json(400, { error: 'المحرك غير معروف' });
    // Not set up: said now, nothing queued (the owner also gets the step)
    if (!engine.configured(e)) return json(503, { error: user.role === 'owner' ? notEnabled(user, 'توليد الفيديو', engine.secrets.join(' و ')) : NOT_READY });
    const p = await projectOf(cfg, user.co, b.project);
    if (!p) return json(404, { error: 'الفيديو مو موجود' });
    const clips = (Array.isArray(b.clips) ? b.clips : []).filter((c): c is Record<string, unknown> => !!c && typeof c === 'object');
    // the project decides the size, the avatar skill is the project's unless the clip names another
    const withDefaults = clips.map(c => ({ ratio: p.ratio, ...(p.avatar_id ? { avatarId: p.avatar_id } : {}), ...c }));
    const made = await createJobs(cfg, user, Number(p.id), engine, withDefaults);
    if (!made.jobs) return json(made.status || 400, { error: (made.problems || []).join('، '), problems: made.problems });
    return json(200, { ok: true, jobs: made.jobs.map(view) });
  }),
  PATCH: handle(async (request, e: VEnv) => {
    const { cfg, user } = await requireUser(request, e, 'video', { write: true });
    const b = await readJson(request);
    const id = parseInt(String(b.id), 10);
    const r = await sb<Job[]>(cfg, scoped(`/rest/v1/video_jobs?id=eq.${id > 0 ? id : 0}&select=${J_COLS}`, user.co), { admin: true });
    const j = rows<Job>(r.data)[0];
    if (!j) return json(404, { error: 'اللقطة مو موجودة' });
    if (!(await cancel(cfg, j))) return json(409, { error: 'اللقطة بدأت، ما تنوقف' });
    await audit(cfg, user, 'video_job_cancelled', { target: { id } });
    return json(200, { ok: true });
  }),
};

// A finished clip: served from our storage to people who may open the tab, never a public link
export const file = { GET: handle(async (request, e: VEnv) => {
  const { cfg, user } = await requireUser(request, e, 'video');
  const id = parseInt(new URL(request.url).searchParams.get('job') || '', 10);
  const r = await sb<Job[]>(cfg, scoped(`/rest/v1/video_jobs?id=eq.${id > 0 ? id : 0}&select=${J_COLS}`, user.co), { admin: true });
  const key = rows<Job>(r.data)[0]?.result_key;
  const files = (e as JobEnv).FILES;
  if (!key || !key.startsWith(`video/${user.co}/`) || !files) return json(404, { error: 'الملف غير موجود' });
  const obj = await files.get(key);
  if (!obj) return json(404, { error: 'الملف غير موجود' });
  return new Response(obj.body, { headers: { 'content-type': obj.httpMetadata?.contentType || 'video/mp4', 'cache-control': 'private, max-age=3600',
    'content-security-policy': "default-src 'none'; sandbox", 'x-content-type-options': 'nosniff' } });
}) };
