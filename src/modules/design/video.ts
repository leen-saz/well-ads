// Design → «موشن جرافيك» (docs/motion-video.md): /design/video/. The approved design and voice become a motion video;
// projects and their versions, a version is never changed. Moved here from Maestro: Maestro orchestrates the agents.
import { sb, json, readJson, handle, requireUser, audit, atLeast, notEnabled, missingSchema, notApplied, type AuthEnv, type Cfg } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { generate, pick, type LlmEnv, type Msg } from '../../lib/llm';
import { client, type PcEnv } from '../maestro/paperclip';
import { knowledgeFor, rulesFor, withKnowledge } from '../knowledge/knowledge';
import { brandFor } from '../knowledge/brand';
import { check } from '../compliance/compliance';
import { ANIMS, RATIOS, checkUpload, clampSeconds, cleanSpec, editPrompt, fileKey, ownKey, parseSpec, ratioOf, specPrompt, templateSpec, type Spec } from './motion';

type Env = AuthEnv & PcEnv;
type Co = { id: string; name: string; paperclip_company_id: string | null };
// The company's Maestro (Paperclip) link: a new video opens a task there when connected
async function companyOf(cfg: Cfg, co: string): Promise<Co | null> {
  const r = await sb<Co[]>(cfg, `/rest/v1/companies?id=eq.${co}&select=id,name,paperclip_company_id`, { admin: true });
  return r.ok && Array.isArray(r.data) ? r.data[0] || null : null;
}

// The plan is written by ChatGPT (OpenAI, PAID per version: one text call); without the key v1 comes from a template.
type VEnv = Env & LlmEnv & { FILES?: R2Bucket };
interface Project { id: number; title: string; headline: string; script: string; ratio: string; design_key: string; design_mime: string; voice_key: string; voice_mime: string;
  voice_seconds: number; status: 'draft' | 'approved'; approved_version: number | null; approved_by: string | null; approved_at: string | null; pc_issue: string | null; created_by: string | null; created_at: string }
interface Version { id: number; project_id: number; version: number; parent_version: number | null; change_request: string | null; spec: Spec; engine: string; model: string | null; created_by: string | null; created_at: string }
const MIG = '018_motion_videos.sql';
const P_COLS = 'id,title,headline,script,ratio,design_key,design_mime,voice_key,voice_mime,voice_seconds,status,approved_version,approved_by,approved_at,pc_issue,created_by,created_at';
const V_COLS = 'id,project_id,version,parent_version,change_request,spec,engine,model,created_by,created_at';
const rows = <T>(d: unknown): T[] => (Array.isArray(d) ? d : []) as T[];

async function projectOf(cfg: Cfg, co: string, id: unknown): Promise<Project | null> {
  const n = parseInt(String(id), 10);
  if (!(n > 0)) return null;
  const r = await sb<Project[]>(cfg, scoped(`/rest/v1/motion_projects?id=eq.${n}&select=${P_COLS}`, co), { admin: true });
  return rows<Project>(r.data)[0] || null;
}
const versionsOf = async (cfg: Cfg, co: string, id: number) =>
  rows<Version>((await sb<Version[]>(cfg, scoped(`/rest/v1/motion_versions?project_id=eq.${id}&select=${V_COLS}&order=version.asc`, co), { admin: true })).data);

// Warn only (as in social): the compliance hits of every text in the plan
async function warnings(cfg: Cfg, co: string, spec: Spec) {
  const rules = await rulesFor(cfg, co);
  return [...spec.scenes.map(s => s.text), spec.cta?.text || ''].filter(Boolean).flatMap(t => check(t, rules).map(h => ({ text: t, match: h.match, title: h.title, fix: h.fix })));
}

// One model call → a clean plan, or null (the caller decides what a failure means)
async function plan(e: VEnv, cfg: Cfg, co: string, messages: Msg[], seconds: number, ratio: Spec['ratio'], colors: string[]) {
  try {
    const out = await generate(e, 'motion', { messages: withKnowledge(messages, await knowledgeFor(cfg, co, 'design')), max_tokens: 1500 });
    const spec = cleanSpec(parseSpec(out.response), seconds, ratio, colors);
    return spec ? { spec, engine: out.engine, model: out.model } : null;
  } catch (err) { console.warn('motion_plan_failed', (err as Error).message); return null; }
}

