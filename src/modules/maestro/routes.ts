// /api/maestro/*: the maestro tab. Agents, tasks and pending approvals of the user's company, from Paperclip.
// Connecting a company to Paperclip is owner-only; creating tasks needs edit and deciding approvals needs approve on `maestro`.
import { sb, json, readJson, handle, requireUser, audit, isOwner, atLeast, type AuthEnv, type Cfg } from '../../lib/auth';
import { client, cleanTask, STATUS, type PcEnv } from './paperclip';

type Env = AuthEnv & PcEnv;
type Co = { id: string; name: string; paperclip_company_id: string | null };

async function companyOf(cfg: Cfg, co: string): Promise<Co | null> {
  const r = await sb<Co[]>(cfg, `/rest/v1/companies?id=eq.${co}&select=id,name,paperclip_company_id`, { admin: true });
  return r.ok && Array.isArray(r.data) ? r.data[0] || null : null;
}
const notSet = () => json(503, { error: 'المايسترو (Paperclip) مو مربوط بالسيرفر للحين', setup: true });

export const state = { GET: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'maestro');
  const pc = client(e);
  if (!pc) return notSet();
  const c = await companyOf(cfg, user.co);
  if (!c?.paperclip_company_id) return json(200, { connected: false, owner: isOwner(user, cfg), statuses: STATUS });
  const [agents, issues, approvals] = await Promise.all([pc.agents(c.paperclip_company_id), pc.issues(c.paperclip_company_id), pc.approvals(c.paperclip_company_id)]);
  return json(200, { connected: true, owner: isOwner(user, cfg), canApprove: atLeast(user, 'maestro', 'approve', cfg), canEdit: atLeast(user, 'maestro', 'edit', cfg), statuses: STATUS, agents, issues, approvals });
}) };

export const connect = { POST: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'owner', { write: true });
  const pc = client(e);
  if (!pc) return notSet();
  const c = await companyOf(cfg, user.co);
  if (!c) return json(404, { error: 'شركة غير معروفة' });
  if (c.paperclip_company_id) return json(200, { ok: true, id: c.paperclip_company_id });
  const made = await pc.createCompany(c.name);
  const id = String(made.id || '');
  if (!id) return json(502, { error: 'Paperclip ما رجّع رقم الشركة' });
  const r = await sb(cfg, `/rest/v1/companies?id=eq.${user.co}&paperclip_company_id=is.null`, { method: 'PATCH', admin: true, body: { paperclip_company_id: id } });
  if (!r.ok) return json(500, { error: 'ما انحفظ الربط' });
  await audit(cfg, user, 'maestro_connected', { target: { paperclip_company_id: id } });
  return json(200, { ok: true, id });
}) };

export const task = { POST: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'maestro', { write: true });
  const pc = client(e);
  if (!pc) return notSet();
  const t = cleanTask(await readJson(request));
  if (!t) return json(400, { error: 'اكتب عنوان المهمة' });
  const c = await companyOf(cfg, user.co);
  if (!c?.paperclip_company_id) return json(409, { error: 'اربط الشركة بالمايسترو أول' });
  const issue = await pc.createIssue(c.paperclip_company_id, { ...t, description: `${t.description}\n\n— طلبها ${user.email} من لوحة Well` });
  await audit(cfg, user, 'maestro_task', { target: { issue: issue.id, title: t.title, agent: t.assigneeAgentId || null } });
  return json(200, { ok: true, issue });
}) };

export const approval = { POST: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'maestro', { write: true, approve: true });
  const pc = client(e);
  if (!pc) return notSet();
  const b = await readJson(request);
  const act = b.action === 'approve' ? 'approve' : b.action === 'reject' ? 'reject' : null;
  if (!act) return json(400, { error: 'طلب غير صحيح' });
  const c = await companyOf(cfg, user.co);
  if (!c?.paperclip_company_id) return json(409, { error: 'اربط الشركة بالمايسترو أول' });
  try { await pc.decide(c.paperclip_company_id, String(b.id || ''), act); } catch (err) { return json(404, { error: (err as Error).message }); }
  await audit(cfg, user, `maestro_${act}`, { target: { approval: b.id } });
  return json(200, { ok: true });
}) };
