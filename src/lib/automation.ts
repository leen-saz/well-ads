// «تلقائي» (docs/PRD.md §3.6, milestone M13; Q14 approved by Leen on 2026-11-20, spend cap 2,500 SAR on 2026-11-21).
// An agent switched to auto may apply its own proposal at once, but only when every one of these holds; otherwise the proposal
// stays an approval request, exactly as in «بموافقتي»:
//   - the owner switched this agent to auto (off by default) and the emergency stop is off;
//   - the entity is on the owner's managed list (managed_campaigns, 045);
//   - a budget change is at most AUTO_MAX_PCT (20%), never past the hard 50%;
//   - the day's expected spend (active managed daily budgets + this change) stays within the spend cap (2,500 SAR, lower only);
//   - every guard of the normal execution passes (live flag per platform, daily increase cap, 48-hour cooldown, read-back).
// Creating anything is never automatic (create_active stays off). A bad 7-day result of an auto action switches that agent back.
import { sb, audit, missingSchema, type Cfg, type Session } from './auth';
import { patchGuardrails } from './guardrails';
import { WELL_COMPANY } from './tenant';
import { adapterFor, apply, loadSettings, type Action, type Ctx as ExecCtx } from '../modules/buyer/exec/service';
import type { ExecEnv } from '../mcp/adapters/ads';
import { round2 } from '../modules/buyer/exec/guards';

export const AUTO_AGENTS = ['buyer'] as const;
export type Agent = (typeof AUTO_AGENTS)[number];
export const AUTO_MAX_PCT = 20;
export const SPEND_CAP_SAR = 2500;       // Leen, 2026-11-21: the ceiling; the owner may set a lower one, never a higher one
export interface Auto { on: Record<Agent, boolean>; spendCap: number }
export interface Managed { platform: 'meta' | 'snapchat'; level: 'campaign' | 'adset'; entity_id: string; name: string | null }
type Row = Record<string, unknown>;

export function cleanAuto(v: unknown): Auto {
  const g = (v && typeof v === 'object' ? v : {}) as Row;
  const on = (g.on && typeof g.on === 'object' ? g.on : {}) as Row;
  const cap = Number(g.spendCap);
  return { on: Object.fromEntries(AUTO_AGENTS.map(a => [a, on[a] === true])) as Record<Agent, boolean>, spendCap: Number.isFinite(cap) && cap > 0 ? Math.min(cap, SPEND_CAP_SAR) : SPEND_CAP_SAR };
}
export async function loadAuto(cfg: Cfg): Promise<Auto> {
  const r = await sb<{ guardrails?: Row }[]>(cfg, '/rest/v1/control_settings?platform=eq.global&select=guardrails', { admin: true });
  // A database that cannot be read must never look like "auto is on"
  if (!r.ok || !Array.isArray(r.data)) return cleanAuto({});
  return cleanAuto(r.data[0]?.guardrails?.auto);
}
export async function saveAuto(cfg: Cfg, by: string, patch: { agent?: unknown; on?: unknown; spendCap?: unknown }): Promise<Auto | 'bad'> {
  if (patch.agent !== undefined && !(AUTO_AGENTS as readonly string[]).includes(String(patch.agent))) return 'bad';
  if (patch.spendCap !== undefined) { const n = Number(patch.spendCap); if (!(n > 0) || !Number.isFinite(n)) return 'bad'; }
  const w = await patchGuardrails(cfg, 'global', g => {
    const cur = cleanAuto(g.auto);
    if (patch.agent !== undefined) cur.on[patch.agent as Agent] = patch.on === true;
    if (patch.spendCap !== undefined) cur.spendCap = Math.min(SPEND_CAP_SAR, Number(patch.spendCap));
    return { ...g, auto: cur };
  }, by);
  if (!w.ok) return 'bad';
  return loadAuto(cfg);
}

export async function loadManaged(cfg: Cfg, co = WELL_COMPANY): Promise<Managed[] | null> {
  const r = await sb<Managed[]>(cfg, `/rest/v1/managed_campaigns?company_id=eq.${co}&select=platform,level,entity_id,name&order=platform,name`, { admin: true });
  if (!r.ok) return missingSchema(r) ? null : [];
  return Array.isArray(r.data) ? r.data : [];
}

export type Why = 'off' | 'kill' | 'not_managed' | 'cap_pct' | 'spend_cap' | 'read_failed' | 'not_auto' | 'setup' | 'guard';
/** Pure: the expected spend of the day after this change, from the managed entities' live daily budgets. */
export function expectedSpend(live: { entity_id: string; budget: number | null; status: string }[], a: Pick<Action, 'entity_id' | 'change'>): number {
  let total = 0;
  for (const e of live) {
    let budget = e.budget ?? 0, active = e.status === 'active';
    if (e.entity_id === a.entity_id) {
      if (a.change.op === 'budget' && a.change.to != null) budget = a.change.to;
      if (a.change.op === 'status') active = a.change.to === 'active';
    }
    if (active) total += budget;
  }
  return round2(total);
}

