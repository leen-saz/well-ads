// /api/campaigns/*: «حملة جديدة» in أحلم (src/lib/campaign.ts, docs/ahlam.md). The user's wishes become a brief and a plan of tasks for
// the in-app agents, saved in campaigns / campaign_tasks (migration 030). Any signed-in user may write wishes and get a plan; seeing a
// campaign needs being its author or an approver; starting it needs an approver (owner, or approve on the manager tab). Nothing here
// touches an ad account.
import { sb, json, readJson, handle, requireUser, audit, claimDaily, NO_APPROVE, type AuthEnv, type Session } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { generate, llmMessage, pick, type LlmEnv, type Provider } from '../../lib/llm';
import { overCap, usageCtx } from '../../lib/usage';
import { TASK, PLAN_SCHEMA, PLANS_PER_DAY, AGENTS, cleanWishes, estimate, mayApprove, parsePlan, planMessages } from '../../lib/campaign';
import { dayStart } from '../../lib/ahlam';





import { TTS_VERSIONS, assetUsd, designSizes, dropAssets, ownAsset, ownVideo, type AssetEnv } from '../../lib/campaign-assets';
import { clipCount, clipSeconds, videoUsd } from '../../lib/campaign-video';
import { serveMedia } from '../../lib/site';

import { MAX_REGEN, MAX_RETRIES, REASON_MIN, affectedTasks, cleanReason, readyTask, rollup, type TaskRow } from '../../lib/campaign-run';

import { advance, fail, rows, patchTask, setCampaign, tasksOf, nowIso, type Row } from '../../lib/campaign-step';

type Env = AuthEnv & LlmEnv & AssetEnv;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOf = (v: unknown): string | null => (typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : null);
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
  const plat = Array.isArray((campaign['wishes'] as Row | undefined)?.['platforms']) ? ((campaign['wishes'] as Row)['platforms'] as string[]) : [];
  return json(200, { campaign, tasks: rows(t.data), outputs: rows(o.data), assetPlan: { images: designSizes(plat).length, audio: TTS_VERSIONS, usd: assetUsd('design', plat) + assetUsd('voice', plat), video: { clips: clipCount(e), seconds: clipSeconds(e), usd: videoUsd(e) } }, agents: AGENTS, mayApprove: mayApprove(user, cfg), capped: await overCap(usageCtx(cfg, user, TASK)!, TASK) });
}) };

