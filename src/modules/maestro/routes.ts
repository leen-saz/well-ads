// /api/maestro/*: the maestro tab. Agents, tasks and pending approvals of the user's company, from Paperclip.
// Connecting a company to Paperclip is owner-only; creating tasks needs edit and deciding approvals needs approve on `maestro`.
import { sb, json, readJson, handle, requireUser, audit, isOwner, atLeast, notEnabled, type AuthEnv, type Cfg } from '../../lib/auth';
import { budget, chatLines, client, cleanTask, items, performance, STATUS, tabOf, withBrief, type PcEnv } from './paperclip';
import { MODULES } from '../registry';
import { knowledgeFor } from '../knowledge/knowledge';
import { crmFor } from './health';
import { dataHealth, PARTS, type Part } from './datahealth';

type Env = AuthEnv & PcEnv;
type Co = { id: string; name: string; paperclip_company_id: string | null };

async function companyOf(cfg: Cfg, co: string): Promise<Co | null> {
  const r = await sb<Co[]>(cfg, `/rest/v1/companies?id=eq.${co}&select=id,name,paperclip_company_id`, { admin: true });
  return r.ok && Array.isArray(r.data) ? r.data[0] || null : null;
}
// The tabs a task can be sent to (every live tab but this one), and which Paperclip project belongs to which tab
const TABS = MODULES.filter(m => m.status === 'live' && m.key !== 'maestro').map(m => ({ key: m.key, ar: m.ar }));
const projectTabs = (projects: Record<string, unknown>[]) => Object.fromEntries(projects.map(p => [String(p.id), tabOf(p.name)]).filter(([, k]) => k));
const notSet = (user?: { role: string }) => json(503, { error: notEnabled(user, 'المدير', 'PAPERCLIP_URL و PAPERCLIP_TOKEN'), setup: true });

export const state = { GET: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'maestro');
  const pc = client(e);
  if (!pc) return notSet(user);
  const c = await companyOf(cfg, user.co);
  if (!c?.paperclip_company_id) return json(200, { connected: false, owner: isOwner(user, cfg), statuses: STATUS });
  let agents: unknown[] = [], issues: unknown[] = [], approvals: unknown[] = [], company: Record<string, unknown> = {}, projects: Record<string, unknown>[] = [];
  try { [agents, issues, approvals, company, projects] = await Promise.all([pc.agents(c.paperclip_company_id), pc.issues(c.paperclip_company_id), pc.approvals(c.paperclip_company_id), pc.company(c.paperclip_company_id), pc.projects(c.paperclip_company_id)]); }
  catch (err) { console.error('maestro_state_failed', (err as Error).message); return json(502, { error: 'المدير مو متاح الحين، جرّب بعد شوي' }); }
  return json(200, { connected: true, owner: isOwner(user, cfg), canApprove: atLeast(user, 'maestro', 'approve', cfg), canEdit: atLeast(user, 'maestro', 'edit', cfg), statuses: STATUS, budget: budget(company), tabs: TABS, projectTabs: projectTabs(projects), agents, issues, approvals });
}) };

// One agent's performance card for the last 7 or 30 days
export const agent = { GET: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'maestro');
  const pc = client(e);
  if (!pc) return notSet(user);
  const u = new URL(request.url);
  const id = u.searchParams.get('id') || '';
  const days = u.searchParams.get('days') === '7' ? 7 : 30;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return json(400, { error: 'طلب غير صحيح' });
  const c = await companyOf(cfg, user.co);
  if (!c?.paperclip_company_id) return json(409, { error: 'اربط الشركة بالمدير أول' });
  const since = Date.now() - days * 864e5;
  try { return json(200, { days, ...performance(await pc.agentInputs(c.paperclip_company_id, id, new Date(since).toISOString()), since) }); }
  catch (err) { console.error('maestro_agent_failed', (err as Error).message); return json(502, { error: 'المدير مو متاح الحين، جرّب بعد شوي' }); }
}) };

