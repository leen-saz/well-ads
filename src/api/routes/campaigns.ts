// /api/campaigns/*: «حملة جديدة» in احلم (src/lib/campaign.ts, docs/ahlam.md). The user's wishes become a brief and a plan of tasks for
// the in-app agents, saved in campaigns / campaign_tasks (migration 030). Any signed-in user may write wishes and get a plan; seeing a
// campaign needs being its author or an approver; starting it needs an approver (owner, or approve on the manager tab). Nothing here
// touches an ad account.
import { sb, json, readJson, handle, requireUser, audit, missingSchema, notApplied, NO_APPROVE, type AuthEnv, type Session } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { generate, llmMessage, pick, type LlmEnv, type Provider } from '../../lib/llm';
import { overCap, usageCtx } from '../../lib/usage';
import { TASK, PLAN_SCHEMA, PLANS_PER_DAY, AGENTS, cleanWishes, estimate, mayApprove, parsePlan, planMessages } from '../../lib/campaign';
import { dayStart } from '../../lib/ahlam';

type Env = AuthEnv & LlmEnv;
const MIGRATION = 'migration 030_campaigns.sql';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Row = Record<string, unknown>;
const rows = (d: unknown): Row[] => (Array.isArray(d) ? (d as Row[]) : []);
const idOf = (v: unknown): string | null => (typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : null);
const fail = (user: Session, r: { ok: boolean; status: number; data: unknown }, msg: string) =>
  json(missingSchema(r as never) ? 503 : 500, { error: missingSchema(r as never) ? notApplied(user, MIGRATION) : msg });

// The user's own campaigns; approvers and the owner see all of the company's
const visible = (user: Session, cfg: Parameters<typeof mayApprove>[1]) => (mayApprove(user, cfg) ? '' : `&created_by=eq.${encodeURIComponent(user.email)}`);

export const list = { GET: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'any');
  const r = await sb(cfg, scoped(`/rest/v1/campaigns?select=id,title,status,estimate_usd,created_by,created_at&order=created_at.desc&limit=50${visible(user, cfg)}`, user.co), { admin: true });
  if (!r.ok) return fail(user, r, 'ما قدرت أقرأ الحملات');
  return json(200, { campaigns: rows(r.data), mayApprove: mayApprove(user, cfg) });
}) };

export const get = { GET: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'any');
  const id = idOf(new URL(request.url).searchParams.get('id'));
  if (!id) return json(400, { error: 'طلب غير صحيح' });
  const c = await sb(cfg, scoped(`/rest/v1/campaigns?select=*&id=eq.${id}${visible(user, cfg)}`, user.co), { admin: true });
  if (!c.ok) return fail(user, c, 'ما قدرت أقرأ الحملة');
  const campaign = rows(c.data)[0];
  if (!campaign) return json(404, { error: 'الحملة غير موجودة' });
  const t = await sb(cfg, scoped(`/rest/v1/campaign_tasks?select=id,position,agent,title,spec,depends_on,status,blocked_reason,estimate_usd&campaign_id=eq.${id}&order=position.asc`, user.co), { admin: true });
  return json(200, { campaign, tasks: rows(t.data), agents: AGENTS, mayApprove: mayApprove(user, cfg), capped: await overCap(usageCtx(cfg, user, TASK)!, TASK) });
}) };

