// /api/automation/*: «تلقائي» (src/lib/automation.ts). Reading is for the owner and anyone with approve on control; every change is
// the owner's alone. Switching an agent on needs the managed list to exist; the spend cap can only go down from 2,500 SAR.
import { json, readJson, handle, requireUser, audit, isOwner, atLeast, type Session, type Cfg } from '../../lib/auth';
import { AUTO_AGENTS, AUTO_MAX_PCT, SPEND_CAP_SAR, loadAuto, loadManaged, saveAuto } from '../../lib/automation';
import { loadSettings } from '../../modules/buyer/exec/service';
import { sb } from '../../lib/auth';
import { WELL_COMPANY } from '../../lib/tenant';

const SETUP = 'الأتمتة تحتاج تجهيز القاعدة. بلّغ الإدارة.';
const ownerOnly = (user: Session, cfg: Cfg) => (isOwner(user, cfg) ? null : json(403, { error: 'تغيير الأتمتة للمالك بس' }));

export const settings = {
  GET: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'control', { well: true });
    if (!isOwner(user, cfg) && !atLeast(user, 'control', 'approve', cfg)) return json(403, { error: 'ما عندك صلاحية' });
    const [auto, managed, exec] = await Promise.all([loadAuto(cfg), loadManaged(cfg), loadSettings(cfg)]);
    return json(200, { auto, agents: AUTO_AGENTS, limits: { maxPct: AUTO_MAX_PCT, spendCapMax: SPEND_CAP_SAR }, managed: managed ?? [], missing: managed === null,
      kill: exec.kill, live: exec.live, owner: isOwner(user, cfg) });
  }),
  POST: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'control', { write: true, well: true });
    const no = ownerOnly(user, cfg); if (no) return no;
    const b = await readJson(request);
    if (b.on === true && (await loadManaged(cfg)) === null) return json(503, { error: SETUP });
    const r = await saveAuto(cfg, user.email, { agent: b.agent, on: b.on, spendCap: b.spendCap });
    if (r === 'bad') return json(400, { error: 'قيمة غير صحيحة' });
    await audit(cfg, user, 'auto_settings', { target: { agent: b.agent ?? null, on: b.on ?? null, spendCap: r.spendCap } });
    return json(200, { ok: true, auto: r });
  }),
};

const ID = /^[A-Za-z0-9_-]{1,64}$/;
export const managed = {
  POST: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'control', { write: true, well: true });
    const no = ownerOnly(user, cfg); if (no) return no;
    const b = await readJson(request);
    const platform = b.platform, level = b.level ?? 'campaign', id = String(b.entity_id ?? '').trim(), name = String(b.name ?? '').trim().slice(0, 200) || null;
    if ((platform !== 'meta' && platform !== 'snapchat') || (level !== 'campaign' && level !== 'adset') || !ID.test(id)) return json(400, { error: 'حدد المنصة ورقم الحملة' });
    const w = await sb(cfg, '/rest/v1/managed_campaigns?on_conflict=company_id,platform,entity_id', { method: 'POST', admin: true, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: { company_id: WELL_COMPANY, platform, level, entity_id: id, name, added_by: user.email } });
    if (!w.ok) return json(503, { error: SETUP });
    await audit(cfg, user, 'managed_added', { target: { platform, level, entity_id: id } });
    return json(200, { ok: true });
  }),
  DELETE: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'control', { write: true, well: true });
    const no = ownerOnly(user, cfg); if (no) return no;
    const b = await readJson(request);
    const platform = b.platform, id = String(b.entity_id ?? '');
    if ((platform !== 'meta' && platform !== 'snapchat') || !ID.test(id)) return json(400, { error: 'حدد المنصة ورقم الحملة' });
    await sb(cfg, `/rest/v1/managed_campaigns?company_id=eq.${WELL_COMPANY}&platform=eq.${platform}&entity_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', admin: true });
    await audit(cfg, user, 'managed_removed', { target: { platform, entity_id: id } });
    return json(200, { ok: true });
  }),
};
