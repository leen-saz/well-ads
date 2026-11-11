// /api/campaigns/*: «حملة جديدة» in احلم (src/lib/campaign.ts, docs/ahlam.md). The user's wishes become a brief and a plan of tasks for
// the in-app agents, saved in campaigns / campaign_tasks (migration 030). Any signed-in user may write wishes and get a plan; seeing a
// campaign needs being its author or an approver; starting it needs an approver (owner, or approve on the manager tab). Nothing here
// touches an ad account.
import { sb, json, readJson, handle, requireUser, audit, missingSchema, notApplied, NO_APPROVE, type AuthEnv, type Session } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { generate, llmMessage, pick, type LlmEnv, type Provider } from '../../lib/llm';
import { overCap, usageCtx } from '../../lib/usage';
import { TASK, PLAN_SCHEMA, PLANS_PER_DAY, AGENTS, cleanWishes, estimate, mayApprove, parsePlan, planMessages } from '../../lib/campaign';
import { dayStart, loadDash, toolsFor, type AhlamEnv } from '../../lib/ahlam';
import { SOCIAL } from '../../modules/social/engine';
import { loadKnowledge, forbiddenRules, systemPrompt } from '../../modules/knowledge/knowledge';
import { INTERNAL_KINDS, PUBLISHABLE, defaultTasks, MAX_AUTO, MAX_REGEN, MAX_RETRIES, STALE_MS, REASON_MIN, affectedTasks, cleanReason, kpis, parsePosts, readyTask, rollup, slim, socialTargets, taskMessages, verdict, type OutputRow, type TaskRow } from '../../lib/campaign-run';

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
  const t = await sb(cfg, scoped(`/rest/v1/campaign_tasks?select=id,position,agent,title,spec,depends_on,status,blocked_reason,estimate_usd,updated_at&campaign_id=eq.${id}&order=position.asc`, user.co), { admin: true });
  const o = await sb(cfg, scoped(`/rest/v1/campaign_outputs?select=id,task_id,kind,platform,body,compliance&campaign_id=eq.${id}&order=id.asc&limit=200`, user.co), { admin: true });
  return json(200, { campaign, tasks: rows(t.data), outputs: rows(o.data), agents: AGENTS, mayApprove: mayApprove(user, cfg), capped: await overCap(usageCtx(cfg, user, TASK)!, TASK) });
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

