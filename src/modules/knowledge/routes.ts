// /api/knowledge/*: the company's knowledge for the AI modules. Reading needs view; adding and editing need edit;
// switching an entry on or off needs approve. An entry added or edited without approve waits off until an approver turns it on.
import { sb, json, readJson, handle, requireUser, audit, atLeast, NO_APPROVE, type AuthEnv, type Cfg } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { AI_MODULES, KINDS, clean, loadKnowledge, normalize, systemPrompt, type Entry } from './knowledge';
import { QUESTIONS, answerRow, followUp, nextQuestion } from './training';
import { check, type Hit } from '../compliance/compliance';
import { BRAND_KINDS, brandKey, checkFile, cleanColors, serveFile, type Asset } from './brand';
import { VISION_MODEL, VISION_PROMPT } from '../design/design';
import { guidePrompt, guideText, parseProposals, type ToMarkdown } from './guide';
import { aiFor, generate, pick as pickModel, type LlmEnv } from '../../lib/llm';
import { usageCtx } from '../../lib/usage';
import { declaredLength, readCapped } from '../../lib/upload';

type AiEnv = AuthEnv & LlmEnv;
const rows = (d: unknown): Entry[] => (Array.isArray(d) ? (d as Entry[]) : []);
// Claims, references and winning ads the AI will learn from: checked like any ad copy, as a notice (forbidden words are not ad copy)
const comply = (row: Pick<Entry, 'kind' | 'body'>): Hit[] => (row.kind === 'forbidden' ? [] : check(row.body));
const all = (cfg: Cfg, co: string) => sb<Entry[]>(cfg, scoped('/rest/v1/knowledge?select=*&order=active.desc,kind.asc,updated_at.desc&limit=500', co), { admin: true });

export const list = { GET: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'knowledge');
  const r = await all(cfg, user.co);
  if (!r.ok) return json(500, { error: 'ما قدرت أقرأ المعرفة' });
  return json(200, { entries: rows(r.data).map(normalize), kinds: KINDS, modules: AI_MODULES, canEdit: atLeast(user, 'knowledge', 'edit', cfg), canApprove: atLeast(user, 'knowledge', 'approve', cfg) });
}) };

// What one module's AI receives, exactly
export const preview = { GET: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'knowledge');
  const module = new URL(request.url).searchParams.get('module') || 'content';
  if (!(AI_MODULES as readonly string[]).includes(module)) return json(400, { error: 'موديول غير معروف' });
  return json(200, { module, system: systemPrompt(await loadKnowledge(cfg, user.co), module) });
}) };

export const entry = {
  POST: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'knowledge', { write: true });
    const c = clean(await readJson(request));
    if (!c.row) return json(400, { error: c.error });
    const active = atLeast(user, 'knowledge', 'approve', cfg);
    const r = await sb<Entry[]>(cfg, '/rest/v1/knowledge', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' },
      body: { ...c.row, company_id: user.co, active, created_by: user.email, updated_by: user.email } });
    if (!r.ok) return json(500, { error: 'ما انحفظ' });
    const row = rows(r.data)[0];
    await audit(cfg, user, 'knowledge_add', { target: { id: row?.id, kind: c.row.kind, active } });
    return json(200, { ok: true, entry: row, pending: !active, compliance: comply(c.row) });
  }),
  PATCH: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'knowledge', { write: true });
    const body = await readJson(request);
    const id = parseInt(String(body.id), 10);
    if (!id) return json(400, { error: 'طلب غير صحيح' });
    const approver = atLeast(user, 'knowledge', 'approve', cfg);
    let patch: Record<string, unknown>, act: string;
    if (typeof body.active === 'boolean' && body.kind === undefined) {
      if (!approver) return json(403, { error: NO_APPROVE });
      patch = { active: body.active }; act = body.active ? 'knowledge_on' : 'knowledge_off';
    } else {
      const c = clean(body);
      if (!c.row) return json(400, { error: c.error });
      // An edit by someone who cannot approve goes back to waiting
      patch = approver ? c.row : { ...c.row, active: false }; act = 'knowledge_edit';
    }
    const r = await sb<Entry[]>(cfg, scoped(`/rest/v1/knowledge?id=eq.${id}`, user.co), { method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' },
      body: { ...patch, updated_by: user.email, updated_at: new Date().toISOString() } });
    if (!r.ok) return json(500, { error: 'ما انحفظ' });
    const row = rows(r.data)[0];
    if (!row) return json(404, { error: 'غير موجود' });
    await audit(cfg, user, act, { target: { id, kind: row.kind, active: row.active } });
    return json(200, { ok: true, entry: row, compliance: act === 'knowledge_edit' ? comply(row) : [] });
  }),
};

