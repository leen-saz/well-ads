// /api/video/*: video projects of the user's company and their clip jobs. Reads need the `video` dashboard, writes edit level.
// Nothing here publishes anything: a result is a draft inside the system (approval: later in this tab).
import { sb, json, readJson, handle, requireUser, audit, atLeast, isOwner, missingSchema, type Cfg } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { usageCtx } from '../../lib/usage';
import { generate, pick, type LlmEnv } from '../../lib/llm';
import { knowledgeFor, rulesFor, withKnowledge } from '../knowledge/knowledge';
import { briefPrompt, cleanBrief, fallbackBrief, isEmpty, pageText, parseJson, type Brief } from './brief';
import { readPage } from './safe-fetch';
import { cleanEdit, cleanScript, fitNote, notices, plan, scriptPrompt, type Script } from './script';
import { avatarOf as avatarSkill } from './engine';
import { AD_SECONDS, AVATARS, RATIOS, avatarOf } from './engine';
import { DEFAULT_ENGINE, ENGINES, engineOf } from './engines';
import { J_COLS, advance, cancel, createJobs, sayOf, type Job, type JobEnv } from './jobs';

type VEnv = Parameters<typeof requireUser>[1] & JobEnv & LlmEnv;
const MIG = '034_video.sql';
const P_COLS = 'id,title,source_url,brief,script,ratio,seconds,avatar_id,review_status,reviewed_by,reviewed_at,review_note,approved_by,approved_at,created_by,created_at,updated_at';
const rows = <T>(d: unknown): T[] => (Array.isArray(d) ? d : []) as T[];
// The one sentence everybody reads when something is not set up. What to set up goes to the owner's status card only (engines GET).
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
    engines: ENGINES.map(g => ({ id: g.id, label: g.label, ready: g.configured(e), caps: g.caps })),
    ready: ENGINES.some(g => g.configured(e)), canEdit: atLeast(user, 'video', 'edit', cfg), owner,
    // the owner's status card: what is still to set up (names only, never values)
    ...(owner ? { setup: { secrets: ENGINES.filter(g => !g.configured(e)).flatMap(g => g.secrets), migration: MIG } } : {}),
  });
}) };

const EDITABLE = ['draft', 'returned'];
const clipSizes = () => engineOf(DEFAULT_ENGINE)!.caps.clipSeconds;
const asScript = (p: Record<string, unknown>): (Script & { voice_url?: string }) | null => { const s = p.script as (Script & { voice_url?: string }) | undefined; return s && Array.isArray(s.shots) && s.shots.length ? s : null; };
// What the page shows next to a project: the compliance notices on its script (computed now, so a new rule shows at once) and the length note
async function extras(cfg: Cfg, co: string, p: Record<string, unknown>) {
  const s = asScript(p);
  return s ? { notices: notices(s, await rulesFor(cfg, co)), fit: fitNote(s, Number(p.seconds)) } : { notices: [], fit: '' };
}
const httpsOnly = (v: unknown): string => { try { const u = new URL(String(v || '')); return u.protocol === 'https:' && !u.username && !u.password ? u.toString().slice(0, 1000) : ''; } catch { return ''; } };
const hasJobs = async (cfg: Cfg, co: string, id: number) => rows(((await sb(cfg, scoped(`/rest/v1/video_jobs?project_id=eq.${id}&select=id&limit=1`, co), { admin: true })).data)).length > 0;