const AGENTS_AR: Record<string, string> = { knowledge: 'المعرفة', content: 'المحتوى', design: 'التصميم', voice: 'الصوت', optimize: 'التحسين' };
const KIND: Record<string, string> = { knowledge: 'insight', content: 'copy', design: 'design_brief', voice: 'voice_script', optimize: 'optimization' };
const nowIso = () => new Date().toISOString();
type SbCfg = Parameters<typeof sb>[0];
const patchTask = (cfg: SbCfg, co: string, id: number, body: Row, extra = '') =>
  sb<Row[]>(cfg, scoped(`/rest/v1/campaign_tasks?id=eq.${id}${extra}`, co), { method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' }, body: { ...body, updated_at: nowIso() } });
async function setCampaign(cfg: SbCfg, co: string, id: string, status: string, from: string): Promise<void> {
  await sb(cfg, scoped(`/rest/v1/campaigns?id=eq.${id}&status=in.(${from})`, co), { method: 'PATCH', admin: true, body: { status, updated_at: nowIso() } });
}
async function tasksOf(cfg: SbCfg, co: string, id: string): Promise<TaskRow[]> {
  const t = await sb(cfg, scoped(`/rest/v1/campaign_tasks?select=id,position,agent,title,spec,depends_on,status,blocked_reason,updated_at&campaign_id=eq.${id}&order=position.asc`, co), { admin: true });
  return rows(t.data) as unknown as TaskRow[];
}

// One task per call. Runs the next task whose dependencies are done, by the agent it was given to; the page calls it again until it
// says `done`. Only a campaign an approver approved runs; whoever may see it may keep it going. The claim (waiting -> running) is
// one conditional write, so two pages never run the same task twice.
export const step = { POST: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'any', { write: true });
  const id = idOf((await readJson(request, 2000))['id']);
  if (!id) return json(400, { error: 'طلب غير صحيح' });
  const c = await sb<Row[]>(cfg, scoped(`/rest/v1/campaigns?select=id,title,status,wishes,brief,approved_at&id=eq.${id}${visible(user, cfg)}`, user.co), { admin: true });
  if (!c.ok) return fail(user, c, 'ما قدرت أقرأ الحملة');
  const camp = rows(c.data)[0];
  if (!camp) return json(404, { error: 'الحملة غير موجودة' });
  const was = String(camp['status']);
  // Only an approved campaign runs (approved_at is the approver's mark; «review» is a campaign that stopped and has tasks left to run). Planned,
  // cancelled and done ones never do: nothing is spent without the approval.
  if (was !== 'approved' && was !== 'running' && !(was === 'review' && camp['approved_at'])) return json(409, { error: 'الحملة لازم تنعتمد أول، وما تشتغل بعد الإلغاء' });
  let tasks = await tasksOf(cfg, user.co, id);
  if (!tasks.length) {
    // approved before the tasks existed, or saved without them: give it the standard plan now (no AI call, no new approval)
    const m = pick(e, TASK), est = estimate(defaultTasks().map(x => x.agent), m?.model ?? 'openai/gpt-4.1', m?.provider ?? 'openrouter');
    const made = await sb(cfg, '/rest/v1/campaign_tasks', { method: 'POST', admin: true, headers: { Prefer: 'return=minimal' },
      body: defaultTasks().map((x, i) => ({ campaign_id: id, company_id: user.co, position: i, agent: x.agent, title: x.title, spec: { detail: x.detail, backfilled: true }, depends_on: x.after, estimate_usd: est.perTask[i] })) });
    if (!made.ok) return fail(user, made, 'ما قدرت أجهّز مهام الحملة');
    await audit(cfg, user, 'campaign_backfill', { target: { id, tasks: defaultTasks().length } });
    tasks = await tasksOf(cfg, user.co, id);
  }
  for (const t of tasks.filter(x => x.status === 'running' && x.updated_at && Date.parse(x.updated_at) < Date.now() - STALE_MS)) { await patchTask(cfg, user.co, t.id, { status: 'waiting' }, '&status=eq.running'); t.status = 'waiting'; }
  // An internal reference (knowledge, optimization) that an older version stopped for quoting forbidden words was never an ad: released
  for (const x of tasks.filter(y => y.status === 'blocked' && y.agent !== 'compliance' && !PUBLISHABLE.includes(y.agent) && !y.spec?.override)) {
    const rel = await patchTask(cfg, user.co, x.id, { status: 'review', blocked_reason: null }, '&status=eq.blocked');
    if (rel.ok && rows(rel.data).length) { x.status = 'review'; await audit(cfg, user, 'campaign_unblock_internal', { target: { id, task: x.id, agent: x.agent } }); }
  }
  const t = readyTask(tasks);
  if (!t) {
    const r = rollup(tasks);
    if (r.status !== 'running' && String(camp['status']) !== r.status) await setCampaign(cfg, user.co, id, r.status, 'approved,running');
    return json(200, { done: true, status: r.status, stalled: r.stalled });
  }
  const claim = await patchTask(cfg, user.co, t.id, { status: 'running' }, '&status=eq.waiting');
  if (!claim.ok) return fail(user, claim, 'ما قدرت أبدأ المهمة');
  if (!rows(claim.data).length) return json(200, { busy: true });
  if (was === 'approved' || was === 'review') await setCampaign(cfg, user.co, id, 'running', 'approved,review');

  const wishes = (camp['wishes'] ?? {}) as Row, wanted = socialTargets(Array.isArray(wishes['platforms']) ? (wishes['platforms'] as string[]) : []);
  const entries = await loadKnowledge(cfg, user.co);
  const extra = forbiddenRules(entries);
  const out: OutputRow[] = [];
  let status = 'review', reason: string | null = null, spec: Row = {}, fixing = 0;

  try {
    const prior = await sb(cfg, scoped(`/rest/v1/campaign_outputs?select=task_id,kind,platform,body,compliance&campaign_id=eq.${id}&order=id.asc&limit=200`, user.co), { admin: true });
    const outputs = rows(prior.data) as unknown as OutputRow[];
    if (t.agent === 'compliance') {
      // The gate before «ready»: every draft of the campaign is checked again against the rules as they are today. No AI call.
      const live = new Set(tasks.filter(x => x.status !== 'blocked' && x.status !== 'failed').map(x => x.id));
      const passed = new Set(tasks.filter(x => x.spec?.override).map(x => x.id));   // let through by a person, with a reason: reported, not blocked again
      const texts = outputs.filter(o => o.task_id != null && live.has(o.task_id) && !passed.has(o.task_id) && !INTERNAL_KINDS.includes(o.kind)).map(o => ({ label: `${o.kind}${o.platform ? ' · ' + o.platform : ''}`, text: String(o.body.text ?? '') }));
      const v = verdict(texts, extra);
      const n = (l: string) => v.hits.filter(h => h.level === l).length;
      out.push({ task_id: t.id, kind: 'compliance_report', body: { text: `فُحصت ${texts.length} مسودة: ${n('critical')} مخالفة، ${n('warn')} انتبه، ${n('info')} ملاحظة.${passed.size ? ` (${passed.size} مهمة متجاوزة بموافقة ومذكورة في الحزمة)` : ''}${v.hits.length ? '\n' + v.hits.slice(0, 20).map(h => `- ${h.title} «${h.match}»: ${h.fix}`).join('\n') : '\nما ظهرت ملاحظات.'}` }, compliance: slim(v.hits) });
      if (v.blocked) { status = 'blocked'; reason = v.reason; }
    } else {
      const run = { cfg, user, e: e as AhlamEnv };
      const tool = async (n: string, a: Record<string, unknown>): Promise<string> => { try { return (await toolsFor(run).find(x => x.name === n)?.run(run, a)) ?? ''; } catch { return ''; } };
      const data = t.agent === 'knowledge' || t.agent === 'optimize' ? [await tool('performance', { days: 30 }), await tool('ads', { sort: 'best', days: 30, limit: 5 })].filter(Boolean).join('\n\n') : '';
      const funnel = t.agent === 'optimize' ? ((await loadDash(run)) as { funnel_targets?: unknown } | null)?.funnel_targets : undefined;
      const ks = kpis(funnel);
      const gen = await generate(e, TASK, { messages: taskMessages(t.agent, { wishes: wishes as never, brief: camp['brief'], questions: ((camp['brief'] as { questions?: { q: string; assumption: string; answer?: string }[] } | null)?.questions) ?? [], task: t, outputs, knowledge: systemPrompt(entries, 'content', 4000), data, kpis: ks, platforms: wanted }), max_tokens: 2500 }, fetch, usageCtx(cfg, user, TASK));
      const text = gen.response.trim();
      if (t.agent === 'social') {
        const posts = parsePosts(text, wanted);
        if (!posts.length) { status = 'failed'; reason = 'ما طلعت مسودات منشورات أقدر أقراها'; }
        else {
          const v = verdict(posts.map(p => ({ label: SOCIAL[p.platform as keyof typeof SOCIAL].name, text: p.body })), extra);
          for (const p of posts) out.push({ task_id: t.id, kind: 'post', platform: p.platform, body: { text: p.body, day: p.day }, compliance: slim(v.hits.filter(h => p.body.includes(h.match))) });
          if (v.blocked) { status = 'blocked'; reason = v.reason; }
        }
      } else {
        // internal references (knowledge, optimization) are not ads: no rules, no stop, no repair loop
        const v = PUBLISHABLE.includes(t.agent) ? verdict([{ label: AGENTS_AR[t.agent] ?? t.agent, text }], extra) : { hits: [], blocked: false, reason: '' };
        out.push({ task_id: t.id, kind: KIND[t.agent] ?? 'text', body: { text }, compliance: slim(v.hits) });
        if (t.agent === 'optimize') out.push({ task_id: t.id, kind: 'measurement', body: { text: 'أهداف القياس (نفس أرقام الحكم في لوحة الأداء)', kpis: ks }, compliance: [] });
        if (v.blocked) { status = 'blocked'; reason = v.reason; }
      }
    }
    if (status === 'blocked') spec = { feedback: reason };
    // The repair loop: compliance refused a draft, so its agent writes it again by compliance's own instructions (what to cut, the approved
    // wording) and the check runs again, up to MAX_AUTO times. Only then does the task stop, with the reason, for a person.
    if (status === 'blocked' && t.agent !== 'compliance' && (t.spec?.auto ?? 0) < MAX_AUTO) {
      fixing = (t.spec?.auto ?? 0) + 1; out.length = 0; status = 'waiting'; spec = { auto: fixing, feedback: reason }; reason = null;
    }
  } catch (err) {
    const m = (err as Error)?.message;
    if (m === 'cap_reached' || m === 'no_model' || m === 'llm_busy') { await patchTask(cfg, user.co, t.id, { status: 'waiting' }); return json(200, { paused: m, message: llmMessage(err) }); }
    status = 'failed'; reason = llmMessage(err);
  }
  if (out.length) {
    const w = await sb(cfg, '/rest/v1/campaign_outputs', { method: 'POST', admin: true, headers: { Prefer: 'return=minimal' }, body: out.map(o => ({ ...o, campaign_id: id, company_id: user.co })) });
    if (!w.ok) { status = 'failed'; reason = 'ما انحفظت مخرجات المهمة'; }
  }
  // Drafts into Social only from a task that passed the check; they are `draft` and manual: scheduling and approval stay with Social's approvers
  let drafts = 0;
  if (t.agent === 'social' && status === 'review') {
    const posts = out.filter(o => o.kind === 'post');
    const w = await sb(cfg, '/rest/v1/social_posts', { method: 'POST', admin: true, headers: { Prefer: 'return=minimal' }, body: posts.map(o => {
      const at = new Date(Date.now() + Number(o.body['day'] ?? 1) * 864e5); at.setUTCHours(15, 0, 0, 0);
      return { company_id: user.co, platforms: [o.platform ?? ''], body: String(o.body.text ?? ''), publish_at: at.toISOString(), mode: 'manual', status: 'draft', created_by: user.email };
    }) });
    if (w.ok) drafts = posts.length;
  }
  await patchTask(cfg, user.co, t.id, { status, blocked_reason: reason, spec: { ...(t.spec ?? {}), ...spec } });
  await audit(cfg, user, fixing ? 'campaign_task_autofix' : 'campaign_task_run', { target: { id, task: t.id, agent: t.agent, status, outputs: out.length, drafts, ...(fixing ? { attempt: fixing } : {}) } });
  tasks = await tasksOf(cfg, user.co, id);
  const r = rollup(tasks);
  if (r.status !== 'running') await setCampaign(cfg, user.co, id, r.status, 'approved,running');
  return json(200, { ran: { task: t.id, agent: t.agent, status, reason, ...(fixing ? { fixing } : {}) }, more: r.status === 'running', status: r.status });
}) };