// The wishes -> a plan. One model call, saved as `planned`: the user reads the plan and its cost before anything runs.
export const create = { POST: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'any', { write: true });
  const w = cleanWishes(await readJson(request, 20_000));
  if (!w.wishes) return json(400, { error: w.error });
  const model = pick(e, TASK);
  if (!model) return json(503, { error: 'أحلم يحتاج الذكاء الاصطناعي، وهو غير متصل الحين' });
  // The counting row is written before the model is paid (and counted right after), so parallel requests cannot all pass
  // and a row that could not be saved refuses instead of removing the limit
  const slot = await claimDaily(cfg, user, 'campaign_create', PLANS_PER_DAY, dayStart(Date.now()));
  if (slot === 'over') return json(429, { error: `وصلت حدّك اليوم (${PLANS_PER_DAY} خطط حملات). جرّب بكرة.` });
  if (slot === 'error') return json(503, { error: 'ما قدرت أتأكد من حدّك اليوم. جرّب بعد لحظات.' });
  let plan, used_model = model.model, used_provider: Provider = model.provider;
  try {
    const out = await generate(e, TASK, { messages: planMessages(w.wishes), max_tokens: 3000, response_format: { type: 'json_schema', json_schema: PLAN_SCHEMA } }, fetch, usageCtx(cfg, user, TASK));
    plan = parsePlan(out.response); used_model = out.model; used_provider = out.engine;
  } catch (err) { return json(502, { error: llmMessage(err) }); }
  if (!plan) return json(502, { error: 'ما طلعت خطة أقدر أقراها، جرّب مرة ثانية أو وضّح الأمنيات أكثر' });
  const est = estimate(plan.tasks.map(t => t.agent), used_model, used_provider, plan.tasks.map(t => assetUsd(t.agent, w.wishes!.platforms, t.kind, e)));
  // The budget is only ever the user's: when it was not given, it is an open question (with «not set» as the assumption), never a made-up number
  if (!w.wishes.budget && !plan.brief.questions.some(q => /ميزاني|budget/i.test(q.q))) plan.brief.questions.push({ q: 'كم ميزانية الحملة؟', assumption: 'لم تُحدَّد: الخطة بنِسب مئوية بدون أرقام ريال', affects: ['optimize'] });
  const made = await sb<Row[]>(cfg, '/rest/v1/campaigns', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' },
    body: { company_id: user.co, title: plan.title, wishes: w.wishes, brief: plan.brief, status: 'planned', estimate_usd: est.usd, created_by: user.email } });
  const id = made.ok ? idOf(rows(made.data)[0]?.['id']) : null;
  if (!id) return fail(user, made, 'ما انحفظت الحملة');
  const tasks = await sb(cfg, '/rest/v1/campaign_tasks', { method: 'POST', admin: true, headers: { Prefer: 'return=minimal' },
    body: plan.tasks.map((t, i) => ({ campaign_id: id, company_id: user.co, position: i, agent: t.agent, title: t.title, spec: { detail: t.detail, ...(t.kind ? { kind: t.kind } : {}) }, depends_on: t.after, estimate_usd: est.perTask[i] })) });
  if (!tasks.ok) { await sb(cfg, scoped(`/rest/v1/campaigns?id=eq.${id}`, user.co), { method: 'DELETE', admin: true }); return fail(user, tasks, 'ما انحفظت مهام الحملة'); }
  await audit(cfg, user, 'campaign_created', { target: { id, tasks: plan.tasks.length, estimate_usd: est.usd } });   // never the wishes' text
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

export const step = { POST: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'any', { write: true });
  const id = idOf((await readJson(request, 2000))['id']);
  if (!id) return json(400, { error: 'طلب غير صحيح' });
  return advance(e, cfg, user, id, visible(user, cfg));
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
  await dropAssets(cfg, e, user.co, `task_id=eq.${task}&campaign_id=eq.${id}`);
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
// the tasks the question affects, and what depends on them, are written again (a task at most MAX_REGEN times). Whoever may approve campaigns
// may answer. Social drafts made earlier stay in Social as drafts: the new ones are added beside them.
export const answer = { POST: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'any', { write: true });
  // An answer writes parts of the campaign again (paid model calls): it is a decision for who may approve, not for every author
  if (!mayApprove(user, cfg)) return json(403, { error: NO_APPROVE });
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
    await dropAssets(cfg, e, user.co, `task_id=eq.${t.id}&campaign_id=eq.${id}`);
    await patchTask(cfg, user.co, t.id, { status: 'waiting', blocked_reason: null, spec: { ...(t.spec ?? {}), regen: (t.spec?.regen ?? 0) + 1, auto: 0, feedback: undefined, override: undefined } });
  }
  if (mine.length) await setCampaign(cfg, user.co, id, 'running', 'review,done,running');
  await audit(cfg, user, 'campaign_answer', { target: { id, index, regenerate: mine.map(x => x.id) } });   // never the answer's text
  return json(200, { ok: true, regenerate: mine.length });
}) };