export const projects = {
  GET: handle(async (request, e: VEnv) => {
    const { cfg, user } = await requireUser(request, e, 'video');
    const id = new URL(request.url).searchParams.get('id');
    if (id) { const p = await projectOf(cfg, user.co, id); return p ? json(200, { project: p, ...(await extras(cfg, user.co, p)) }) : json(404, { error: 'الفيديو مو موجود' }); }
    const r = await sb(cfg, scoped(`/rest/v1/video_projects?select=${P_COLS}&order=created_at.desc&limit=50`, user.co), { admin: true });
    if (missingSchema(r)) return json(200, { projects: [], notReady: true });
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
    if (missingSchema(r)) return json(503, { error: NOT_READY });
    const p = rows<Record<string, unknown>>(r.data)[0];
    if (!r.ok || !p) return json(500, { error: 'ما انحفظ الفيديو' });
    await audit(cfg, user, 'video_created', { target: { id: p.id, ratio, seconds } });
    return json(200, { ok: true, project: p });
  }),
  // Edits: the title, the brief, the script (the notices are recomputed), the voice file of the avatar. The size and length only before any shot exists.
  PATCH: handle(async (request, e: VEnv) => {
    const { cfg, user } = await requireUser(request, e, 'video', { write: true });
    const b = await readJson(request, 60_000);
    const p = await projectOf(cfg, user.co, b.id);
    if (!p) return json(404, { error: 'الفيديو مو موجود' });
    if (!EDITABLE.includes(String(p.review_status))) return json(409, { error: 'الفيديو في المراجعة أو معتمد، ما ينعدّل' });
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if ('title' in b) patch.title = String(b.title || '').replace(/\s+/g, ' ').trim().slice(0, 120) || p.title;
    if ('brief' in b) patch.brief = cleanBrief(b.brief);
    let seconds = Number(p.seconds);
    if ('ratio' in b || 'seconds' in b || 'avatar_id' in b) {
      if (await hasJobs(cfg, user.co, Number(p.id))) return json(409, { error: 'بدأت اللقطات، المقاس والمدة والأفاتار ما تتغيّر. أنشئ فيديو جديد' });
      if ('ratio' in b) { if (!(RATIOS as readonly string[]).includes(String(b.ratio))) return json(400, { error: 'اختر المقاس' }); patch.ratio = String(b.ratio); }
      if ('seconds' in b) { if (!(AD_SECONDS as readonly number[]).includes(Number(b.seconds))) return json(400, { error: 'اختر المدة: 15 أو 30 أو 60 ثانية' }); seconds = Number(b.seconds); patch.seconds = seconds; }
      if ('avatar_id' in b) { if (b.avatar_id && !avatarSkill(b.avatar_id)) return json(400, { error: 'اختر مهارة أفاتار من القائمة' }); patch.avatar_id = b.avatar_id ? String(b.avatar_id) : ''; }
    }
    if ('script' in b || 'voice_url' in b) {
      const cur = asScript(p);
      const next = 'script' in b ? cleanEdit(b.script, plan(seconds, clipSizes())) : cur;
      if ('script' in b && !next) return json(400, { error: 'السكربت فاضي' });
      if (next) { const vu = 'voice_url' in b ? httpsOnly(b.voice_url) : cur?.voice_url || ''; patch.script = { ...next, ...(vu ? { voice_url: vu } : {}) }; }
    }
    const r = await sb<Record<string, unknown>[]>(cfg, scoped(`/rest/v1/video_projects?id=eq.${p.id}&review_status=in.(draft,returned)&select=${P_COLS}`, user.co), { method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' }, body: patch });
    const out = rows<Record<string, unknown>>(r.data)[0];
    if (!r.ok || !out) return json(500, { error: 'ما انحفظ التعديل' });
    await audit(cfg, user, 'video_edited', { target: { id: p.id, fields: Object.keys(patch).filter(k => k !== 'updated_at') } });
    return json(200, { ok: true, project: out, ...(await extras(cfg, user.co, out)) });
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
    if (!engine.configured(e)) return json(503, { error: NOT_READY });
    const p = await projectOf(cfg, user.co, b.project);
    if (!p) return json(404, { error: 'الفيديو مو موجود' });
    const clips = (Array.isArray(b.clips) ? b.clips : []).filter((c): c is Record<string, unknown> => !!c && typeof c === 'object');
    // the project decides the size, the avatar skill is the project's unless the clip names another
    const withDefaults = clips.map(c => ({ ratio: p.ratio, ...(p.avatar_id ? { avatarId: p.avatar_id } : {}), ...c }));
    const made = await createJobs(cfg, user, Number(p.id), engine, withDefaults, usageCtx(cfg, user));
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

// A product or service page → the brief, for editing. The page is fetched here (https only, no private addresses, size and time limits);
// the model only reads the text. Without a model the page's own title and description are the starting point.
export const brief = { POST: handle(async (request, e: VEnv) => {
  const { cfg, user } = await requireUser(request, e, 'video', { write: true });
  const b = await readJson(request);
  const page = await readPage(String(b.url || '').trim().slice(0, 2000));
  if (!page.ok) return json(400, { error: page.error });
  const text = pageText(page.html);
  if (text.text.length < 40) return json(422, { error: 'الصفحة ما فيها نص كفاية، جرّب رابط ثاني أو اكتب الموجز بإيدك' });
  let out: Brief | null = null, from: 'model' | 'page' = 'page';
  if (pick(e, 'video')) {
    try {
      const r = await generate(e, 'video', { messages: briefPrompt(text), max_tokens: 900 }, fetch, usageCtx(cfg, user));
      const c = cleanBrief(parseJson(r.response));
      if (!isEmpty(c)) { out = c; from = 'model'; }
    } catch (err) { console.warn('video_brief_failed', (err as Error).message); }
  }
  out ||= fallbackBrief(text);
  if (b.project) {
    const p = await projectOf(cfg, user.co, b.project);
    if (!p) return json(404, { error: 'الفيديو مو موجود' });
    if (!EDITABLE.includes(String(p.review_status))) return json(409, { error: 'الفيديو في المراجعة أو معتمد، ما ينعدّل' });
    await sb(cfg, scoped(`/rest/v1/video_projects?id=eq.${p.id}`, user.co), { method: 'PATCH', admin: true, body: { brief: out, source_url: page.url.slice(0, 1000), updated_at: new Date().toISOString() } });
  }
  await audit(cfg, user, 'video_brief', { target: { host: new URL(page.url).hostname, from } });
  return json(200, { ok: true, brief: out, source: page.url, from });
}) };

// The script and the shot plan, from the saved brief, the brand's knowledge and the length and size of the project
export const script = { POST: handle(async (request, e: VEnv) => {
  const { cfg, user } = await requireUser(request, e, 'video', { write: true });
  const b = await readJson(request);
  const p = await projectOf(cfg, user.co, b.id);
  if (!p) return json(404, { error: 'الفيديو مو موجود' });
  if (!EDITABLE.includes(String(p.review_status))) return json(409, { error: 'الفيديو في المراجعة أو معتمد، ما ينعدّل' });
  const br = cleanBrief(p.brief);
  if (isEmpty(br)) return json(400, { error: 'اكتب الموجز أول: الخدمة والعرض والفوائد' });
  if (!pick(e, 'video')) return json(503, { error: NOT_READY });
  const clips = plan(Number(p.seconds), clipSizes()), ratio = RATIOS.find(r => r === p.ratio) ?? '9:16';
  const skill = avatarSkill(p.avatar_id);
  let made: Script | null = null;
  try {
    const messages = withKnowledge(scriptPrompt({ brief: br, seconds: Number(p.seconds), ratio, clips, ...(skill ? { avatar: skill.doesEn } : {}) }), await knowledgeFor(cfg, user.co, 'video'));
    const r = await generate(e, 'video', { messages, max_tokens: 2200 }, fetch, usageCtx(cfg, user));
    made = cleanScript(parseJson(r.response), clips);
  } catch (err) { console.warn('video_script_failed', (err as Error).message); }
  if (!made) return json(502, { error: 'ما طلع سكربت صالح، جرّب مرة ثانية' });
  const keep = asScript(p)?.voice_url;
  const stored = { ...made, ...(keep ? { voice_url: keep } : {}) };
  const r = await sb<Record<string, unknown>[]>(cfg, scoped(`/rest/v1/video_projects?id=eq.${p.id}&review_status=in.(draft,returned)&select=${P_COLS}`, user.co), { method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' }, body: { script: stored, updated_at: new Date().toISOString() } });
  const out = rows<Record<string, unknown>>(r.data)[0];
  if (!r.ok || !out) return json(500, { error: 'ما انحفظ السكربت' });
  await audit(cfg, user, 'video_script', { target: { id: p.id, shots: made.shots.length } });
  return json(200, { ok: true, project: out, ...(await extras(cfg, user.co, out)) });
}) };

// «ولّد الفيديو»: one clip per shot of the saved script. The notices do not stop it (they are for the people who review),
// and the result is a draft inside the system.
export const render = { POST: handle(async (request, e: VEnv) => {
  const { cfg, user } = await requireUser(request, e, 'video', { write: true });
  const b = await readJson(request);
  const engine = engineOf(b.engine || DEFAULT_ENGINE);
  if (!engine) return json(400, { error: 'المحرك غير معروف' });
  if (!engine.configured(e)) return json(503, { error: NOT_READY });
  const p = await projectOf(cfg, user.co, b.id);
  if (!p) return json(404, { error: 'الفيديو مو موجود' });
  if (!EDITABLE.includes(String(p.review_status))) return json(409, { error: 'الفيديو في المراجعة أو معتمد، ما ينعدّل' });
  const s = asScript(p);
  if (!s) return json(400, { error: 'اكتب السكربت أول' });
  const active = await sb<Job[]>(cfg, scoped(`/rest/v1/video_jobs?project_id=eq.${p.id}&status=in.(queued,running)&select=id&limit=1`, user.co), { admin: true });
  if (rows(active.data).length) return json(409, { error: 'فيه لقطات تتولّد الحين، انتظرها تخلص' });
  const avatar = !!p.avatar_id;
  if (avatar && !s.voice_url) return json(400, { error: 'الأفاتار يحتاج رابط ملف الصوت' });
  const clips = s.shots.map(x => ({ kind: avatar ? 'avatar' : 'text-to-video', prompt: avatar ? x.line : x.prompt || x.scene, seconds: x.seconds, ratio: p.ratio, resolution: '720p',
    ...(avatar ? { avatarId: p.avatar_id, voiceUrl: s.voice_url } : {}) }));
  const made = await createJobs(cfg, user, Number(p.id), engine, clips, usageCtx(cfg, user));
  if (!made.jobs) return json(made.status || 400, { error: (made.problems || []).join('، '), problems: made.problems });
  return json(200, { ok: true, jobs: made.jobs.map(view) });
}) };