// A person looks at a finished task and approves it (an approver). Nothing is published by this: it only marks the draft as accepted.
export const review = { POST: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'any', { write: true });
  if (!mayApprove(user, cfg)) return json(403, { error: NO_APPROVE });
  const b = await readJson(request, 2000), id = idOf(b['id']), task = Math.round(Number(b['task']));
  if (!id || !Number.isInteger(task) || task < 1) return json(400, { error: 'طلب غير صحيح' });
  const r = await patchTask(cfg, user.co, task, { status: 'approved', blocked_reason: null }, `&campaign_id=eq.${id}&status=eq.review`);
  if (!r.ok) return fail(user, r, 'ما انحفظ الاعتماد');
  if (!rows(r.data).length) return json(409, { error: 'المهمة مو بانتظار المراجعة' });
  await audit(cfg, user, 'campaign_task_approve', { target: { id, task } });
  const roll = rollup(await tasksOf(cfg, user.co, id));
  if (roll.status === 'done') await setCampaign(cfg, user.co, id, 'done', 'running,review,approved');
  return json(200, { ok: true, status: roll.status });
}) };

// A blocked or failed task goes back to waiting, at most MAX_RETRIES times; the new draft must pass the same check. An approver only,
// because it spends again. The old output is dropped so the pack never holds a draft that was stopped.
export const retry = { POST: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'any', { write: true });
  if (!mayApprove(user, cfg)) return json(403, { error: NO_APPROVE });
  const b = await readJson(request, 2000), id = idOf(b['id']), task = Math.round(Number(b['task']));
  if (!id || !Number.isInteger(task) || task < 1) return json(400, { error: 'طلب غير صحيح' });
  const cur = rows((await sb(cfg, scoped(`/rest/v1/campaign_tasks?select=id,status,spec&id=eq.${task}&campaign_id=eq.${id}`, user.co), { admin: true })).data)[0];
  if (!cur || (cur['status'] !== 'blocked' && cur['status'] !== 'failed')) return json(409, { error: 'المهمة مو موقوفة' });
  const spec = (cur['spec'] ?? {}) as Row, n = Number(spec['retries'] ?? 0);
  if (n >= MAX_RETRIES) return json(409, { error: `انعادت المحاولة ${MAX_RETRIES} مرات. عدّل الأمنيات وسوّ حملة جديدة` });
  const r = await patchTask(cfg, user.co, task, { status: 'waiting', blocked_reason: null, spec: { ...spec, retries: n + 1, auto: 0 } }, `&status=eq.${cur['status']}`);
  if (!r.ok) return fail(user, r, 'ما انحفظت المحاولة');
  if (!rows(r.data).length) return json(409, { error: 'المهمة تغيّرت. حدّث الصفحة' });
  await sb(cfg, scoped(`/rest/v1/campaign_outputs?task_id=eq.${task}&campaign_id=eq.${id}`, user.co), { method: 'DELETE', admin: true });
  await setCampaign(cfg, user.co, id, 'running', 'review');
  await audit(cfg, user, 'campaign_task_retry', { target: { id, task, retries: n + 1 } });
  return json(200, { ok: true });
}) };