// Training chat. GET: the answers so far and the next question (fixed ones first, then the AI's, until it says done).
// skip = topics the trainer passed on this visit. POST: one answer saved as a knowledge entry (same approval rule as entry).
export const train = {
  GET: handle(async (request, e: AiEnv) => {
    const { cfg, user } = await requireUser(request, e, 'knowledge');
    const r = await all(cfg, user.co);
    if (!r.ok) return json(500, { error: 'ما قدرت أقرأ المعرفة' });
    const entries = rows(r.data).map(normalize);
    const skip = (new URL(request.url).searchParams.get('skip') || '').split(',').filter(Boolean).slice(0, 50);
    const history = entries.filter(x => x.source === 'training').sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .map(x => ({ id: x.id, question: x.question, answer: x.body, active: x.active, topic: x.topic }));
    let next = nextQuestion(entries, skip), later = false;
    // The AI asks only for someone who can answer, and only after the fixed questions. That call takes several seconds, so the page
    // first asks with ai=0: the answers so far come back at once with later=true, and a second request (without ai=0) brings the question.
    if (!next && atLeast(user, 'knowledge', 'edit', cfg)) {
      if (new URL(request.url).searchParams.get('ai') === '0') later = true;
      else next = await followUp(aiFor(e, 'content', usageCtx(cfg, user, 'knowledge')), entries.filter(x => x.active), history.map(h => String(h.question || '')));
    }
    const covered = QUESTIONS.filter(q => entries.some(x => x.topic === q.topic)).length;
    return json(200, { history, next, later, covered, total: QUESTIONS.length, canEdit: atLeast(user, 'knowledge', 'edit', cfg) });
  }),
  POST: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'knowledge', { write: true });
    const a = answerRow(await readJson(request));
    if (!a.row) return json(400, { error: a.error });
    const active = atLeast(user, 'knowledge', 'approve', cfg);
    const r = await sb<Entry[]>(cfg, '/rest/v1/knowledge', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' },
      body: { ...a.row, company_id: user.co, active, created_by: user.email, updated_by: user.email } });
    if (!r.ok) return json(500, { error: 'ما انحفظ' });
    const row = rows(r.data)[0];
    await audit(cfg, user, 'knowledge_train', { target: { id: row?.id, topic: a.row.topic, active } });
    return json(200, { ok: true, entry: row, pending: !active, compliance: comply(a.row) });
  }),
};

// ---- الهوية والبصريات (brand files). Same rule as the entries: edit uploads, approve switches on/off; no delete.
type BrandEnv = AuthEnv & { FILES?: R2Bucket; AI?: { run: (model: string, input: Record<string, unknown>) => Promise<unknown> } };
const assets = (d: unknown): Asset[] => (Array.isArray(d) ? (d as Asset[]) : []);

export const brand = {
  GET: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'knowledge');
    const r = await sb<Asset[]>(cfg, scoped('/rest/v1/brand_assets?select=*&order=active.desc,kind.asc,updated_at.desc&limit=200', user.co), { admin: true });
    if (!r.ok) return json(500, { error: 'ما قدرت أقرأ ملفات الهوية' });
    return json(200, { assets: r.data, kinds: Object.fromEntries(Object.entries(BRAND_KINDS).map(([k, v]) => [k, { ar: v.ar, types: Object.keys(v.types), max: v.max }])),
      canEdit: atLeast(user, 'knowledge', 'edit', cfg), canApprove: atLeast(user, 'knowledge', 'approve', cfg) });
  }),
  // { id, active } switches (approve); { id, title } renames (edit, back to waiting without approve)
  PATCH: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'knowledge', { write: true });
    const b = await readJson(request);
    const id = parseInt(String(b.id), 10);
    if (!id) return json(400, { error: 'طلب غير صحيح' });
    const approver = atLeast(user, 'knowledge', 'approve', cfg);
    let patch: Record<string, unknown>;
    if (typeof b.active === 'boolean') {
      if (!approver) return json(403, { error: NO_APPROVE });
      patch = { active: b.active };
    } else if (typeof b.value === 'string') {
      const colors = cleanColors(b.value);
      if (!colors.length) return json(400, { error: 'اكتب الألوان بصيغة hex مثل #1D1069' });
      patch = { value: colors.join(' '), ...(approver ? {} : { active: false }) };
    } else {
      // A rename needs a name: an empty or missing title is a bad request, not a wiped title (and a file switched off)
      const title = typeof b.title === 'string' ? b.title.trim().slice(0, 120) : '';
      if (!title) return json(400, { error: 'اكتب الاسم' });
      patch = { title, ...(approver ? {} : { active: false }) };
    }
    // The colour codes belong to the colours entry only (a guide's value is its reading lock, see brandguide)
    const only = 'value' in patch ? '&kind=eq.colors' : '';
    const r = await sb<Asset[]>(cfg, scoped(`/rest/v1/brand_assets?id=eq.${id}${only}`, user.co), { method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' },
      body: { ...patch, updated_by: user.email, updated_at: new Date().toISOString() } });
    const row = r.ok ? assets(r.data)[0] : undefined;
    if (!row) return json(r.ok ? 404 : 500, { error: r.ok ? 'غير موجود' : 'ما انحفظ' });
    await audit(cfg, user, 'brand_edit', { target: { id, kind: row.kind, active: row.active } });
    return json(200, { ok: true, asset: row });
  }),
};

