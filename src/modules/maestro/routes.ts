// /api/maestro/*: the maestro tab. Agents, tasks and pending approvals of the user's company, from Paperclip.
// Connecting a company to Paperclip is owner-only; creating tasks needs edit and deciding approvals needs approve on `maestro`.
import { sb, json, readJson, handle, requireUser, audit, isOwner, atLeast, notEnabled, type AuthEnv, type Cfg } from '../../lib/auth';
import { client, cleanTask, STATUS, withBrief, type PcEnv } from './paperclip';
import { knowledgeFor } from '../knowledge/knowledge';

type Env = AuthEnv & PcEnv;
type Co = { id: string; name: string; paperclip_company_id: string | null };

async function companyOf(cfg: Cfg, co: string): Promise<Co | null> {
  const r = await sb<Co[]>(cfg, `/rest/v1/companies?id=eq.${co}&select=id,name,paperclip_company_id`, { admin: true });
  return r.ok && Array.isArray(r.data) ? r.data[0] || null : null;
}
const notSet = (user?: { role: string }) => json(503, { error: notEnabled(user, 'المايسترو', 'PAPERCLIP_URL و PAPERCLIP_TOKEN'), setup: true });

export const state = { GET: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'maestro');
  const pc = client(e);
  if (!pc) return notSet(user);
  const c = await companyOf(cfg, user.co);
  if (!c?.paperclip_company_id) return json(200, { connected: false, owner: isOwner(user, cfg), statuses: STATUS });
  let agents: unknown[] = [], issues: unknown[] = [], approvals: unknown[] = [];
  try { [agents, issues, approvals] = await Promise.all([pc.agents(c.paperclip_company_id), pc.issues(c.paperclip_company_id), pc.approvals(c.paperclip_company_id)]); }
  catch (err) { console.error('maestro_state_failed', (err as Error).message); return json(502, { error: 'المايسترو مو متاح الحين، جرّب بعد شوي' }); }
  return json(200, { connected: true, owner: isOwner(user, cfg), canApprove: atLeast(user, 'maestro', 'approve', cfg), canEdit: atLeast(user, 'maestro', 'edit', cfg), statuses: STATUS, agents, issues, approvals });
}) };

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
  if (!c?.paperclip_company_id) return json(409, { error: 'اربط الشركة بالمايسترو أول' });
  // The agents run in Paperclip: the company's knowledge goes with each task so they write by it
  const issue = await pc.createIssue(c.paperclip_company_id, { ...t, description: withBrief(`${t.description}\n\n— طلبها ${user.email} من لوحة Well`, await knowledgeFor(cfg, user.co, 'maestro')) });
  await audit(cfg, user, 'maestro_task', { target: { issue: issue.id, title: t.title, agent: t.assigneeAgentId || null } });
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
  if (!c?.paperclip_company_id) return json(409, { error: 'اربط الشركة بالمايسترو أول' });
  try { await pc.decide(c.paperclip_company_id, String(b.id || ''), act); } catch (err) { return json(404, { error: (err as Error).message }); }
  await audit(cfg, user, `maestro_${act}`, { target: { approval: b.id } });
  return json(200, { ok: true });
}) };
