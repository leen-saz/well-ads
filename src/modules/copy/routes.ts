// /api/copy/*: the copywriter tab. Projects of the user's company (setup + competitors), each competitor's style
// card counted on read, and writing with the free Workers AI (templates when it is not bound).
import { sb, json, readJson, handle, requireUser, audit, missingSchema, notApplied, type Cfg } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { loadKnowledge, systemPrompt, forbiddenRules, withKnowledge } from '../knowledge/knowledge';
import { generate, pick, type LlmEnv } from '../../lib/llm';
import { winners, type AdIn, type MetIn } from '../design/design';
import { KINDS, DEFAULT_KIND, fitDraft, cleanProject, styleCard, writePrompt, parseDrafts, fallbackDrafts, review, type Project } from './copy';
import { SKILL, partsOf, cleanInputs, missing, skillPrompt, parseVariants, reviewVariant } from './skills';

// The copywriter writes with OpenAI when OPENAI_API_KEY is set, else Workers AI (src/lib/llm.ts); it reads the knowledge too
type AiEnv = LlmEnv;
type Row = Project & { id: number; updated_at?: string };
const rows = (d: unknown): Row[] => (Array.isArray(d) ? (d as Row[]) : []);
const withCards = (p: Row) => ({ ...p, competitors: (p.competitors || []).map(c => ({ ...c, card: styleCard(c.samples || []) })) });

async function one(cfg: Cfg, co: string, id: number): Promise<Row | null> {
  const r = await sb<Row[]>(cfg, scoped(`/rest/v1/copy_projects?id=eq.${id}&select=*`, co), { admin: true });
  return rows(r.data)[0] ?? null;
}

// The style cards of the competitors picked on the page, and our own openings that got the cheapest leads in the
// last 30 days (same reference as the design tab)
async function references(cfg: Cfg, co: string, p: Row, picked: unknown) {
  const use = new Set(Array.isArray(picked) ? picked.map(String) : []);
  const cards = (p.competitors || []).filter(c => use.has(c.id)).flatMap(c => { const card = styleCard(c.samples || []); return card ? [{ name: c.name, card }] : []; });
  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const [ads, metrics] = await Promise.all([
    sb<AdIn[]>(cfg, scoped('/rest/v1/ads?select=ad_key,platform,name,format,goal,text:doc->>text&goal=eq.lead&limit=3000', co), { admin: true }),
    // ad_metrics has no company column: rows only count through this company's ads (winners joins on ad_key)
    sb<MetIn[]>(cfg, `/rest/v1/ad_metrics?select=ad_key,spend,leads,clicks,impressions&day=gte.${since}&limit=20000`, { admin: true }),
  ]);
  return { cards, hooks: winners(Array.isArray(ads.data) ? ads.data : [], Array.isArray(metrics.data) ? metrics.data : []).hooks };
}

export const projects = {
  GET: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'copy');
    const r = await sb<Row[]>(cfg, scoped('/rest/v1/copy_projects?select=*&order=updated_at.desc&limit=50', user.co), { admin: true });
    if (!r.ok) return json(missingSchema(r) ? 503 : 500, { error: missingSchema(r) ? notApplied('migration 015_copy.sql') : 'ما قدرت أقرأ المشاريع' });
    return json(200, { projects: rows(r.data).map(withCards), kinds: KINDS });
  }),
  POST: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'copy', { write: true });
    const p = cleanProject(await readJson(request, 200_000));
    if ('error' in p) return json(400, { error: p.error });
    const r = await sb<Row[]>(cfg, '/rest/v1/copy_projects', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' }, body: { ...p, company_id: user.co, created_by: user.email } });
    if (!r.ok || !rows(r.data).length) return json(missingSchema(r) ? 503 : 500, { error: missingSchema(r) ? notApplied('migration 015_copy.sql') : 'ما انحفظ المشروع' });
    await audit(cfg, user, 'copy_project_created', { target: { id: rows(r.data)[0]!.id, name: p.name } });
    return json(200, { ok: true, project: withCards(rows(r.data)[0]!) });
  }),
  PATCH: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'copy', { write: true });
    const b = await readJson(request, 200_000);
    const id = parseInt(String(b.id), 10);
    const prev = id ? await one(cfg, user.co, id) : null;
    if (!prev) return json(404, { error: 'المشروع مو موجود' });
    const p = cleanProject(b, prev);
    if ('error' in p) return json(400, { error: p.error });
    const r = await sb<Row[]>(cfg, scoped(`/rest/v1/copy_projects?id=eq.${id}`, user.co), { method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' }, body: { ...p, updated_at: new Date().toISOString() } });
    if (!r.ok || !rows(r.data).length) return json(missingSchema(r) ? 503 : 500, { error: missingSchema(r) ? notApplied('migration 015_copy.sql') : 'ما انحفظ المشروع' });
    return json(200, { ok: true, project: withCards(rows(r.data)[0]!) });
  }),
};