// The owner or an approver lets a stopped task through, knowing compliance refused it. A short reason is required, the override is
// audit-logged (who, why, the rules: never the draft's text), the task shows «تجاوز بموافقة» in the pack, and the campaign goes on to
// the next task. Posts it made become Social DRAFTS (manual): they are never scheduled or published from here.
export const override = { POST: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'any', { write: true });
  if (!mayApprove(user, cfg)) return json(403, { error: NO_APPROVE });
  const b = await readJson(request, 3000), id = idOf(b['id']), task = Math.round(Number(b['task'])), reason = cleanReason(b['reason']);
  if (!id || !Number.isInteger(task) || task < 1) return json(400, { error: 'طلب غير صحيح' });
  if (reason.length < REASON_MIN) return json(400, { error: 'اكتب سبب التجاوز (جملة قصيرة على الأقل)' });
  const cur = rows((await sb(cfg, scoped(`/rest/v1/campaign_tasks?select=id,agent,status,spec&id=eq.${task}&campaign_id=eq.${id}`, user.co), { admin: true })).data)[0];
  if (!cur || cur['status'] !== 'blocked') return json(409, { error: 'المهمة مو موقوفة من الامتثال' });
  const outs = rows((await sb(cfg, scoped(`/rest/v1/campaign_outputs?select=kind,platform,body,compliance&task_id=eq.${task}&campaign_id=eq.${id}&order=id.asc`, user.co), { admin: true })).data);
  const ov = { by: user.email, reason, at: nowIso() };
  const spec: Row = { ...((cur['spec'] ?? {}) as Row), override: ov };
  delete spec['feedback'];
  const r = await patchTask(cfg, user.co, task, { status: 'review', blocked_reason: null, spec }, '&status=eq.blocked');
  if (!r.ok) return fail(user, r, 'ما انحفظ التجاوز');
  if (!rows(r.data).length) return json(409, { error: 'المهمة تغيّرت. حدّث الصفحة' });
  let drafts = 0;
  if (cur['agent'] === 'social') {
    const posts = outs.filter(o => o['kind'] === 'post');
    const w = await sb(cfg, '/rest/v1/social_posts', { method: 'POST', admin: true, headers: { Prefer: 'return=minimal' }, body: posts.map(o => {
      const at = new Date(Date.now() + Number((o['body'] as Row | null)?.['day'] ?? 1) * 864e5); at.setUTCHours(15, 0, 0, 0);
      return { company_id: user.co, platforms: [String(o['platform'] ?? '')], body: String((o['body'] as Row | null)?.['text'] ?? ''), publish_at: at.toISOString(), mode: 'manual', status: 'draft', created_by: user.email };
    }) });
    if (w.ok) drafts = posts.length;
  }
  const rules = [...new Set(outs.flatMap(o => (Array.isArray(o['compliance']) ? (o['compliance'] as { rule?: string; level?: string }[]) : []).filter(h => h.level === 'critical').map(h => String(h.rule))))].slice(0, 10);
  await audit(cfg, user, 'campaign_compliance_override', { target: { id, task, agent: cur['agent'], reason, rules, drafts } });
  const roll = rollup(await tasksOf(cfg, user.co, id));
  if (roll.status === 'running') await setCampaign(cfg, user.co, id, 'running', 'review');
  return json(200, { ok: true, status: roll.status });
}) };