// Paperclip may be seen by people outside the company: what we write there carries the user's name, never their email
const byline = (user: { name?: string }) => (user.name || '').trim().slice(0, 80) || 'مستخدم اللوحة';
// Each chat message wakes the CEO agent (paid, on Grok): at most CHAT_PER_MINUTE per user, counted from audit_log
const CHAT_PER_MINUTE = 10;
async function chatTooFast(cfg: Cfg, uid: string): Promise<boolean> {
  const since = new Date(Date.now() - 60_000).toISOString();
  const r = await sb<unknown[]>(cfg, `/rest/v1/audit_log?select=action&action=eq.maestro_chat&user_id=eq.${encodeURIComponent(uid)}&at=gte.${encodeURIComponent(since)}&limit=${CHAT_PER_MINUTE}`, { admin: true });
  return r.ok && Array.isArray(r.data) && r.data.length >= CHAT_PER_MINUTE;
}

// The chat with «المدير» (docs/maestro-plan.md §3). GET reads the thread; POST adds a message (needs edit).
export const chat = {
  GET: handle(async (request, e: Env) => {
    const { cfg, user } = await requireUser(request, e, 'maestro');
    const pc = client(e);
    if (!pc) return notSet(user);
    const c = await companyOf(cfg, user.co);
    if (!c?.paperclip_company_id) return json(409, { error: 'اربط الشركة بالمدير أول' });
    try {
      const issue = await pc.chatIssue(c.paperclip_company_id, false);
      if (!issue) return json(200, { lines: [] });
      const [comments, agents] = await Promise.all([pc.comments(String(issue.id)), pc.agents(c.paperclip_company_id)]);
      return json(200, { lines: chatLines(comments, Object.fromEntries(items(agents).map(a => [String(a.id), String(a.name || '')]))) });
    } catch (err) { console.error('maestro_chat_failed', (err as Error).message); return json(502, { error: 'المدير مو متاح الحين، جرّب بعد شوي' }); }
  }),
  POST: handle(async (request, e: Env) => {
    const { cfg, user } = await requireUser(request, e, 'maestro', { write: true });
    const pc = client(e);
    if (!pc) return notSet(user);
    const text = String((await readJson(request)).text || '').trim().slice(0, 4000);
    if (!text) return json(400, { error: 'اكتب رسالتك' });
    if (await chatTooFast(cfg, user.uid)) return json(429, { error: `وصلت الحد: ${CHAT_PER_MINUTE} رسائل بالدقيقة. جرّب بعد دقيقة.` });
    const c = await companyOf(cfg, user.co);
    if (!c?.paperclip_company_id) return json(409, { error: 'اربط الشركة بالمدير أول' });
    try {
      const issue = await pc.chatIssue(c.paperclip_company_id, true);
      await pc.say(issue!, `${text}\n\n— ${byline(user)}`);
      await audit(cfg, user, 'maestro_chat', { target: { issue: issue!.id } });
      return json(200, { ok: true });
    } catch (err) {
      const m = (err as Error).message;
      console.error('maestro_chat_send_failed', m);
      return json(m === 'no ceo' ? 409 : 502, { error: m === 'no ceo' ? 'ما فيه إيجنت CEO في Paperclip يرد على المحادثة' : 'ما وصلت الرسالة، جرّب بعد شوي' });
    }
  }),
};