export const write = { POST: handle(async (request, e: AiEnv & Parameters<typeof requireUser>[1]) => {
  const { cfg, user } = await requireUser(request, e, 'copy', { write: true });
  const b = await readJson(request);
  const p = await one(cfg, user.co, parseInt(String(b.project_id), 10) || 0);
  if (!p) return json(404, { error: 'اختر مشروع' });
  const kind = String(b.kind) in KINDS ? String(b.kind) : DEFAULT_KIND;
  const count = Math.min(5, Math.max(1, parseInt(String(b.count), 10) || 3));
  const { cards, hooks } = await references(cfg, user.co, p, b.competitors);
  let drafts = fallbackDrafts(p, count, kind), engine = 'templates';
  // One read of the knowledge: what the writer is told, and the company's forbidden words for the compliance notes
  const known = await loadKnowledge(cfg, user.co), extra = forbiddenRules(known);
  if (pick(e, 'copy')) {
    try {
      const out = await generate(e, 'copy', { messages: withKnowledge([{ role: 'user', content: writePrompt(p, kind, count, cards, hooks) }], systemPrompt(known, 'copy')), max_tokens: 900 });
      const got = parseDrafts(out.response, KINDS[kind]!.max);
      if (got.length) { drafts = got.map(d => fitDraft(d, kind)); engine = out.engine === 'workers' ? 'workers-ai' : out.engine; }
    } catch { /* templates stay */ }
  }
  await audit(cfg, user, 'copy_written', { target: { project: p.id, kind, count: drafts.length, engine, competitors: cards.length } });
  return json(200, { drafts: drafts.map(d => review(d, p, extra, kind)), engine, used: { competitors: cards.map(c => c.name), hooks: hooks.slice(0, 5) } });
}) };

// One request type (docs/copywriter-skills/): its inputs, the questions for what is missing, then the variants on its
// steps, with the knowledge as the system message and every variant reviewed. No templates here: without a model it says so.
export const skill = { POST: handle(async (request, e: AiEnv & Parameters<typeof requireUser>[1]) => {
  const { cfg, user } = await requireUser(request, e, 'copy', { write: true });
  const b = await readJson(request, 50_000);
  const k = SKILL[String(b.skill)];
  if (!k) return json(400, { error: 'اختر نوع الطلب' });
  const p = await one(cfg, user.co, parseInt(String(b.project_id), 10) || 0);
  if (!p) return json(404, { error: 'اختر مشروع' });
  const inputs = cleanInputs(k, (b.inputs && typeof b.inputs === 'object' ? b.inputs : {}) as Record<string, unknown>);
  const ask = missing(k, inputs);
  if (ask.length) return json(200, { ask });
  if (!pick(e, 'copy')) return json(503, { error: 'الكاتب يحتاج الذكاء الاصطناعي، وهو مو متصل الحين' });
  const count = Math.min(k.count[1], Math.max(1, parseInt(String(b.count), 10) || k.count[0]));
  const parts = partsOf(k, inputs);
  const [{ cards, hooks }, known] = await Promise.all([references(cfg, user.co, p, b.competitors), loadKnowledge(cfg, user.co)]);
  let variants: ReturnType<typeof parseVariants> = [], engine = '';
  try {
    const out = await generate(e, 'copy', { messages: withKnowledge([{ role: 'user', content: skillPrompt(k, inputs, p, count, cards, hooks) }], systemPrompt(known, 'copy')), max_tokens: k.tokens });
    variants = parseVariants(out.response, parts, count);
    engine = out.engine === 'workers' ? 'workers-ai' : out.engine;
  } catch { /* said below */ }
  if (!variants.length) return json(502, { error: 'ما طلع جواب أقدر أقراه، جرّب مرة ثانية' });
  await audit(cfg, user, 'copy_skill_written', { target: { project: p.id, skill: k.key, count: variants.length, engine, competitors: cards.length } });
  const extra = forbiddenRules(known);
  return json(200, { variants: variants.map(v => reviewVariant(v, parts, p, extra)), parts, engine, used: { competitors: cards.map(c => c.name), hooks: hooks.slice(0, 5), knowledge: known.length > 0 } });
}) };
