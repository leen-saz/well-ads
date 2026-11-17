// Approved execution: turning a recommendation into a proposed action, and running it only after the owner presses the button.
// Order of every real run: approval and second confirmation → guards → claim the row (idempotency) → read the platform's actual
// state → abort if it is not what the owner was shown → write → read it back → record. A dry run does everything up to the
// write and then stops: it never calls a platform with anything but a GET. Nothing here stores or returns a credential.
import { audit, missingSchema, sb, type Cfg, type Session } from '../../../lib/auth';
import { scoped } from '../../../lib/tenant';
import { patchGuardrails } from '../../../lib/guardrails';
import type { Rec } from '../buyer';
import { configured, PlatformError, type Adapter, type Entity, type ExecEnv } from './adapters';
import { cleanSettings, evaluate, idemKey, newBudget, pctOf, reachedTarget, round2, sameAsShown, type Block, type Change, type Level, type Plat, type Recent, type Settings } from './guards';
import { metaAdapter } from './meta';
import { snapAdapter } from './snap';

export const DB_KEY: Record<Plat, string> = { meta: 'meta', snapchat: 'snap', tiktok: 'tiktok', google: 'google' };
type Row = Record<string, unknown>;
export interface Action {
  id: string; created_at: string; created_by: string | null; platform: Plat; level: Level; entity_id: string | null; entity_name: string | null;
  rec_id: string | null; rec_rule: string | null; kind: string; change: Change; reason: string; risk: string | null; success: Row;
  mode: 'auto' | 'manual'; manual_why: string | null;
  status: 'proposed' | 'rejected' | 'applying' | 'applied' | 'failed' | 'aborted' | 'rolled_back' | 'manual_done';
  decided_by: string | null; decided_at: string | null; dry_run: Row | null; result: Row | null; applied_at: string | null; rolled_back_at: string | null;
}
export interface Ctx { cfg: Cfg; user: Session; env: ExecEnv; now?: number }
export interface Out { status: number; body: Record<string, unknown> }
const out = (status: number, body: Record<string, unknown>): Out => ({ status, body });

// Plain Arabic for each refusal; the page maps `code` to its own translated sentence, `error` is the fallback for any other client.
export const MSG: Record<string, string> = {
  confirm: 'التأكيد الثاني مطلوب', not_open: 'هذا الإجراء ما عاد مفتوح', manual: 'هذا الإجراء ينفّذ يدوياً', shown_changed: 'القيم تغيّرت عن اللي انعرض لك. حدّث الصفحة وراجعها',
  live_off: 'التنفيذ الحقيقي مقفل لهذي المنصة. التجربة بس متاحة', not_configured: 'مفتاح التنفيذ ما انضاف لهذي المنصة', gone: 'الكيان ما عاد موجود في المنصة',
  read_failed: 'ما قدرنا نقرأ الحالة الفعلية من المنصة، فما نفّذنا شي', changed: 'القيمة في المنصة تغيّرت عن اللي ظهر لك، فانلغى الإجراء', blocked: 'حاجز يمنع التنفيذ',
  kill: 'زر الطوارئ شغّال، التنفيذ موقوف لكل المنصات', write_failed: 'المنصة رفضت التغيير', verify_failed: 'ما تأكدنا من التغيير بعد التنفيذ، راجعه في المنصة',
  not_last: 'التراجع يكون لآخر إجراء منفّذ بس', changed_since: 'القيمة تغيّرت بعد التنفيذ، ما نتراجع فوقها', not_applied: 'هذا الإجراء ما انتفّذ عشان نتراجع عنه',
  no_previous: 'ما نعرف الحالة قبل التغيير، فما نتراجع تلقائياً. رجّعها يدوياً من المنصة',
  not_actionable: 'هذي التوصية ما تتحول لإجراء على الحساب', no_rec: 'التوصية ما لقيناها في التحليل الحالي', not_found: 'ما لقيت الإجراء', forbidden: 'لين بس تغيّر إعدادات التنفيذ',
};
const fail = (status: number, code: string, extra: Record<string, unknown> = {}): Out => out(status, { error: MSG[code] ?? 'ما تم', code, ...extra });

