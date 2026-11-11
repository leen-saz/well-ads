// /api/vision/*: describe an uploaded image in Arabic. Reading needs view on the tab, describing and saving need edit.
// The browser shrinks and re-encodes the image (which also drops its location data) and sends it as base64 with its
// SHA-256; the image is passed to the analysis and never stored. The same image is not analysed twice in a company.
import { sb, json, readJson, handle, requireUser, audit, missingSchema, notApplied, type AuthEnv } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { overCap, usageCtx } from '../../lib/usage';
import { complianceOf } from '../../lib/library';
import { GeminiError, WHY, gemini, geminiReady, notReady } from '../../lib/llm';
import { check } from '../compliance/compliance';
import { rulesFor } from '../knowledge/knowledge';
import { MAX_DATA, PROMPT, SYSTEM, TYPES, cleanUpload, libraryDoc, parseResult, sayings, view, type Row } from './vision';

const MIGRATION = 'migration 025_vision.sql';
type Env = AuthEnv & { GEMINI_API_KEY?: string; GEMINI_MODEL?: string };
const rows = (d: unknown): Row[] => (Array.isArray(d) ? (d as Row[]) : []);
const COLS = 'id,company_id,title,file_hash,mime,result,compliance_result,library_id,created_by,created_by_id,created_at';
const fail = (user: { role: string }, r: { status: number; data: unknown; ok: boolean }, say: string) => json(missingSchema(r) ? 503 : 500, { error: missingSchema(r) ? notApplied(user, MIGRATION) : say });

export const recent = { GET: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'vision');
  const r = await sb<Row[]>(cfg, scoped(`/rest/v1/vision_analyses?select=${COLS}&order=created_at.desc&limit=30`, user.co), { admin: true });
  if (!r.ok) return fail(user, r, 'ما قدرت أقرأ الصور');
  const ready = geminiReady(e);
  return json(200, { items: rows(r.data).map(view), ready, why: ready ? '' : notReady(user), types: TYPES });
}) };

export const describe = { POST: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'vision', { write: true });
  if (!geminiReady(e)) return json(503, { error: notReady(user) });
  const c = cleanUpload(await readJson(request, MAX_DATA + 5000));
  if ('error' in c) return json(400, { error: c.error });
  const ctx = usageCtx(cfg, user, 'vision');
  // The same image again: the stored answer, no new call and no new cost
  const had = await sb<Row[]>(cfg, scoped(`/rest/v1/vision_analyses?file_hash=eq.${c.hash}&select=${COLS}&limit=1`, user.co), { admin: true });
  if (!had.ok) return fail(user, had, 'ما قدرت أبدأ');
  if (rows(had.data)[0]) return json(200, { item: view(rows(had.data)[0]!), cached: true });
  if (ctx && await overCap(ctx, 'vision')) return json(429, { error: WHY.capped });
  let result;
  try {
    const out = await gemini(e, 'vision', { system: SYSTEM, parts: [{ inline: { mime: c.mime, data: c.data } }, { text: PROMPT }], max_tokens: 2000, json: true, temperature: 0.1 }, fetch, ctx);
    result = parseResult(out.text);
  } catch (err) {
    const code = err instanceof GeminiError ? err.code : 'failed';
    return json(code === 'rate_limited' ? 429 : code === 'no_key' ? 503 : 502, { error: WHY[code] });
  }
  if (!result) return json(502, { error: 'ما قدرنا نقرا الصورة، جرّب صورة أوضح' });
  const hits = check(sayings(result), await rulesFor(cfg, user.co));
  const ins = await sb<Row[]>(cfg, '/rest/v1/vision_analyses', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' }, body: {
    company_id: user.co, created_by: user.email, created_by_id: user.uid, title: c.title, file_hash: c.hash, mime: c.mime, result, compliance_result: complianceOf(hits) } });
  const made = rows(ins.data)[0];
  if (!ins.ok || !made) return fail(user, ins, 'ما انحفظ الناتج');
  await audit(cfg, user, 'vision_described', { target: { id: made.id } });
  return json(200, { item: view(made), cached: false });
}) };

// Saves an analysis to the shared library as a draft (the compliance result goes with it)
export const save = { POST: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'vision', { write: true });
  const id = parseInt(String((await readJson(request, 2000)).id), 10);
  const got = id > 0 ? await sb<Row[]>(cfg, scoped(`/rest/v1/vision_analyses?id=eq.${id}&select=${COLS}`, user.co), { admin: true }) : null;
  const row = got ? rows(got.data)[0] : undefined;
  if (!row) return json(404, { error: 'الصورة مو موجودة' });
  if (row.library_id) return json(200, { ok: true, library_id: row.library_id });
  const content = libraryDoc(row.title, row.result);
  const lib = await sb<{ id: number }[]>(cfg, '/rest/v1/library_items', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' }, body: {
    company_id: user.co, module: 'vision', kind: 'design', title: `${row.title} · وصف`.slice(0, 120), content, platform: '', service: '',
    compliance_result: complianceOf(check(content, await rulesFor(cfg, user.co))), created_by: user.email, created_by_id: user.uid } });
  const libId = Array.isArray(lib.data) ? lib.data[0]?.id : undefined;
  if (!lib.ok || !libId) return fail(user, lib, 'ما انحفظ في المكتبة');
  await sb(cfg, scoped(`/rest/v1/vision_analyses?id=eq.${row.id}`, user.co), { method: 'PATCH', admin: true, headers: { Prefer: 'return=minimal' }, body: { library_id: libId } });
  await audit(cfg, user, 'vision_saved', { target: { id: row.id, library: libId } });
  return json(200, { ok: true, library_id: libId });
}) };