export const videos = { GET: handle(async (request, e: VEnv) => {
  const { cfg, user } = await requireUser(request, e, 'design');
  const base = { ready: !!e.OPENAI_API_KEY, canEdit: atLeast(user, 'design', 'edit', cfg), canApprove: atLeast(user, 'design', 'approve', cfg), ratios: RATIOS, anims: ANIMS };
  const id = new URL(request.url).searchParams.get('id');
  if (id) {
    const p = await projectOf(cfg, user.co, id);
    if (!p) return json(404, { error: 'الفيديو مو موجود' });
    const versions = await versionsOf(cfg, user.co, p.id);
    return json(200, { ...base, project: p, versions });
  }
  const r = await sb<Project[]>(cfg, scoped(`/rest/v1/motion_projects?select=${P_COLS}&order=created_at.desc&limit=30`, user.co), { admin: true });
  if (missingSchema(r)) return json(200, { ...base, projects: [], setup: notApplied(MIG) });
  return json(200, { ...base, projects: rows<Project>(r.data) });
}) };

// GET ?p=&kind=design|voice serves a project's file; POST ?kind= stores one (raw body) and returns its key
export const videofile = {
  GET: handle(async (request, e: VEnv) => {
    const { cfg, user } = await requireUser(request, e, 'design');
    const q = new URL(request.url).searchParams, kind = q.get('kind');
    const p = await projectOf(cfg, user.co, q.get('p'));
    const key = kind === 'design' ? p?.design_key : kind === 'voice' ? p?.voice_key : null;
    if (!p || !ownKey(user.co, key) || !e.FILES) return new Response('not found', { status: 404 });
    const obj = await e.FILES.get(key);
    if (!obj) return new Response('not found', { status: 404 });
    return new Response(obj.body, { headers: { 'content-type': kind === 'design' ? p.design_mime : p.voice_mime, 'cache-control': 'private, max-age=3600',
      'content-security-policy': "default-src 'none'; sandbox", 'x-content-type-options': 'nosniff' } });
  }),
  POST: handle(async (request, e: VEnv) => {
    const { user } = await requireUser(request, e, 'design', { write: true });
    if (!e.FILES) return json(503, { error: 'رفع الملفات مو مفعّل في هالبيئة' });
    const kind = new URL(request.url).searchParams.get('kind') || '';
    const type = (request.headers.get('content-type') || '').split(';')[0]!.trim().toLowerCase();
    const pre = checkUpload(kind, type, Number(request.headers.get('content-length') || 1));
    if (pre.error) return json(pre.error.includes('الحد') ? 413 : 415, { error: pre.error });
    const body = await request.arrayBuffer();
    const c = checkUpload(kind, type, body.byteLength);
    if (!c.ext) return json(c.error?.includes('الحد') ? 413 : 400, { error: c.error });
    const key = fileKey(user.co, c.ext);
    await e.FILES.put(key, body, { httpMetadata: { contentType: type } });
    return json(200, { ok: true, key, mime: type });
  }),
};

// A new video: the approved design + voice → project + v1. A Maestro task is opened too when the company is connected.
export const video = { POST: handle(async (request, e: VEnv) => {
  const { cfg, user } = await requireUser(request, e, 'design', { write: true });
  const b = await readJson(request);
  if (!ownKey(user.co, b.design_key) || !ownKey(user.co, b.voice_key)) return json(400, { error: 'ارفع التصميم والصوت أول' });
  const seconds = clampSeconds(b.voice_seconds);
  if (seconds < 3) return json(400, { error: 'الصوت لازم يكون 3 ثواني على الأقل' });
  const ratio = ratioOf(b.ratio);
  const headline = String(b.headline || '').trim().slice(0, 140), script = String(b.script || '').trim().slice(0, 2000);
  if (!headline && !script) return json(400, { error: 'اكتب العنوان أو نص التعليق' });
  const colors = (await brandFor(cfg, user.co)).colors;
  const made = pick(e, 'motion') ? await plan(e, cfg, user.co, specPrompt({ headline, script, seconds, ratio, colors }), seconds, ratio, colors) : null;
  const v1 = made || { spec: templateSpec({ headline, script, seconds, ratio, colors }), engine: 'templates', model: null };
  if (!v1.spec) return json(502, { error: 'ما طلعت خطة للفيديو، جرّب مرة ثانية' });
  const ins = await sb<Project[]>(cfg, '/rest/v1/motion_projects', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' }, body: {
    company_id: user.co, title: String(b.title || headline || 'فيديو').trim().slice(0, 120), headline, script, ratio,
    design_key: b.design_key, design_mime: String(b.design_mime || 'image/png').slice(0, 40), voice_key: b.voice_key, voice_mime: String(b.voice_mime || 'audio/wav').slice(0, 40),
    voice_seconds: seconds, created_by: user.email } });
  if (missingSchema(ins)) return json(503, { error: notApplied(MIG) });
  const p = rows<Project>(ins.data)[0];
  if (!ins.ok || !p) return json(500, { error: 'ما انحفظ الفيديو' });
  const v = await sb<Version[]>(cfg, '/rest/v1/motion_versions', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' },
    body: { company_id: user.co, project_id: p.id, version: 1, spec: v1.spec, engine: v1.engine, model: v1.model, created_by: user.email } });
  if (!v.ok) return json(500, { error: 'ما انحفظت النسخة' });
  // Maestro (Paperclip) gets a task for the video when connected; the video does not depend on it
  const pc = client(e), c = pc ? await companyOf(cfg, user.co) : null;
  if (pc && c?.paperclip_company_id) {
    try {
      const issue = await pc.createIssue(c.paperclip_company_id, { title: `فيديو موشن: ${p.title}`.slice(0, 200), priority: 'medium',
        description: `فيديو موشن من تصميم وصوت معتمدين. المعاينة والنسخ والاعتماد في /design/video/?id=${p.id}\n\n— طلبه ${user.email} من لوحة Well` });
      if (issue.id) await sb(cfg, scoped(`/rest/v1/motion_projects?id=eq.${p.id}`, user.co), { method: 'PATCH', admin: true, body: { pc_issue: String(issue.id) } });
    } catch (err) { console.warn('motion_task_failed', (err as Error).message); }
  }
  await audit(cfg, user, 'motion_create', { target: { project: p.id, engine: v1.engine } });
  return json(200, { ok: true, id: p.id, engine: v1.engine, warnings: await warnings(cfg, user.co, v1.spec) });
}) };

