// /api/buyer/{actions,propose,decide,apply,rollback,execution}: approval-gated execution on top of the media buyer's advice.
// Who may do what: anyone with the board sees the queue; proposing needs edit; deciding, applying and rolling back need APPROVE on
// the decisions board (Leen, or someone she gave approve) and the Well company; the stop line, the per-platform real-execution
// switch and the limits are the owner's. Every mutating call needs the same-origin check (requireUser write:true).
import { json, readJson, handle, requireUser, isOwner, notApplied } from '../../lib/auth';
import { configured, type ExecEnv } from './exec/adapters';
import { actionable, apply as applyAction, list, manualDone, propose as proposeAction, reject, rollback as rollbackAction, saveSettings, type Ctx, type Out } from './exec/service';
import { buildReport } from './report';

const send = (o: Out) => json(o.status, o.body);
const idOf = (b: Record<string, unknown>) => String(b.id ?? '');

export const actions = { GET: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'control');
  const env = e as unknown as ExecEnv;
  const r = await list({ cfg, user, env });
  const approver = (() => { try { return user.role === 'owner' || user.lvl?.control === 'approve'; } catch { return false; } })();
  return json(200, {
    missing: r.missing, ...(r.missing ? { message: notApplied(user, '032_buyer_actions.sql') } : {}),
    actions: r.actions, usedToday: r.usedToday,
    // booleans and limits only: never a key, never a key's name
    settings: { kill: r.settings.kill, maxPct: r.settings.maxPct, dailyCap: r.settings.dailyCap, live: r.settings.live, configured: configured(env) },
    can: { approve: approver, owner: isOwner(user, cfg) },
  });
}) };

// A recommendation becomes a proposed action. The server re-derives the recommendation from its own analysis by id: nothing
// about the action's content (platform, value, size) comes from the browser.
export const propose = { POST: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'control', { write: true, well: true });
  const body = await readJson(request);
  const built = await buildReport(cfg, user);
  if (!built.ok) return json(500, { error: 'ما قدرت أقرأ أرقام الإعلانات' });
  const ctx: Ctx = { cfg, user, env: e as unknown as ExecEnv };
  if (body.all === true) {
    const made: Record<string, unknown>[] = [];
    for (const rec of built.report.recs.filter(actionable).slice(0, 20)) made.push((await proposeAction(ctx, rec)).body);
    return json(200, { ok: true, count: made.length, made });
  }
  const rec = built.report.recs.find(r => r.id === String(body.rec_id ?? ''));
  if (!rec) return json(404, { error: 'التوصية ما لقيناها في التحليل الحالي', code: 'no_rec' });
  return send(await proposeAction(ctx, rec));
}) };

// Reject, or mark a manual action as done by hand. Approve-level only.
export const decide = { POST: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'control', { write: true, approve: true, well: true });
  const body = await readJson(request), ctx: Ctx = { cfg, user, env: e as unknown as ExecEnv };
  if (body.decision === 'reject') return send(await reject(ctx, idOf(body)));
  if (body.decision === 'manual_done') return send(await manualDone(ctx, idOf(body)));
  return json(400, { error: 'قيمة غير صحيحة' });
}) };

// «اعتمد وطبّق»: the only way anything reaches an ad platform. `confirm: true` is the modal's second confirmation, `expect` the
// figures the modal showed, `mode: 'live'` the explicit «تنفيذ حقيقي» (anything else is a dry run that writes nothing).
export const apply = { POST: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'control', { write: true, approve: true, well: true });
  const body = await readJson(request);
  return send(await applyAction({ cfg, user, env: e as unknown as ExecEnv }, idOf(body), { confirm: body.confirm, mode: body.mode, expect: (body.expect ?? undefined) as never }));
}) };

export const rollback = { POST: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'control', { write: true, approve: true, well: true });
  const body = await readJson(request);
  return send(await rollbackAction({ cfg, user, env: e as unknown as ExecEnv }, idOf(body), { confirm: body.confirm }));
}) };

// The emergency stop (any approver may press it; it is the same flag the old pipeline executor reads) and the owner's limits.
export const execution = { POST: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'control', { write: true, approve: true, well: true });
  const body = await readJson(request);
  return send(await saveSettings({ cfg, user, env: e as unknown as ExecEnv }, body as never, isOwner(user, cfg)));
}) };
