// /api/automation/*: «تلقائي» (src/lib/automation.ts). Reading is for the owner and anyone with approve on control; every change is
// the owner's alone. Auto works on every campaign except the owner's exclusions; the spend cap can only go down from 2,500 SAR.
// Switching an agent on is one step: it also turns real execution on for the platforms whose write keys are set (enableExecution).
import { json, readJson, handle, requireUser, audit, isOwner, atLeast, type Session, type Cfg } from '../../lib/auth';
import { AUTO_AGENTS, AUTO_MAX_PCT, SPEND_CAP_SAR, enableExecution, loadAuto, loadExcluded, saveAuto } from '../../lib/automation';
import { configured, type ExecEnv } from '../../mcp/adapters/ads';
import { loadSettings } from '../../modules/buyer/exec/service';
import { sb } from '../../lib/auth';
import { WELL_COMPANY } from '../../lib/tenant';

const SETUP = 'الأتمتة تحتاج تجهيز القاعدة. بلّغ الإدارة.';
const ownerOnly = (user: Session, cfg: Cfg) => (isOwner(user, cfg) ? null : json(403, { error: 'تغيير الأتمتة للمالك بس' }));

export const settings = {
  GET: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'control', { well: true });
    if (!isOwner(user, cfg) && !atLeast(user, 'control', 'approve', cfg)) return json(403, { error: 'ما عندك صلاحية' });
    const [auto, excluded, exec] = await Promise.all([loadAuto(cfg), loadExcluded(cfg), loadSettings(cfg)]);
    return json(200, { auto, agents: AUTO_AGENTS, limits: { maxPct: AUTO_MAX_PCT, spendCapMax: SPEND_CAP_SAR }, excluded: excluded ?? [], missing: excluded === null,
      kill: exec.kill, live: exec.live, keys: configured(e as unknown as ExecEnv), owner: isOwner(user, cfg) });
  }),
  POST: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'control', { write: true, well: true });
    const no = ownerOnly(user, cfg); if (no) return no;
    const b = await readJson(request);
    if (b.on === true && (await loadExcluded(cfg)) === null) return json(503, { error: SETUP });
    const r = await saveAuto(cfg, user.email, { agent: b.agent, on: b.on, spendCap: b.spendCap });
    if (r === 'bad') return json(400, { error: 'قيمة غير صحيحة' });
    const ex = b.on === true ? await enableExecution(cfg, e as unknown as ExecEnv, user.email, r.spendCap) : null;
    await audit(cfg, user, 'auto_settings', { target: { agent: b.agent ?? null, on: b.on ?? null, spendCap: r.spendCap, live: ex?.live ?? null } });
    return json(200, { ok: true, auto: r, ...(ex ? { live: ex.live } : {}) });
  }),
};

const ID = /^[A-Za-z0-9_-]{1,64}$/;
// Campaigns «تلقائي» must leave alone (everything else is in scope)
export const excluded = {
  POST: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'control', { write: true, well: true });
    const no = ownerOnly(user, cfg); if (no) return no;
    const b = await readJson(request);
    const platform = b.platform, id = String(b.entity_id ?? '').trim(), name = String(b.name ?? '').trim().slice(0, 200) || null;
    if ((platform !== 'meta' && platform !== 'snapchat') || !ID.test(id)) return json(400, { error: 'حدد المنصة ورقم الحملة' });
    const w = await sb(cfg, '/rest/v1/auto_exclusions?on_conflict=company_id,platform,entity_id', { method: 'POST', admin: true, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: { company_id: WELL_COMPANY, platform, entity_id: id, name, added_by: user.email } });
    if (!w.ok) return json(503, { error: SETUP });
    await audit(cfg, user, 'auto_excluded', { target: { platform, entity_id: id } });
    return json(200, { ok: true });
  }),
  DELETE: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'control', { write: true, well: true });
    const no = ownerOnly(user, cfg); if (no) return no;
    const b = await readJson(request);
    const platform = b.platform, id = String(b.entity_id ?? '');
    if ((platform !== 'meta' && platform !== 'snapchat') || !ID.test(id)) return json(400, { error: 'حدد المنصة ورقم الحملة' });
    await sb(cfg, `/rest/v1/auto_exclusions?company_id=eq.${WELL_COMPANY}&platform=eq.${platform}&entity_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', admin: true });
    await audit(cfg, user, 'auto_included', { target: { platform, entity_id: id } });
    return json(200, { ok: true });
  }),
};