// A file of the campaign (a picture or a recording), only for who may see the campaign. The key comes from the output row, never from the
// request, and must be inside this campaign's folder. `dl=1` downloads it, else it is shown in the page.
export const file = { GET: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'any');
  const q = new URL(request.url).searchParams, oid = Math.round(Number(q.get('id')));
  if (!Number.isInteger(oid) || oid < 1) return json(400, { error: 'طلب غير صحيح' });
  const o = rows((await sb(cfg, scoped(`/rest/v1/campaign_outputs?select=campaign_id,kind,platform,body&id=eq.${oid}`, user.co), { admin: true })).data)[0];
  const cid = idOf(o?.['campaign_id']);
  const seen = cid ? rows((await sb(cfg, scoped(`/rest/v1/campaigns?select=id&id=eq.${cid}${visible(user, cfg)}`, user.co), { admin: true })).data)[0] : null;
  const b = (o?.['body'] ?? {}) as Row, key = b['key'], mime = String(b['mime'] ?? '');
  // A finished video clip: streamed from R2 with Range (a browser plays and seeks without pulling the whole file), only for who may see the campaign
  if (o && cid && seen && o['kind'] === 'video_clip' && ownVideo(user.co, key) && ['video/mp4', 'video/webm'].includes(mime) && e.FILES) {
    const res = await serveMedia(request, e.FILES, key);
    res.headers.set('cache-control', 'private, max-age=3600'); res.headers.set('x-content-type-options', 'nosniff'); res.headers.set('content-security-policy', "default-src 'none'; sandbox");
    res.headers.set('content-disposition', `${q.get('dl') === '1' ? 'attachment' : 'inline'}; filename="campaign-video.${key.split('.').pop()}"`);
    return res;
  }
  if (!o || !cid || !seen || !ownAsset(user.co, cid, key) || !['image/jpeg', 'image/png', 'audio/wav'].includes(mime) || !e.FILES) return json(404, { error: 'الملف غير موجود' });
  const obj = await e.FILES.get(key);
  if (!obj) return json(404, { error: 'الملف غير موجود' });
  const name = `${String(o['kind']).replace(/[^a-z_]/g, '')}${o['platform'] ? '-' + String(o['platform']).replace(/[^a-z0-9]/g, '') : ''}${b['label'] ? '-' + String(b['label']).replace(/[^a-z0-9]/g, '') : ''}.${key.split('.').pop()}`;
  return new Response(obj.body, { headers: { 'content-type': mime, 'cache-control': 'private, max-age=3600', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; sandbox",
    'content-disposition': `${q.get('dl') === '1' ? 'attachment' : 'inline'}; filename="${name}"` } });
}) };

// «ولّد الملفات» again for a task whose pictures or recordings could not be made (the cap, a refusal, no key, no storage): only the missing files
// are made, from the draft that is already written and checked, so nothing is written or paid for twice. An approver, because it spends again.
export const assets = { POST: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'any', { write: true });
  if (!mayApprove(user, cfg)) return json(403, { error: NO_APPROVE });
  const b = await readJson(request, 2000), id = idOf(b['id']), task = Math.round(Number(b['task']));
  if (!id || !Number.isInteger(task) || task < 1) return json(400, { error: 'طلب غير صحيح' });
  const cur = rows((await sb(cfg, scoped(`/rest/v1/campaign_tasks?select=id,agent,status,spec&id=eq.${task}&campaign_id=eq.${id}`, user.co), { admin: true })).data)[0];
  const spec = (cur?.['spec'] ?? {}) as Row;
  if (!cur || !['review', 'approved'].includes(String(cur['status'])) || !Array.isArray(spec['missing']) || !(spec['missing'] as unknown[]).length) return json(409, { error: 'ما فيه ملفات ناقصة في هذي المهمة' });
  const r = await patchTask(cfg, user.co, task, { status: 'waiting', spec: { ...spec, stage: 'assets' } }, `&status=eq.${cur['status']}`);
  if (!r.ok) return fail(user, r, 'ما انحفظ الطلب');
  if (!rows(r.data).length) return json(409, { error: 'المهمة تغيّرت. حدّث الصفحة' });
  await sb(cfg, scoped(`/rest/v1/campaign_outputs?task_id=eq.${task}&campaign_id=eq.${id}&kind=eq.asset_missing`, user.co), { method: 'DELETE', admin: true });
  await setCampaign(cfg, user.co, id, 'running', 'review,done');
  await audit(cfg, user, 'campaign_assets_retry', { target: { id, task, agent: cur['agent'] } });
  return json(200, { ok: true });
}) };