// For the sidebar's dots: which agents are working on a campaign task right now (running), which failed, and whether any campaign is
// active at all. Two small reads, the user's own campaigns (an approver sees the company's). No text, no ids.
export const agents = { GET: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'any');
  const c = await sb(cfg, scoped(`/rest/v1/campaigns?select=id,status&status=in.(approved,running,review)&limit=50${visible(user, cfg)}`, user.co), { admin: true });
  const camps = c.ok ? rows(c.data).flatMap(x => { const i = idOf(x['id']); return i ? [{ id: i, status: String(x['status']) }] : []; }) : [];
  if (!camps.length) return json(200, { active: false, agents: {} });
  const t = await sb(cfg, scoped(`/rest/v1/campaign_tasks?select=campaign_id,position,agent,status,depends_on,updated_at&campaign_id=in.(${camps.map(x => x.id).join(',')})&limit=400`, user.co), { admin: true });
  const all = rows(t.data) as unknown as (TaskRow & { campaign_id: string })[];
  const out: Record<string, string> = {};
  const mark = (a: string, s: string) => { if (s === 'running' || !out[a]) out[a] = s; };
  for (const x of all) if (x.status === 'running' || x.status === 'failed') mark(x.agent, x.status);
  // Between two steps of a live run no task is «running» for a moment: the agent whose task is next in a campaign that moved in the last
  // 3 minutes still shows as working, so the dot does not flicker to idle. A campaign nobody is running (page closed) goes quiet.
  for (const k of camps.filter(x => x.status === 'running' || x.status === 'approved')) {
    const mine = all.filter(x => x.campaign_id === k.id);
    const recent = mine.some(x => x.updated_at && Date.parse(x.updated_at) > Date.now() - 3 * 60_000);
    const next = recent ? readyTask(mine) : null;
    if (next) mark(next.agent, 'running');
  }
  return json(200, { active: true, agents: out });
}) };