// «تعديل»: the user's words on one version → the next version number. Nothing earlier changes; approval is cleared.
export const videoedit = { POST: handle(async (request, e: VEnv) => {
  const { cfg, user } = await requireUser(request, e, 'design', { write: true });
  const b = await readJson(request);
  const change = String(b.change || '').trim().slice(0, 600);
  if (!change) return json(400, { error: 'اكتب وش تبي تغيّر' });
  if (!pick(e, 'motion') || !e.OPENAI_API_KEY) return json(503, { error: notEnabled(user, 'تعديل الفيديو', 'OPENAI_API_KEY') });
  const p = await projectOf(cfg, user.co, b.id);
  if (!p) return json(404, { error: 'الفيديو مو موجود' });
  const all = await versionsOf(cfg, user.co, p.id);
  const base = all.find(v => v.version === Number(b.from)) || all[all.length - 1];
  if (!base) return json(409, { error: 'ما فيه نسخة نعدّل عليها' });
  const seconds = clampSeconds(p.voice_seconds), ratio = ratioOf(p.ratio);
  const current = cleanSpec(base.spec, seconds, ratio);
  if (!current) return json(409, { error: 'النسخة هذي ما تنقرى' });
  const made = await plan(e, cfg, user.co, editPrompt(current, change), seconds, ratio, (await brandFor(cfg, user.co)).colors);
  if (!made || made.engine !== 'openai') return json(502, { error: 'المخرج ما رجّع نسخة صالحة، جرّب تكتب التعديل بشكل ثاني' });
  const next = (all[all.length - 1]?.version || 0) + 1;
  const v = await sb<Version[]>(cfg, '/rest/v1/motion_versions', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' },
    body: { company_id: user.co, project_id: p.id, version: next, parent_version: base.version, change_request: change, spec: made.spec, engine: made.engine, model: made.model, created_by: user.email } });
  if (v.status === 409) return json(409, { error: 'انضافت نسخة بنفس الوقت، حدّث الصفحة وجرّب' });
  if (!v.ok) return json(500, { error: 'ما انحفظت النسخة' });
  if (p.status === 'approved') await sb(cfg, scoped(`/rest/v1/motion_projects?id=eq.${p.id}`, user.co), { method: 'PATCH', admin: true,
    body: { status: 'draft', approved_version: null, approved_by: null, approved_at: null, updated_at: new Date().toISOString() } });
  await audit(cfg, user, 'motion_edit', { target: { project: p.id, version: next, from: base.version } });
  return json(200, { ok: true, version: next, warnings: await warnings(cfg, user.co, made.spec) });
}) };

// The final version before publishing: approve level on Maestro
export const videoapprove = { POST: handle(async (request, e: VEnv) => {
  const { cfg, user } = await requireUser(request, e, 'design', { write: true, approve: true });
  const b = await readJson(request);
  const p = await projectOf(cfg, user.co, b.id);
  if (!p) return json(404, { error: 'الفيديو مو موجود' });
  const n = Number(b.version);
  if (!(await versionsOf(cfg, user.co, p.id)).some(v => v.version === n)) return json(404, { error: 'النسخة مو موجودة' });
  const r = await sb(cfg, scoped(`/rest/v1/motion_projects?id=eq.${p.id}`, user.co), { method: 'PATCH', admin: true,
    body: { status: 'approved', approved_version: n, approved_by: user.email, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() } });
  if (!r.ok) return json(500, { error: 'ما انحفظ الاعتماد' });
  await audit(cfg, user, 'motion_approve', { target: { project: p.id, version: n } });
  return json(200, { ok: true });
}) };
