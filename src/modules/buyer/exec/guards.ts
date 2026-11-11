// Approved execution, the guards. Pure: no network, no database, no clock of its own (the caller passes `now`).
// Every rule here is mandatory: an action that fails one is refused, whoever approved it. The numbers are limits, not business
// data; the defaults are conservative and the owner can only tighten or loosen them inside the hard ceilings below.
export type Plat = 'meta' | 'snapchat' | 'tiktok' | 'google';
export type Level = 'campaign' | 'adset' | 'ad';
export type Status = 'active' | 'paused';
// A budget is the DAILY budget in the account's currency (major units, two decimals). A status is what the entity is set to.
// `manual` is advice the executor cannot apply (a placement shift, TikTok, Google): shown with its details, done by hand.
export type Change = { op: 'budget'; from: number | null; to: number | null; pct: number } | { op: 'status'; from: Status | null; to: Status } | { op: 'manual'; text: string };

export const DEFAULT_MAX_PCT = 20;        // the largest budget change one action may make, in percent of the current value
export const HARD_MAX_PCT = 50;           // the owner can raise the limit, never past this
export const COOLDOWN_HOURS = 48;         // one change per entity in this window (a rollback is exempt: it restores)
export const SAME_VALUE_TOLERANCE = 0.005; // the live budget may differ from the shown one by half a percent (rounding on the platform)

export type BlockCode = 'kill' | 'manual' | 'no_change' | 'bad_value' | 'cap_pct' | 'cap_daily' | 'no_daily_cap' | 'cooldown';
export interface Block { code: BlockCode; detail?: number | string }

export interface Settings {
  kill: boolean;
  maxPct: number;
  dailyCap: number | null;                // total daily-budget INCREASE the executor may add per day, all platforms; null = not set = no real execution
  live: Record<Plat, boolean>;            // «تنفيذ حقيقي» per platform; false = dry-run only
}
export const defaultSettings = (): Settings => ({ kill: false, maxPct: DEFAULT_MAX_PCT, dailyCap: null, live: { meta: false, snapchat: false, tiktok: false, google: false } });

// Reads the saved shape (control_settings.guardrails.exec) defensively: anything odd falls back to the safe default.
export function cleanSettings(global: unknown, perPlatform: Partial<Record<Plat, unknown>>, kill: boolean): Settings {
  const s = defaultSettings(); s.kill = !!kill;
  const g = (global && typeof global === 'object' ? global : {}) as Record<string, unknown>;
  const mp = Number(g.maxPct); if (isFinite(mp) && mp > 0) s.maxPct = Math.min(HARD_MAX_PCT, mp);
  const dc = Number(g.dailyCap); if (g.dailyCap != null && g.dailyCap !== '' && isFinite(dc) && dc > 0) s.dailyCap = dc;
  for (const p of ['meta', 'snapchat'] as const) { const x = perPlatform[p]; s.live[p] = !!(x && typeof x === 'object' && (x as Record<string, unknown>).live === true); }
  return s;   // TikTok and Google can never be live here: their flags stay false
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
export function newBudget(from: number, pct: number): number { return round2(from * (1 + pct / 100)); }
export const pctOf = (from: number, to: number) => (from > 0 ? round2(((to - from) / from) * 100) : 0);

export interface Recent { platform: Plat; entityId: string; at: number; increase: number }   // an applied or rolled-back change
export interface Subject { platform: Plat; entityId: string | null; mode: 'auto' | 'manual'; change: Change }

// The Riyadh calendar day (UTC+3, no daylight saving) a time falls in, as a number that compares
export const riyadhDay = (t: number) => Math.floor((t + 3 * 3600e3) / 864e5);

export interface Verdict { ok: boolean; blocks: Block[]; live: boolean; impact: Impact }
export interface Impact { dayDelta: number; weekDelta: number; pct: number; dailyUsed: number; dailyCap: number | null }

// What would stop this action right now. `live` says whether it may really run (the platform's own flag is on); when it is off
// the action can still be previewed (dry-run), which never writes.
export function evaluate(a: Subject, s: Settings, recent: Recent[], now: number): Verdict {
  const blocks: Block[] = [];
  const c = a.change;
  const todayInc = recent.filter(r => riyadhDay(r.at) === riyadhDay(now)).reduce((t, r) => t + r.increase, 0);
  const dayDelta = c.op === 'budget' && c.from != null && c.to != null ? round2(c.to - c.from) : 0;
  const impact: Impact = { dayDelta, weekDelta: round2(dayDelta * 7), pct: c.op === 'budget' && c.from ? pctOf(c.from, c.to ?? c.from) : 0, dailyUsed: round2(todayInc), dailyCap: s.dailyCap };
  if (s.kill) blocks.push({ code: 'kill' });
  if (a.mode === 'manual' || !a.entityId || a.platform === 'tiktok' || a.platform === 'google') blocks.push({ code: 'manual' });
  if (c.op === 'budget') {
    if (c.from == null || c.to == null || !(c.from > 0) || !(c.to > 0) || !isFinite(c.from) || !isFinite(c.to)) blocks.push({ code: 'bad_value' });
    else {
      if (Math.abs(c.to - c.from) < 0.01) blocks.push({ code: 'no_change' });
      // a little slack for the two-decimal rounding of the new value
      if (Math.abs(impact.pct) > s.maxPct + 0.05) blocks.push({ code: 'cap_pct', detail: s.maxPct });
      if (dayDelta > 0) {
        if (s.dailyCap == null) blocks.push({ code: 'no_daily_cap' });
        else if (todayInc + dayDelta > s.dailyCap + 1e-9) blocks.push({ code: 'cap_daily', detail: s.dailyCap });
      }
    }
  } else if (c.op === 'status' && c.from != null && c.from === c.to) blocks.push({ code: 'no_change' });
  if (a.entityId && recent.some(r => r.platform === a.platform && r.entityId === a.entityId && now - r.at < COOLDOWN_HOURS * 3600e3)) blocks.push({ code: 'cooldown', detail: COOLDOWN_HOURS });
  const live = (a.platform === 'meta' || a.platform === 'snapchat') && s.live[a.platform];
  return { ok: blocks.length === 0, blocks, live, impact };
}

// The value the platform holds right now must be the one the owner was shown. Budgets: within the tolerance. Status: equal.
export function sameAsShown(c: Change, live: { budget: number | null; status: Status | 'other' }): boolean {
  if (c.op === 'manual') return false;
  if (c.op === 'status') return c.from != null && live.status === c.from;
  if (c.from == null || live.budget == null) return false;
  return Math.abs(live.budget - c.from) <= Math.max(0.01, c.from * SAME_VALUE_TOLERANCE);
}
export const reachedTarget = (c: Change, live: { budget: number | null; status: Status | 'other' }): boolean =>
  c.op === 'manual' ? false : c.op === 'status' ? live.status === c.to : c.to != null && live.budget != null && Math.abs(live.budget - c.to) <= Math.max(0.01, c.to * SAME_VALUE_TOLERANCE);

// One open or applied action per same change per Riyadh day: the key the database enforces as unique.
export const idemKey = (a: { platform: Plat; level: Level; entityId: string | null; change: Change; recId?: string | null }, now: number): string =>
  [a.platform, a.level, a.entityId ?? 'manual', a.change.op, a.change.op === 'manual' ? (a.recId ?? '') : `${a.change.from}>${a.change.to}`, riyadhDay(now)].join('|');