// Brand colours: typed hex codes, no file
export const brandcolors = { POST: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'knowledge', { write: true });
  const colors = cleanColors((await readJson(request)).colors);
  if (!colors.length) return json(400, { error: 'اكتب الألوان بصيغة hex مثل #1D1069' });
  const active = atLeast(user, 'knowledge', 'approve', cfg);
  const r = await sb<Asset[]>(cfg, '/rest/v1/brand_assets', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' },
    body: { company_id: user.co, kind: 'colors', title: 'ألوان العلامة', value: colors.join(' '), active, created_by: user.email, updated_by: user.email } });
  if (!r.ok) return json(500, { error: 'ما انحفظ' });
  const row = assets(r.data)[0];
  await audit(cfg, user, 'brand_add', { target: { id: row?.id, kind: 'colors', active } });
  return json(200, { ok: true, asset: row, pending: !active });
}) };

// GET ?id= serves a file (any of this company's, for the knowledge tab). POST ?kind=&title= stores one: the body is the raw
// file and its type is the content-type (as in social upload). Reference images get a one-line description once, here.
export const brandfile = {
  GET: handle(async (request, e: BrandEnv) => {
    const { cfg, user } = await requireUser(request, e, 'knowledge');
    return serveFile(cfg, user.co, parseInt(new URL(request.url).searchParams.get('id') || '', 10) || 0, e.FILES, false);
  }),
  POST: handle(async (request, e: BrandEnv) => {
    const { cfg, user } = await requireUser(request, e, 'knowledge', { write: true });
    if (!e.FILES) return json(503, { error: 'رفع الملفات مو مفعّل في هالبيئة' });
    const q = new URL(request.url).searchParams, kind = q.get('kind') || '';
    const type = (request.headers.get('content-type') || '').split(';')[0]!.trim().toLowerCase();
    const len = declaredLength(request);
    if (len === null) return json(411, { error: 'حجم الملف غير معروف. جرّب مرة ثانية.' });
    const pre = checkFile(kind, type, len);
    if (pre.error) return json(pre.error.includes('الحد') ? 413 : 415, { error: pre.error });
    const body = await readCapped(request, len);
    if (!body) return json(413, { error: 'الملف أكبر من الحجم المعلن' });
    const c = checkFile(kind, type, body.byteLength);
    if (!c.ext) return json(c.error?.includes('الحد') ? 413 : 400, { error: c.error });
    const key = brandKey(user.co, c.ext);
    await e.FILES.put(key, body, { httpMetadata: { contentType: type } });
    let description: string | null = null;
    if (kind === 'reference' && e.AI && body.byteLength <= 400_000) {
      try {
        const o = await e.AI.run(VISION_MODEL, { image: [...new Uint8Array(body)], prompt: VISION_PROMPT, max_tokens: 90 }) as { description?: unknown; response?: unknown };
        description = String(o?.description ?? o?.response ?? '').trim().slice(0, 300) || null;
      } catch { /* the description is optional */ }
    }
    const active = atLeast(user, 'knowledge', 'approve', cfg);
    const r = await sb<Asset[]>(cfg, '/rest/v1/brand_assets', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' },
      body: { company_id: user.co, kind, title: String(q.get('title') || '').trim().slice(0, 120), r2_key: key, mime: type, size: body.byteLength,
        description, active, created_by: user.email, updated_by: user.email } });
    if (!r.ok) { await e.FILES.delete(key).catch(() => {}); return json(500, { error: 'ما انحفظ' }); }
    const row = assets(r.data)[0];
    await audit(cfg, user, 'brand_add', { target: { id: row?.id, kind, size: body.byteLength, active } });
    return json(200, { ok: true, asset: row, pending: !active });
  }),
};