export const adapterFor = (p: Plat, env: ExecEnv): Adapter | null =>
  p === 'meta' && configured(env).meta ? metaAdapter(env) : p === 'snapchat' && configured(env).snapchat ? snapAdapter(env) : null;

// ---- settings and history -------------------------------------------------------------------------------------------------
export async function loadSettings(cfg: Cfg): Promise<Settings> {
  const r = await sb<{ platform: string; guardrails?: Row }[]>(cfg, '/rest/v1/control_settings?select=platform,guardrails', { admin: true });
  const rows = r.ok && Array.isArray(r.data) ? r.data : [];
  const g = rows.find(x => x.platform === 'global')?.guardrails ?? {};
  const per: Partial<Record<Plat, unknown>> = {};
  for (const p of ['meta', 'snapchat'] as const) per[p] = rows.find(x => x.platform === DB_KEY[p])?.guardrails?.exec;
  // A database that cannot be read must not look like "kill is off": the caller treats `unknown` as stop.
  const s = cleanSettings(g.exec, per, g.kill === true);
  if (!r.ok) s.kill = true;
  return s;
}

const ts = (v: unknown) => { const t = Date.parse(String(v ?? '')); return isFinite(t) ? t : 0; };
export async function loadRecent(cfg: Cfg, co: string, now: number): Promise<Recent[]> {
  const since = new Date(now - 49 * 3600e3).toISOString();
  const r = await sb<Action[]>(cfg, scoped(`/rest/v1/buyer_actions?select=platform,entity_id,change,applied_at,rolled_back_at,decided_at,status&or=(decided_at.gte.${since},applied_at.gte.${since},rolled_back_at.gte.${since})&status=in.(applied,rolled_back,applying,failed)`, co), { admin: true });
  const rows = r.ok && Array.isArray(r.data) ? r.data : [];
  const recent: Recent[] = [];
  for (const a of rows) {
    if (!a.entity_id) continue;
    const c = a.change, inc = c.op === 'budget' && c.from != null && c.to != null ? Math.max(0, round2(c.to - c.from)) : 0;
    // A write that reached the platform but could not be read back is marked `failed`, yet the change may well have happened:
    // it counts toward the cooldown and the daily cap like an applied one. Only a clear refusal by the platform (HTTP 4xx) means
    // nothing changed; a 5xx, a timeout or an unreadable result stays counted until someone looks at it.
    if (a.status === 'failed') {
      const res = (a.result ?? {}) as Row, code = String(res.code ?? '');
      if (!/^(meta_4\d\d_|snap_(auth_)?4\d\d$|snap_gone$)/.test(code)) recent.push({ platform: a.platform, entityId: a.entity_id, at: ts(res.at ?? a.decided_at), increase: inc });
      continue;
    }
    if (a.status === 'applying' && a.decided_at) recent.push({ platform: a.platform, entityId: a.entity_id, at: ts(a.decided_at), increase: inc });   // in flight counts as done
    if (a.applied_at) recent.push({ platform: a.platform, entityId: a.entity_id, at: ts(a.applied_at), increase: inc });
    if (a.rolled_back_at) recent.push({ platform: a.platform, entityId: a.entity_id, at: ts(a.rolled_back_at), increase: 0 });
  }
  return recent;
}
const one = async (cfg: Cfg, co: string, id: string): Promise<Action | null> => {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const r = await sb<Action[]>(cfg, scoped(`/rest/v1/buyer_actions?id=eq.${id}&select=*`, co), { admin: true });
  return r.ok && Array.isArray(r.data) ? r.data[0] ?? null : null;
};
// Moves a row from one status to another only if it still holds the expected one (the claim that makes a double click harmless)
async function move(cfg: Cfg, co: string, id: string, from: Action['status'], patch: Row): Promise<boolean> {
  const r = await sb<Action[]>(cfg, scoped(`/rest/v1/buyer_actions?id=eq.${id}&status=eq.${from}`, co), { method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' }, body: patch });
  return r.ok && Array.isArray(r.data) && r.data.length === 1;
}
const subject = (a: Action) => ({ platform: a.platform, entityId: a.entity_id, mode: a.mode, change: a.change });
const stateOf = (e: Entity) => ({ budget: e.budget, status: e.status });
const codes = (b: Block[]) => b.map(x => x.code);

export async function list(ctx: Ctx): Promise<{ actions: (Action & { guards: Record<string, unknown> })[]; settings: Settings; usedToday: number; missing: boolean }> {
  const now = ctx.now ?? Date.now(), co = ctx.user.co;
  const [r, settings, recent] = await Promise.all([
    sb<Action[]>(ctx.cfg, scoped('/rest/v1/buyer_actions?select=*&order=created_at.desc&limit=60', co), { admin: true }), loadSettings(ctx.cfg), loadRecent(ctx.cfg, co, now),
  ]);
  const rows = r.ok && Array.isArray(r.data) ? r.data : [];
  const actions = rows.map(a => {
    const v = evaluate(subject(a), settings, recent, now);
    return { ...a, guards: { blocks: v.blocks, live: v.live, impact: v.impact } };
  });
  return { actions, settings, missing: missingSchema(r), usedToday: evaluate({ platform: 'meta', entityId: 'x', mode: 'auto', change: { op: 'status', from: 'active', to: 'paused' } }, settings, recent, now).impact.dailyUsed };
}

// ---- propose --------------------------------------------------------------------------------------------------------------
// A recommendation is proposable when it carries a structured operation (budget step, status) or is a budget shift (shown for hand work).
export const actionable = (r: Rec): boolean => !!r.act || r.kind === 'shift_budget';

type Why = 'platform_manual' | 'no_structure' | 'not_configured' | 'campaign_unknown' | 'not_found' | 'ambiguous' | 'no_budget_entity' | 'read_failed';
type Resolved = { ok: true; level: Level; entity: Entity } | { ok: false; why: Why };

async function resolve(a: Adapter | null, rec: Rec): Promise<Resolved> {
  if (rec.platform === 'tiktok' || rec.platform === 'google') return { ok: false, why: 'platform_manual' };
  if (!rec.act) return { ok: false, why: 'no_structure' };
  if (!a) return { ok: false, why: 'not_configured' };
  if (!rec.campaign) return { ok: false, why: 'campaign_unknown' };
  try {
    const found = await a.findCampaigns(rec.campaign);
    if (found.length === 0) return { ok: false, why: 'not_found' };
    if (found.length > 1) return { ok: false, why: 'ambiguous' };   // never guess between two campaigns with one name
    const camp = found[0] as Entity;
    if (rec.act.op === 'status') return { ok: true, level: 'campaign', entity: camp };
    if (camp.budget != null) return { ok: true, level: 'campaign', entity: camp };
    const sets = await a.budgetedAdsets(camp.id);
    return sets.length === 1 ? { ok: true, level: 'adset', entity: sets[0] as Entity } : { ok: false, why: 'no_budget_entity' };
  } catch (e) { if (e instanceof PlatformError) return { ok: false, why: 'read_failed' }; throw e; }
}

export async function propose(ctx: Ctx, rec: Rec): Promise<Out> {
  if (!actionable(rec)) return fail(422, 'not_actionable');
  const now = ctx.now ?? Date.now();
  const res = await resolve(adapterFor(rec.platform, ctx.env), rec);
  let level: Level = 'campaign', entity: Entity | null = null, change: Change, mode: 'auto' | 'manual' = 'auto', why: Why | null = null;
  if (res.ok && rec.act) {
    level = res.level; entity = res.entity;
    if (rec.act.op === 'budget_pct') {
      const from = entity.budget as number, to = newBudget(from, rec.act.pct);
      change = { op: 'budget', from, to, pct: pctOf(from, to) };
    } else change = { op: 'status', from: entity.status === 'other' ? null : entity.status, to: rec.act.to };
  } else {
    mode = 'manual'; why = res.ok ? 'no_structure' : res.why;
    change = rec.act?.op === 'budget_pct' ? { op: 'budget', from: null, to: null, pct: rec.act.pct }
      : rec.act?.op === 'status' ? { op: 'status', from: null, to: rec.act.to } : { op: 'manual', text: rec.change };
  }
  const key = idemKey({ platform: rec.platform, level, entityId: entity?.id ?? null, change, recId: rec.id }, now);
  const row = {
    company_id: ctx.user.co, created_by: ctx.user.email, platform: rec.platform, level, entity_id: entity?.id ?? null, entity_name: entity?.name ?? rec.campaign,
    rec_id: rec.id, rec_rule: rec.rule, kind: rec.kind, change, reason: rec.why, risk: rec.risk, success: rec.success, mode, manual_why: why, idem_key: key,
  };
  const w = await sb<Action[]>(ctx.cfg, '/rest/v1/buyer_actions', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' }, body: row });
  if (w.status === 409) return out(200, { ok: true, existing: true });   // the same change is already open today: one row, never two
  if (!w.ok || !Array.isArray(w.data) || !w.data[0]) return out(500, { error: 'ما انحفظ الإجراء', code: 'save_failed' });
  const a = w.data[0];
  await audit(ctx.cfg, ctx.user, 'buyer_proposed', { target: { id: a.id, platform: rec.platform, level, entity_id: entity?.id ?? null, rule: rec.rule, mode }, after: { change } });
  return out(200, { ok: true, id: a.id, mode, ...(why ? { manual_why: why } : {}) });
}

// ---- decide ---------------------------------------------------------------------------------------------------------------
export async function reject(ctx: Ctx, id: string): Promise<Out> {
  const a = await one(ctx.cfg, ctx.user.co, id); if (!a) return fail(404, 'not_found');
  if (!await move(ctx.cfg, ctx.user.co, id, 'proposed', { status: 'rejected', decided_by: ctx.user.email, decided_at: new Date().toISOString() })) return fail(409, 'not_open', { status: a.status });
  await audit(ctx.cfg, ctx.user, 'buyer_rejected', { target: { id, platform: a.platform, level: a.level, entity_id: a.entity_id } });
  return out(200, { ok: true });
}
// The owner did a manual action by hand (TikTok, Google, an entity we could not pin down): recorded, not executed by us.
export async function manualDone(ctx: Ctx, id: string): Promise<Out> {
  const a = await one(ctx.cfg, ctx.user.co, id); if (!a) return fail(404, 'not_found');
  if (a.mode !== 'manual') return fail(409, 'not_open');
  if (!await move(ctx.cfg, ctx.user.co, id, 'proposed', { status: 'manual_done', decided_by: ctx.user.email, decided_at: new Date().toISOString() })) return fail(409, 'not_open', { status: a.status });
  await audit(ctx.cfg, ctx.user, 'buyer_manual_done', { target: { id, platform: a.platform, level: a.level, entity_id: a.entity_id } });
  return out(200, { ok: true });
}

// ---- apply ----------------------------------------------------------------------------------------------------------------
export interface ApplyBody { confirm?: unknown; mode?: unknown; expect?: { from?: unknown; to?: unknown } }
const same = (a: unknown, b: unknown) => (a == null && b == null) || String(a) === String(b);

export async function apply(ctx: Ctx, id: string, body: ApplyBody): Promise<Out> {
  // The second confirmation: the modal sends it, nothing else does
  if (body.confirm !== true) return fail(400, 'confirm');
  const { cfg, user } = ctx, now = ctx.now ?? Date.now();
  const a = await one(cfg, user.co, id); if (!a) return fail(404, 'not_found');
  if (a.status !== 'proposed') return fail(409, 'not_open', { status: a.status });
  if (a.mode === 'manual' || a.change.op === 'manual') return fail(409, 'manual');
  // What the owner saw in the modal is what runs: a different from/to is refused, never adjusted
  const c = a.change;
  if (!body.expect || !(c.op === 'status' ? same(body.expect.from, c.from) && same(body.expect.to, c.to) : c.op === 'budget' && same(body.expect.from, c.from) && same(body.expect.to, c.to))) return fail(409, 'shown_changed');

  const want: 'live' | 'dry' = body.mode === 'live' ? 'live' : 'dry';   // dry-run unless «تنفيذ حقيقي» is chosen
  const [settings, recent] = await Promise.all([loadSettings(cfg), loadRecent(cfg, user.co, now)]);
  const v = evaluate(subject(a), settings, recent, now);
  if (want === 'live' && !v.live) return fail(409, 'live_off');
  const adapter = adapterFor(a.platform, ctx.env);
  if (!adapter || !a.entity_id) return fail(409, 'not_configured');

  // The actual state, read from the platform itself (a GET: safe in a dry run too)
  let entity: Entity | null;
  try { entity = await adapter.read(a.level, a.entity_id); } catch (e) { return fail(502, 'read_failed', { detail: e instanceof PlatformError ? e.code : 'error' }); }
  if (!entity) return fail(409, 'gone');
  const fresh = sameAsShown(c, entity);

  if (want === 'dry') {
    const report = { at: new Date(now).toISOString(), by: user.email, blocks: codes(v.blocks), stale: !fresh, live_state: stateOf(entity), would: c, impact: v.impact };
    await move(cfg, user.co, id, 'proposed', { dry_run: report });   // still proposed: a preview changes nothing
    await audit(cfg, user, 'buyer_dry_run', { target: { id, platform: a.platform, level: a.level, entity_id: a.entity_id }, before: stateOf(entity), after: { change: c }, result: { blocks: codes(v.blocks), stale: !fresh, wrote: false } });
    return out(200, { ok: true, dry: true, wrote: false, ...report });
  }

  if (!v.ok) {
    await audit(cfg, user, 'buyer_blocked', { target: { id, platform: a.platform, level: a.level, entity_id: a.entity_id }, result: { blocks: codes(v.blocks) } });
    return fail(409, v.blocks.some(b => b.code === 'kill') ? 'kill' : 'blocked', { blocks: v.blocks });
  }
  // Claim the row: from here a second click or a retry finds it taken
  if (!await move(cfg, user.co, id, 'proposed', { status: 'applying', decided_by: user.email, decided_at: new Date(now).toISOString() })) return fail(409, 'not_open');
  if (!fresh) {
    await move(cfg, user.co, id, 'applying', { status: 'aborted', result: { live_state: stateOf(entity), at: new Date(now).toISOString(), reason: 'changed' } });
    await audit(cfg, user, 'buyer_aborted', { target: { id, platform: a.platform, level: a.level, entity_id: a.entity_id }, before: stateOf(entity), after: { shown: c }, note: 'changed' });
    return fail(409, 'changed', { live_state: stateOf(entity) });
  }
  // The emergency stop may have been pressed while this request was running, and another approval may have used the day's room or
  // the entity's cooldown since `recent` was read: read both again now that this row is claimed (an in-flight `applying` row of
  // another action is counted by loadRecent; this row is left out of its own tally) and check once more right before the write.
  const [latest, again] = await Promise.all([loadSettings(cfg), loadRecent(cfg, user.co, now)]);
  if (latest.kill) {
    await move(cfg, user.co, id, 'applying', { status: 'proposed' });
    return fail(409, 'kill');
  }
  const mine = again.filter(r => !(r.platform === a.platform && r.entityId === a.entity_id && r.at === ts(new Date(now).toISOString())));
  const v2 = evaluate(subject(a), latest, mine, now);
  if (!v2.ok) {
    await move(cfg, user.co, id, 'applying', { status: 'proposed' });
    await audit(cfg, user, 'buyer_blocked', { target: { id, platform: a.platform, level: a.level, entity_id: a.entity_id }, result: { blocks: codes(v2.blocks), recheck: true } });
    return fail(409, 'blocked', { blocks: v2.blocks });
  }
  return write(ctx, a, adapter, entity, c, 'applied');
}

async function write(ctx: Ctx, a: Action, adapter: Adapter, before: Entity, c: Change, kind: 'applied' | 'rolled_back'): Promise<Out> {
  const { cfg, user } = ctx, now = ctx.now ?? Date.now(), id = a.id, at = new Date(now).toISOString();
  const target = { id, platform: a.platform, level: a.level, entity_id: a.entity_id };
  const back = kind === 'rolled_back';
  const goal: Change = back ? (c.op === 'budget' ? { ...c, to: c.from, from: c.to } : c.op === 'status' ? { op: 'status', from: c.to, to: c.from ?? 'active' } : c) : c;
  let code: string | null = null, after: Entity | null = null;
  try {
    if (goal.op === 'budget' && goal.to != null) await adapter.setBudget(a.level, a.entity_id as string, goal.to);
    else if (goal.op === 'status') await adapter.setStatus(a.level, a.entity_id as string, goal.to);
    else code = 'write_failed';
  } catch (e) { code = e instanceof PlatformError ? e.code : 'write_failed'; }
  try { after = await adapter.read(a.level, a.entity_id as string); } catch { /* read-back failed: reported below */ }
  const ok = !code && !!after && reachedTarget(goal, after);
  if (ok) {
    await move(cfg, user.co, id, 'applying', back
      ? { status: 'rolled_back', rolled_back_at: at, rolled_back_by: user.email }
      : { status: 'applied', applied_at: at, result: { before: stateOf(before), after: after ? stateOf(after) : null, at, by: user.email } });
    await audit(cfg, user, back ? 'buyer_rolled_back' : 'buyer_applied', { target, before: stateOf(before), after: after ? stateOf(after) : null, result: { ok: true } });
    return out(200, { ok: true, applied: !back, rolled_back: back, before: stateOf(before), after: after ? stateOf(after) : null });
  }
  // Failed or not verifiable: the outcome is recorded as it is read back, never assumed
  const failCode = code ?? 'verify_failed';
  await move(cfg, user.co, id, 'applying', back ? { status: 'applied' } : { status: 'failed', result: { before: stateOf(before), after: after ? stateOf(after) : null, at, code: failCode } });
  await audit(cfg, user, back ? 'buyer_rollback_failed' : 'buyer_failed', { target, before: stateOf(before), after: after ? stateOf(after) : null, note: failCode, result: { ok: false } });
  return fail(502, code ? 'write_failed' : 'verify_failed', { detail: failCode, after: after ? stateOf(after) : null });
}

// ---- rollback: the last applied action only ---------------------------------------------------------------------------------
export async function rollback(ctx: Ctx, id: string, body: { confirm?: unknown }): Promise<Out> {
  if (body.confirm !== true) return fail(400, 'confirm');
  const { cfg, user } = ctx;
  const a = await one(cfg, user.co, id); if (!a) return fail(404, 'not_found');
  if (a.status !== 'applied' || a.change.op === 'manual') return fail(409, 'not_applied');
  const last = await sb<Action[]>(cfg, scoped('/rest/v1/buyer_actions?select=id&status=eq.applied&order=applied_at.desc&limit=1', user.co), { admin: true });
  if (!last.ok || !Array.isArray(last.data) || last.data[0]?.id !== id) return fail(409, 'not_last');
  const settings = await loadSettings(cfg);
  if (settings.kill) return fail(409, 'kill');
  if (!(a.platform === 'meta' || a.platform === 'snapchat') || !settings.live[a.platform]) return fail(409, 'live_off');
  const adapter = adapterFor(a.platform, ctx.env);
  if (!adapter || !a.entity_id) return fail(409, 'not_configured');
  let entity: Entity | null;
  try { entity = await adapter.read(a.level, a.entity_id); } catch (e) { return fail(502, 'read_failed', { detail: e instanceof PlatformError ? e.code : 'error' }); }
  if (!entity) return fail(409, 'gone');
  // Only undo what we did: if someone changed it since, the rollback would overwrite their change
  if (!reachedTarget(a.change, entity)) return fail(409, 'changed_since', { live_state: stateOf(entity) });
  // A rollback restores the earlier value, so it needs to know it. With no known earlier status it would guess «active»: refused, done by hand.
  const c = a.change;
  if (c.op === 'status' && c.from == null) return fail(409, 'no_previous');
  // Undoing a budget DECREASE raises the budget: that goes through the same limits as any increase (percent step and daily room).
  // The cooldown does not apply: a rollback restores.
  if (c.op === 'budget' && c.from != null && c.to != null && c.from > c.to) {
    const back: Change = { op: 'budget', from: c.to, to: c.from, pct: pctOf(c.to, c.from) };
    const v = evaluate(subject({ ...a, change: back }), settings, await loadRecent(cfg, user.co, ctx.now ?? Date.now()), ctx.now ?? Date.now());
    const blocks = v.blocks.filter(b => b.code !== 'cooldown');
    if (blocks.length) return fail(409, 'blocked', { blocks });
  }
  if (!await move(cfg, user.co, id, 'applied', { status: 'applying' })) return fail(409, 'not_open');
  return write(ctx, a, adapter, entity, a.change, 'rolled_back');
}

// ---- settings (the emergency stop, the per-platform real-execution switch, the limits) ------------------------------------------
export interface SettingsPatch { kill?: unknown; maxPct?: unknown; dailyCap?: unknown; live?: { platform?: unknown; on?: unknown } }
export async function saveSettings(ctx: Ctx, patch: SettingsPatch, owner: boolean): Promise<Out> {
  const { cfg, user } = ctx;
  const touchesMore = patch.maxPct !== undefined || patch.dailyCap !== undefined || patch.live !== undefined || patch.kill === false;
  if (touchesMore && !owner) return fail(403, 'forbidden');   // anyone with approval may press the stop; only the owner lifts it or loosens anything
  const before = await loadSettings(cfg);
  // Validate everything first, so nothing is half-saved on a bad value
  let maxPct: number | undefined, dailyCap: number | null | undefined;
  if (patch.maxPct !== undefined) { const n = Number(patch.maxPct); if (!(n > 0) || !isFinite(n)) return out(400, { error: 'قيمة غير صحيحة', code: 'bad_value' }); maxPct = Math.min(50, n); }
  if (patch.dailyCap !== undefined) {
    if (patch.dailyCap === null) dailyCap = null;
    else { const n = Number(patch.dailyCap); if (!(n > 0) || !isFinite(n)) return out(400, { error: 'قيمة غير صحيحة', code: 'bad_value' }); dailyCap = n; }
  }
  let livePlat: 'meta' | 'snapchat' | null = null, on = false;
  if (patch.live) {
    const p = patch.live.platform;
    if (p !== 'meta' && p !== 'snapchat') return out(400, { error: 'قيمة غير صحيحة', code: 'bad_value' });
    on = patch.live.on === true;
    if (on && !configured(ctx.env)[p]) return fail(409, 'not_configured');   // no real execution on a platform without its key
    livePlat = p;
  }
  // Each write changes only the keys named here, on top of the row as it is now: a stop pressed by someone else while the owner
  // saves limits is never put back to «off» by this save.
  const touchedGlobal = typeof patch.kill === 'boolean' || maxPct !== undefined || dailyCap !== undefined;
  if (touchedGlobal) {
    const w = await patchGuardrails(cfg, 'global', g => {
      const ex = { ...((g.exec as Row | undefined) ?? {}) };
      if (maxPct !== undefined) ex.maxPct = maxPct;
      if (dailyCap === null) delete ex.dailyCap; else if (dailyCap !== undefined) ex.dailyCap = dailyCap;
      const next: Row = { ...g };
      if (typeof patch.kill === 'boolean') next.kill = patch.kill;
      if (maxPct !== undefined || dailyCap !== undefined) next.exec = ex;
      return next;
    }, user.email);
    if (!w.ok) return out(500, { error: 'ما انحفظ', code: 'save_failed' });
  }
  if (livePlat) {
    const w = await patchGuardrails(cfg, DB_KEY[livePlat], g => ({ ...g, exec: { ...((g.exec as Row | undefined) ?? {}), live: on } }), user.email);
    if (!w.ok) return out(500, { error: 'ما انحفظ', code: 'save_failed' });
  }
  const after = await loadSettings(cfg);
  await audit(cfg, user, typeof patch.kill === 'boolean' && Object.keys(patch).length === 1 ? (patch.kill ? 'buyer_kill_on' : 'buyer_kill_off') : 'buyer_exec_settings', { target: { scope: 'exec' }, before, after });
  return out(200, { ok: true, settings: after });
}
