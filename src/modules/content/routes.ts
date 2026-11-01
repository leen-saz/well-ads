// /api/content/*: the content + SEO/AEO agent of the user's company. Analyze -> plan -> approve each item -> draft -> publish.
import { sb, json, readJson, handle, requireUser, audit, type AuthEnv } from '../../lib/auth';
import { scoped, WELL_COMPANY } from '../../lib/tenant';
import { AI_MODEL, PUBLISH, crawl, normalizeSite, plan, searchConsole, type AiRun, type Item } from './content';

type Row = Record<string, unknown>;
type AiEnv = AuthEnv & { AI?: { run: AiRun } };
const rows = (d: unknown): Row[] => (Array.isArray(d) ? (d as Row[]) : []);
const aiOf = (e: AiEnv): AiRun | undefined => (e.AI ? (m, i) => e.AI!.run(m, i) : undefined);

export const plans = { GET: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'content');
  const r = await sb(cfg, scoped('/rest/v1/content_plans?select=*&order=created_at.desc&limit=20', user.co), { admin: true });
  return r.ok ? json(200, { plans: r.data, publish: PUBLISH }) : json(500, { error: 'ما قدرت أقرأ البلانات' });
}) };

export const analyze = { POST: handle(async (request, e: AiEnv) => {
  const { cfg, user } = await requireUser(request, e, 'content', { write: true });
  const body = await readJson(request);
  const site = normalizeSite(body.site);
  if (!site) return json(400, { error: 'اكتب رابط الموقع (https)' });
  const niche = String(body.niche || '').trim().slice(0, 200);
  const competitors = (Array.isArray(body.competitors) ? body.competitors : String(body.competitors || '').split(/[\n،,]+/))
    .map(x => String(x).trim()).filter(Boolean).slice(0, 10);
  const pages = await crawl(site);
  // Google tokens: the vault holds Well's today; per-company vault names come with ADR-0006's next step
  const v = user.co === WELL_COMPANY ? await sb<{ name: string; value: string }[]>(cfg, '/rest/v1/rpc/connector_env', { method: 'POST', admin: true, body: {} }) : null;
  const t = Object.fromEntries((v?.ok && Array.isArray(v.data) ? v.data : []).map(x => [x.name, x.value]));
  const gsc = await searchConsole(site, t).catch(() => []);
  const p = await plan(aiOf(e), site, niche, competitors, pages, gsc);
  const r = await sb<Row[]>(cfg, '/rest/v1/content_plans', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' },
    body: { company_id: user.co, site, niche, competitors, analysis: { ...p.analysis, gsc: gsc.slice(0, 20), pages }, items: p.items, engine: p.engine, created_by: user.email } });
  if (!r.ok) return json(500, { error: 'ما انحفظ البلان' });
  await audit(cfg, user, 'content_plan', { target: { site, items: p.items.length, engine: p.engine } });
  return json(200, { ok: true, plan: rows(r.data)[0] });
}) };

// approve / reject / done, or write a draft for an approved item
export const item = { PATCH: handle(async (request, e: AiEnv) => {
  const { cfg, user } = await requireUser(request, e, 'content', { write: true });
  const body = await readJson(request);
  const id = parseInt(String(body.plan), 10), itemId = String(body.item || ''), act = String(body.action || '');
  if (!id || !itemId || !['approve', 'reject', 'done', 'draft'].includes(act)) return json(400, { error: 'طلب غير صحيح' });
  const got = await sb<Row[]>(cfg, scoped(`/rest/v1/content_plans?id=eq.${id}&select=*`, user.co), { admin: true });
  const p = got.ok ? rows(got.data)[0] : undefined;
  if (!p) return json(404, { error: 'بلان غير معروف' });
  const items = (p.items as Item[]).map(x => ({ ...x }));
  const it = items.find(x => x.id === itemId);
  if (!it) return json(404, { error: 'بند غير معروف' });
  if (act === 'draft') {
    if (it.status !== 'approved') return json(409, { error: 'وافق على البند أول' });
    const ai = aiOf(e);
    if (!ai) return json(503, { error: 'الكتابة بالذكاء الاصطناعي غير مفعّلة في هالبيئة' });
    const out = await ai(AI_MODEL, { max_tokens: 2500, messages: [{ role: 'user', content:
      `اكتب ${it.kind === 'faq' ? 'أسئلة وأجوبة شائعة (8 أسئلة)' : it.kind === 'page' ? 'نص صفحة خدمة' : 'مقال'} بالعربي السعودي الواضح لموقع ${p.site} بعنوان: "${it.title}". السبب: ${it.why}.
النبرة مثل: ${(p.competitors as string[]).join('، ') || 'ودودة ومهنية'}. بدون ادعاءات طبية مضمونة (وزارة الصحة). استخدم عناوين فرعية، واختم بدعوة للحجز. Markdown فقط.` }] });
    it.draft = String((out as { response?: unknown })?.response ?? '').slice(0, 20000);
  } else it.status = act === 'approve' ? 'approved' : act === 'reject' ? 'rejected' : 'done';
  const r = await sb(cfg, scoped(`/rest/v1/content_plans?id=eq.${id}`, user.co), { method: 'PATCH', admin: true, body: { items } });
  if (!r.ok) return json(500, { error: 'ما انحفظ' });
  await audit(cfg, user, `content_${act}`, { target: { plan: id, item: itemId, title: it.title } });
  return json(200, { ok: true, item: it });
}) };