// Brand guide (PDF) → proposed knowledge entries, all saved switched off (source brand_file) for a manager to review.
// A guide is read once (topic guide-<id>); its text never leaves our Worker except to the content model.
export const brandguide = { POST: handle(async (request, e: BrandEnv & LlmEnv & { AI?: { toMarkdown?: ToMarkdown } }) => {
  const { cfg, user } = await requireUser(request, e, 'knowledge', { write: true });
  const id = parseInt(String((await readJson(request)).id), 10);
  if (!id) return json(400, { error: 'طلب غير صحيح' });
  if (!e.FILES || !e.AI?.toMarkdown) return json(503, { error: 'قراءة الملفات مو مفعّلة في هالبيئة' });
  if (!pickModel(e, 'content')) return json(503, { error: 'الذكاء الاصطناعي مو مفعّل في هالبيئة' });
  const g = await sb<Asset[]>(cfg, scoped(`/rest/v1/brand_assets?id=eq.${id}&kind=eq.guide&select=id,r2_key`, user.co), { admin: true });
  const a = g.ok ? assets(g.data)[0] : undefined;
  if (!a?.r2_key || !a.r2_key.startsWith(`brand/${user.co}/`)) return json(404, { error: 'دليل غير معروف' });
  const topic = `guide-${id}`;
  const done = await sb<Entry[]>(cfg, scoped(`/rest/v1/knowledge?topic=eq.${topic}&select=id&limit=1`, user.co), { admin: true });
  if (done.ok && rows(done.data).length) return json(409, { error: 'هالدليل انقرا قبل. بنوده في «كل المعرفة».' });
  // Claimed on the guide's own row, in one conditional update (its value column is free: only colours use it), so two
  // clicks or two managers never read it twice. Released when the reading fails; kept as 'read' when it is done.
  // A 'reading' older than 10 minutes is a request that died midway, and may be claimed again.
  const lock = (value: string | null, when = '') => sb<Asset[]>(cfg, scoped(`/rest/v1/brand_assets?id=eq.${id}&kind=eq.guide${when}`, user.co),
    { method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' }, body: { value, updated_at: new Date().toISOString() } });
  const stale = new Date(Date.now() - 10 * 60_000).toISOString();
  const claim = await lock('reading', `&or=(value.is.null,and(value.eq.reading,updated_at.lt.${stale}))`);
  if (!claim.ok || !assets(claim.data).length) return json(409, { error: 'الدليل ينقرا الحين أو انقرا قبل. شوف بنوده في «كل المعرفة» بعد دقيقة.' });
  const fail = async (status: number, error: string) => { await lock(null); return json(status, { error }); };
  const obj = await e.FILES.get(a.r2_key);
  if (!obj) return fail(404, 'الملف مو موجود');
  const t = await guideText(d => e.AI!.toMarkdown!(d), await obj.arrayBuffer());
  if (!t.text) return fail(422, t.error || 'ما قدرت أقرا الـ PDF');
  let raw: string;
  try { raw = (await generate(e, 'content', { messages: [{ role: 'user', content: guidePrompt(t.text) }], max_tokens: 3000 }, fetch, usageCtx(cfg, user, 'knowledge'))).response; }
  catch { return fail(503, 'الذكاء الاصطناعي ما رد الحين، جرّب بعد دقيقة'); }
  const list = parseProposals(raw);
  if (!list.length) return fail(422, 'ما طلعت بنود واضحة من الدليل، جرّب مرة ثانية');
  const r = await sb<Entry[]>(cfg, '/rest/v1/knowledge', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' },
    body: list.map(x => ({ ...x, price: null, modules: [], company_id: user.co, active: false, source: 'brand_file', topic, question: 'من دليل العلامة', created_by: user.email, updated_by: user.email })) });
  if (!r.ok) return fail(500, 'ما انحفظت البنود');
  await lock('read');
  await audit(cfg, user, 'knowledge_from_guide', { target: { guide: id, entries: list.length } });
  return json(200, { ok: true, added: rows(r.data).length });
}) };