// An answer to an open question (the agents went on with the assumption). It is saved in the brief; when the campaign has already run, only
// the tasks the question affects, and what depends on them, are written again (a task at most MAX_REGEN times). Whoever may see the campaign
// may answer. Social drafts made earlier stay in Social as drafts: the new ones are added beside them.
export const answer = { POST: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'any', { write: true });
  const b = await readJson(request, 3000), id = idOf(b['id']), index = Math.round(Number(b['index'])), text = cleanReason(b['answer']).slice(0, 400);
  if (!id || !Number.isInteger(index) || index < 0 || index > 5) return json(400, { error: 'طلب غير صحيح' });
  if (!text) return json(400, { error: 'اكتب الجواب' });
  const c = await sb<Row[]>(cfg, scoped(`/rest/v1/campaigns?select=id,status,brief&id=eq.${id}${visible(user, cfg)}`, user.co), { admin: true });
  if (!c.ok) return fail(user, c, 'ما قدرت أقرأ الحملة');
  const camp = rows(c.data)[0];
  if (!camp) return json(404, { error: 'الحملة غير موجودة' });
  const status = String(camp['status']);
  if (status === 'cancelled') return json(409, { error: 'الحملة ملغاة' });
  const brief = (camp['brief'] ?? {}) as { questions?: { q: string; assumption: string; affects?: string[]; answer?: string }[] };
  const qs = brief.questions ?? [];
  if (!qs[index]) return json(404, { error: 'السؤال غير موجود' });
  const tasks = await tasksOf(cfg, user.co, id);
  const started = ['approved', 'running', 'review', 'done'].includes(status);
  const ids = started ? affectedTasks(tasks, (qs[index]!.affects ?? []).filter((a): a is Parameters<typeof affectedTasks>[1][number] => a in AGENTS)).filter(i => tasks.find(x => x.id === i)!.status !== 'waiting') : [];
  const mine = tasks.filter(x => ids.includes(x.id));
  if (mine.some(x => x.status === 'running')) return json(409, { error: 'فيه مهمة تشتغل الحين، جرّب بعد شوي' });
  if (mine.some(x => (x.spec?.regen ?? 0) >= MAX_REGEN)) return json(409, { error: `انعادت كتابة بعض الأجزاء ${MAX_REGEN} مرات. أضف أمنياتك في حملة جديدة` });
  qs[index]!.answer = text;
  const saved = await sb(cfg, scoped(`/rest/v1/campaigns?id=eq.${id}`, user.co), { method: 'PATCH', admin: true, body: { brief: { ...brief, questions: qs }, updated_at: nowIso() } });
  if (!saved.ok) return fail(user, saved, 'ما انحفظ الجواب');
  for (const t of mine) {
    await sb(cfg, scoped(`/rest/v1/campaign_outputs?task_id=eq.${t.id}&campaign_id=eq.${id}`, user.co), { method: 'DELETE', admin: true });
    await patchTask(cfg, user.co, t.id, { status: 'waiting', blocked_reason: null, spec: { ...(t.spec ?? {}), regen: (t.spec?.regen ?? 0) + 1, auto: 0, feedback: undefined, override: undefined } });
  }
  if (mine.length) await setCampaign(cfg, user.co, id, 'running', 'review,done,running');
  await audit(cfg, user, 'campaign_answer', { target: { id, index, regenerate: mine.map(x => x.id) } });   // never the answer's text
  return json(200, { ok: true, regenerate: mine.length });
}) };