// The wishes -> a plan. One model call, saved as `planned`: the user reads the plan and its cost before anything runs.
export const create = { POST: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'any', { write: true });
  const w = cleanWishes(await readJson(request, 20_000));
  if (!w.wishes) return json(400, { error: w.error });
  const model = pick(e, TASK);
  if (!model) return json(503, { error: 'احلم يحتاج الذكاء الاصطناعي، وهو غير متصل الحين' });
  const today = await sb<unknown[]>(cfg, `/rest/v1/audit_log?select=id&action=eq.campaign_create&user_id=eq.${encodeURIComponent(user.uid)}&at=gte.${encodeURIComponent(dayStart(Date.now()))}&limit=${PLANS_PER_DAY}`, { admin: true });
  if (today.ok && Array.isArray(today.data) && today.data.length >= PLANS_PER_DAY) return json(429, { error: `وصلت حدّك اليوم (${PLANS_PER_DAY} خطط حملات). جرّب بكرة.` });
  let plan, used_model = model.model, used_provider: Provider = model.provider;
  try {
    const out = await generate(e, TASK, { messages: planMessages(w.wishes), max_tokens: 3000, response_format: { type: 'json_schema', json_schema: PLAN_SCHEMA } }, fetch, usageCtx(cfg, user, TASK));
    plan = parsePlan(out.response); used_model = out.model; used_provider = out.engine;
  } catch (err) { return json(502, { error: llmMessage(err) }); }
  if (!plan) return json(502, { error: 'ما طلعت خطة أقدر أقراها، جرّب مرة ثانية أو وضّح الأمنيات أكثر' });
  const est = estimate(plan.tasks.map(t => t.agent), used_model, used_provider);
  const made = await sb<Row[]>(cfg, '/rest/v1/campaigns', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' },
    body: { company_id: user.co, title: plan.title, wishes: w.wishes, brief: plan.brief, status: 'planned', estimate_usd: est.usd, created_by: user.email } });
  const id = made.ok ? idOf(rows(made.data)[0]?.['id']) : null;
  if (!id) return fail(user, made, 'ما انحفظت الحملة');
  const tasks = await sb(cfg, '/rest/v1/campaign_tasks', { method: 'POST', admin: true, headers: { Prefer: 'return=minimal' },
    body: plan.tasks.map((t, i) => ({ campaign_id: id, company_id: user.co, position: i, agent: t.agent, title: t.title, spec: { detail: t.detail }, depends_on: t.after, estimate_usd: est.perTask[i] })) });
  if (!tasks.ok) { await sb(cfg, scoped(`/rest/v1/campaigns?id=eq.${id}`, user.co), { method: 'DELETE', admin: true }); return fail(user, tasks, 'ما انحفظت مهام الحملة'); }
  await audit(cfg, user, 'campaign_create', { target: { id, tasks: plan.tasks.length, estimate_usd: est.usd } });   // never the wishes' text
  return json(200, { id, rough: est.rough });
}) };

// Starting a campaign spends the AI budget: only an approver. planned -> approved, once.
export const approve = { POST: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'any', { write: true });
  if (!mayApprove(user, cfg)) return json(403, { error: NO_APPROVE });
  const id = idOf((await readJson(request, 2000))['id']);
  if (!id) return json(400, { error: 'طلب غير صحيح' });
  const r = await sb<Row[]>(cfg, scoped(`/rest/v1/campaigns?id=eq.${id}&status=eq.planned`, user.co), { method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' },
    body: { status: 'approved', approved_by: user.email, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() } });
  if (!r.ok) return fail(user, r, 'ما انحفظ الاعتماد');
  if (!rows(r.data).length) return json(409, { error: 'الحملة مو بانتظار الاعتماد' });
  await audit(cfg, user, 'campaign_approve', { target: { id } });
  return json(200, { ok: true });
}) };

export const cancel = { POST: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'any', { write: true });
  const id = idOf((await readJson(request, 2000))['id']);
  if (!id) return json(400, { error: 'طلب غير صحيح' });
  const r = await sb<Row[]>(cfg, scoped(`/rest/v1/campaigns?id=eq.${id}&status=in.(planned,approved,running,review)${visible(user, cfg)}`, user.co), { method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' },
    body: { status: 'cancelled', updated_at: new Date().toISOString() } });
  if (!r.ok) return fail(user, r, 'ما انلغت الحملة');
  if (!rows(r.data).length) return json(404, { error: 'الحملة غير موجودة أو انتهت' });
  await audit(cfg, user, 'campaign_cancel', { target: { id } });
  return json(200, { ok: true });
}) };