/** Tries to apply an agent's fresh proposal on its own. Never throws; says why when it does not. */
export async function autoApply(cfg: Cfg, env: ExecEnv, agent: string, action: Action, now = Date.now()): Promise<{ applied: boolean; why?: Why; detail?: unknown }> {
  if (!(AUTO_AGENTS as readonly string[]).includes(agent)) return { applied: false, why: 'off' };
  const [auto, settings, managed] = await Promise.all([loadAuto(cfg), loadSettings(cfg), loadManaged(cfg)]);
  if (!auto.on[agent as Agent]) return { applied: false, why: 'off' };
  if (settings.kill) return { applied: false, why: 'kill' };
  if (managed === null) return { applied: false, why: 'setup' };
  if (action.status !== 'proposed' || action.mode !== 'auto' || action.change.op === 'manual') return { applied: false, why: 'not_auto' };
  const mine = managed.filter(m => m.platform === action.platform);
  if (!action.entity_id || !mine.some(m => m.entity_id === action.entity_id)) return { applied: false, why: 'not_managed' };
  const c = action.change;
  if (c.op === 'budget' && (c.pct == null || Math.abs(c.pct) > AUTO_MAX_PCT + 0.05)) return { applied: false, why: 'cap_pct', detail: AUTO_MAX_PCT };
  // The day's expected spend: read every managed entity of this platform live (the list is short), then add this change
  const adapter = adapterFor(action.platform, env);
  if (!adapter) return { applied: false, why: 'guard', detail: 'not_configured' };
  let live: { entity_id: string; budget: number | null; status: string }[];
  try { live = await Promise.all(mine.map(async m => { const e = await adapter.read(m.level, m.entity_id); return { entity_id: m.entity_id, budget: e?.budget ?? null, status: e?.status ?? 'other' }; })); }
  catch { return { applied: false, why: 'read_failed' }; }
  const grows = (c.op === 'budget' && (c.to ?? 0) > (c.from ?? 0)) || (c.op === 'status' && c.to === 'active');
  const spend = expectedSpend(live, action);
  if (grows && spend > auto.spendCap + 1e-9) return { applied: false, why: 'spend_cap', detail: { expected: spend, cap: auto.spendCap } };
  // The normal execution path, with what was proposed as what is expected: every guard and the read-back apply
  const user = { uid: '', email: `auto:${agent}`, name: `auto:${agent}`, role: 'member', dash: [], depts: [], co: WELL_COMPANY, exp: 0, chk: 0 } as unknown as Session;
  const ctx: ExecCtx = { cfg, user, env, now };
  const r = await apply(ctx, action.id, { confirm: true, mode: 'live', expect: c.op === 'budget' ? { from: c.from, to: c.to } : { from: c.from, to: c.to } });
  if (r.status === 200 && r.body.applied === true) return { applied: true };
  return { applied: false, why: 'guard', detail: r.body.code ?? r.status };
}

/** A bad 7-day result of an action applied in auto switches that agent back to «بموافقتي» and says so. Runs with the hourly learn task. */
export async function autoWatch(cfg: Cfg, alert: (subject: string, text: string) => Promise<unknown>, now = Date.now()): Promise<string[]> {
  const auto = await loadAuto(cfg);
  const on = AUTO_AGENTS.filter(a => auto.on[a]);
  if (!on.length) return [];
  const since = new Date(now - 14 * 864e5).toISOString();
  const r = await sb<{ action_id: string; result: string | null; buyer_actions?: { decided_by?: string | null } | null }[]>(cfg,
    `/rest/v1/buyer_outcomes?select=action_id,result,buyer_actions!inner(decided_by)&day=eq.7&result=eq.worse&measured_at=gte.${since}&buyer_actions.decided_by=like.auto:*`, { admin: true });
  if (!r.ok || !Array.isArray(r.data)) return [];
  const off: string[] = [];
  for (const agent of on) {
    const bad = r.data.filter(x => x.buyer_actions?.decided_by === `auto:${agent}`);
    if (!bad.length) continue;
    if ((await saveAuto(cfg, 'auto-watch', { agent, on: false })) === 'bad') continue;
    off.push(agent);
    await audit(cfg, { email: 'auto-watch', co: WELL_COMPANY }, 'auto_switched_off', { target: { agent, actions: bad.map(x => x.action_id).slice(0, 10) } });
    await alert('Well: «تلقائي» رجع «بموافقتي»', `إجراء نفّذه إيجنت ${agent} تلقائياً طلعت نتيجته أسوأ بعد 7 أيام، فرجّعناه «بموافقتي». راجع الإجراء من صفحة الأتمتة.`);
  }
  return off;
}