export const connect = { POST: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'owner', { write: true });
  const pc = client(e);
  if (!pc) return notSet(user);
  const c = await companyOf(cfg, user.co);
  if (!c) return json(404, { error: 'شركة غير معروفة' });
  if (c.paperclip_company_id) return json(200, { ok: true, id: c.paperclip_company_id });
  // The engine's own error stays in the logs; users see a plain message (the engine is never named in the UI)
  let made: Record<string, unknown> = {};
  try { made = await pc.createCompany(c.name); } catch (err) { console.error('maestro_connect_failed', (err as Error).message); return json(502, { error: 'ما قدرنا نجهز مساحة شركتك، جرّب بعد شوي' }); }
  const id = String(made.id || '');
  if (!id) return json(502, { error: 'ما قدرنا نجهز مساحة شركتك، جرّب بعد شوي' });
  const r = await sb(cfg, `/rest/v1/companies?id=eq.${user.co}&paperclip_company_id=is.null`, { method: 'PATCH', admin: true, body: { paperclip_company_id: id } });
  if (!r.ok) return json(500, { error: 'ما انحفظ الربط' });
  await audit(cfg, user, 'maestro_connected', { target: { paperclip_company_id: id } });
  return json(200, { ok: true, id });
}) };

export const task = { POST: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'maestro', { write: true });
  const pc = client(e);
  if (!pc) return notSet(user);
  const t = cleanTask(await readJson(request));
  if (!t) return json(400, { error: 'اكتب عنوان المهمة' });
  const c = await companyOf(cfg, user.co);
  if (!c?.paperclip_company_id) return json(409, { error: 'اربط الشركة بالمدير أول' });
  const tab = TABS.find(x => x.key === t.tab);
  if (t.tab && !tab) return json(400, { error: 'تاب غير معروف' });
  if (tab) {
    try { t.projectId = await pc.projectFor(c.paperclip_company_id, tab.key, tab.ar); }
    catch (err) { console.error('maestro_project_failed', (err as Error).message); return json(502, { error: 'ما قدرنا نجهز مهام التاب، جرّب بعد شوي' }); }
  }
  // The agents run in Paperclip: the company's knowledge goes with each task so they write by it
  const issue = await pc.createIssue(c.paperclip_company_id, { ...t, description: withBrief(`${t.description}\n\n— طلبها ${byline(user)}`, await knowledgeFor(cfg, user.co, 'maestro')) });
  await audit(cfg, user, 'maestro_task', { target: { issue: issue.id, title: t.title, agent: t.assigneeAgentId || null, tab: tab?.key || null } });
  return json(200, { ok: true, issue });
}) };

export const approval = { POST: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'maestro', { write: true, approve: true });
  const pc = client(e);
  if (!pc) return notSet(user);
  const b = await readJson(request);
  const act = b.action === 'approve' ? 'approve' : b.action === 'reject' ? 'reject' : null;
  if (!act) return json(400, { error: 'طلب غير صحيح' });
  const c = await companyOf(cfg, user.co);
  if (!c?.paperclip_company_id) return json(409, { error: 'اربط الشركة بالمدير أول' });
  try { await pc.decide(c.paperclip_company_id, String(b.id || ''), act); } catch (err) { console.warn('maestro_decide_failed', (err as Error).message); return json(404, { error: 'ما قدرت أسجّل القرار. يمكن انحسم من قبل، حدّث الصفحة' }); }
  await audit(cfg, user, `maestro_${act}`, { target: { approval: b.id } });
  return json(200, { ok: true });
}) };

// The owner's CRM diagnostic: counts, sums and dates only (health.ts), never a name, phone or lead id.
export const crm = { GET: handle(async (request, e: AuthEnv) => {
  const { cfg, user } = await requireUser(request, e, 'owner');
  return json(200, await crmFor(cfg, user.co), { 'cache-control': 'no-store' });
}) };

// «صحة الداتا»: freshness, counts, join rates, duplicates, orphans and missing migrations, one ?part= at a time
// (sources | content | counts | schema) so each request stays under Cloudflare's 50-subrequest free-plan limit. Owner only, read-only.
export const health = { GET: handle(async (request, e: AuthEnv & { FILES?: R2Bucket }) => {
  const { cfg, user } = await requireUser(request, e, 'owner');
  const part = new URL(request.url).searchParams.get('part') || '';
  if (!(PARTS as readonly string[]).includes(part)) return json(400, { error: 'طلب غير صحيح' });
  return json(200, await dataHealth(cfg, user.co, part as Part, e.FILES));
}) };
