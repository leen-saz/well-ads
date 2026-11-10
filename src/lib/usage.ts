// AI cost tracking (docs/ai-cost.md): every model call through llm.ts writes one ai_usage row, and a tab with a monthly cap
// moves to Workers AI when it is spent. The row holds counts, cost, tab, provider, model and the user id only: never the
// prompt, the answer or an email. Nothing here logs a cost or a total (the repo is public); the figures live in the
// owner-only screen.
import { AsyncLocalStorage } from 'node:async_hooks';
import { sb, audit, type Cfg } from './auth';
import { scoped } from './tenant';
import { priceOf, per, type Billed } from './prices';

// The riyal is pegged to the dollar (SAMA, 3.75 since 1986); the pipeline uses the same number (USD_SAR in fetch_data.py)
export const USD_SAR = 3.75;
export const DEFAULT_ALERT_PCT = 80;
// The cap a tab has until the owner sets its own: a tab with no ai_budgets row, or a budget read that failed, is NOT unlimited.
// Conservative on purpose (about 19 riyals a month); the owner raises it on the usage screen, or clears it to remove the limit.
export const DEFAULT_CAP_USD = 5;
export const defaultCap = (): { usd: number; pct: number } => ({ usd: DEFAULT_CAP_USD, pct: DEFAULT_ALERT_PCT });
const SNAP_MS = 60_000;

export interface UsageCtx { cfg: Cfg; co: string; uid?: string | null | undefined; tab?: string }
export const usageCtx = (cfg: Cfg, user: { co: string; uid?: string } | null | undefined, tab?: string): UsageCtx | undefined =>
  user ? { cfg, co: user.co, uid: user.uid ?? null, ...(tab ? { tab } : {}) } : undefined;
// The Design tab's motion plan is billed to the Design tab
export const tabOf = (module: string, ctx?: UsageCtx): string => ctx?.tab || (module === 'motion' ? 'design' : module);

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
// `audioIn`: the part of the input that was audio or video, billed at the model's audio rate when it has one
export function cost(provider: Billed, model: string, tin: number, tout: number, audioIn = 0): { usd: number; sar: number; priced: boolean } {
  const p = priceOf(provider, model);
  if (!p) return { usd: 0, sar: 0, priced: false };
  const a = Math.min(Math.max(0, audioIn), tin);
  const usd = r6(per(tin - a, p.inUsd) + per(a, p.audioInUsd ?? p.inUsd) + per(tout, p.outUsd));
  return { usd, sar: r6(usd * USD_SAR), priced: true };
}

// Riyadh is UTC+3 all year: the month the owner sees starts at midnight there
export function monthStart(now: number, back = 0): string {
  const d = new Date(now + 3 * 3600e3);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - back, 1) - 3 * 3600e3).toISOString();
}

// ---- Recording. Best effort: it runs after the answer (waitUntil when the Worker gave one) and swallows every error.
const waiter = new AsyncLocalStorage<(p: Promise<unknown>) => void>();
export const withWaiter = <T>(wait: (p: Promise<unknown>) => void, fn: () => T): T => waiter.run(wait, fn);

interface Snap { at: number; month: string; caps: Map<string, { usd: number; pct: number }>; spent: Map<string, number>; said: Set<string>; known: boolean }
const SNAPS = new Map<string, Snap>();
export const clearSnaps = (): void => SNAPS.clear();
const num = (x: unknown) => { const n = Number(x); return isFinite(n) ? n : 0; };

// The company's caps and this month's spend per tab, read at most once a minute per isolate (so the 100% check costs no
// Supabase read per model call). A cap can therefore be passed by about a minute of calls. A missing table (migration
// not applied) or a failed read enforces the default cap (fail closed), never "no cap". Only a row the owner saved with an empty cap means no limit.
async function snap(ctx: UsageCtx, now = Date.now()): Promise<Snap> {
  const month = monthStart(now), key = `${ctx.co}`;
  const hit = SNAPS.get(key);
  if (hit && hit.month === month && now - hit.at < SNAP_MS) return hit;
  const s: Snap = { at: now, month, caps: new Map(), spent: new Map(), said: hit && hit.month === month ? hit.said : new Set(), known: false };
  SNAPS.set(key, s);   // set first: a failing read is not retried on every call
  try {
    const [b, u] = await Promise.all([
      sb<{ module: string; monthly_cap_usd: number | null; alert_at_pct: number }[]>(ctx.cfg, scoped('/rest/v1/ai_budgets?select=module,monthly_cap_usd,alert_at_pct', ctx.co), { admin: true }),
      sb<{ module: string; cost_usd: number }[]>(ctx.cfg, '/rest/v1/rpc/ai_spend', { method: 'POST', admin: true, body: { p_company: ctx.co, p_since: month } }),
    ]);
    // A saved row with an empty cap is the owner's choice of "no limit" (usd 0); no row at all gets the default cap
    if (b.ok && Array.isArray(b.data)) for (const x of b.data) s.caps.set(x.module, x.monthly_cap_usd != null ? { usd: num(x.monthly_cap_usd), pct: num(x.alert_at_pct) || DEFAULT_ALERT_PCT } : { usd: 0, pct: DEFAULT_ALERT_PCT });
    if (u.ok && Array.isArray(u.data)) for (const x of u.data) s.spent.set(x.module, (s.spent.get(x.module) || 0) + num(x.cost_usd));
    s.known = b.ok && u.ok;
  } catch { /* default cap, spend unknown */ }
  return s;
}

// True when this tab has a cap and has spent it
export async function overCap(ctx: UsageCtx, module: string): Promise<boolean> {
  const s = await snap(ctx), tab = tabOf(module, ctx), c = s.caps.get(tab) ?? defaultCap();
  // Spend could not be read: with a limit in force we cannot show we are under it, so stop (fail closed)
  if (!s.known && c.usd > 0) return true;
  return c.usd > 0 && (s.spent.get(tab) || 0) >= c.usd;
}

// `costUsd`: the cost the provider itself reported (OpenRouter returns it), used instead of the price table
export interface Used { provider: Billed; model: string; usage?: { in: number; out: number; audioIn?: number } | undefined; estimated?: boolean; costUsd?: number }

export function record(ctx: UsageCtx | undefined, module: string, u: Used): void {
  if (!ctx) return;
  const tab = tabOf(module, ctx), tin = Math.max(0, Math.round(u.usage?.in ?? 0)), tout = Math.max(0, Math.round(u.usage?.out ?? 0));
  const c = typeof u.costUsd === 'number' && isFinite(u.costUsd) && u.costUsd >= 0 ? { usd: r6(u.costUsd), sar: r6(u.costUsd * USD_SAR), priced: true } : cost(u.provider, u.model, tin, tout, u.usage?.audioIn ?? 0);
  const job = (async () => {
    const r = await sb(ctx.cfg, '/rest/v1/ai_usage', { method: 'POST', admin: true, headers: { Prefer: 'return=minimal' },
      body: { company_id: ctx.co, user_id: ctx.uid ?? null, module: tab, provider: u.provider, model: u.model, tokens_in: tin, tokens_out: tout, cost_usd: c.usd, cost_sar: c.sar, usd_sar: USD_SAR, priced: c.priced, estimated: !!u.estimated } });
    if (!r.ok) return;
    // Keep this isolate's count current between the minute reads, and say once when a line is crossed
    const s = await snap(ctx), cap = s.caps.get(tab) ?? defaultCap();
    const before = s.spent.get(tab) || 0, after = before + c.usd;
    s.spent.set(tab, after);
    if (!cap || cap.usd <= 0) return;
    for (const [at, action] of [[cap.pct, 'ai_budget_alert'], [100, 'ai_budget_capped']] as const) {
      const tag = `${tab}:${at}`;
      if (after >= (cap.usd * at) / 100 && !s.said.has(tag)) { s.said.add(tag); await audit(ctx.cfg, { co: ctx.co }, action, { target: { tab, at_pct: at } }); }
    }
  })().catch(() => {});
  const wait = waiter.getStore();
  if (wait) wait(job);
}

// ---- Owner screen helpers (pure, so the tests don't need a database)
export interface Row { month?: string; module: string; calls: number; tokens_in: number; tokens_out: number; cost_usd: number; cost_sar: number; unpriced?: number }
export type Level = 'ok' | 'alert' | 'capped';
export function levelOf(spentUsd: number, cap: { usd: number; pct: number } | undefined): Level {
  if (!cap || !(cap.usd > 0)) return 'ok';
  if (spentUsd >= cap.usd) return 'capped';
  return spentUsd >= (cap.usd * cap.pct) / 100 ? 'alert' : 'ok';
}
// The owner types the invoice total (USD). Within 5% of what we recorded is the PRD's acceptance gate.
export const TOLERANCE_PCT = 5;
export function reconcile(recordedUsd: number, invoiceUsd: number): { recorded_usd: number; invoice_usd: number; diff_usd: number; diff_pct: number | null; ok: boolean | null } {
  const diff = r6(recordedUsd - invoiceUsd);
  if (!(invoiceUsd > 0)) return { recorded_usd: r6(recordedUsd), invoice_usd: invoiceUsd, diff_usd: diff, diff_pct: null, ok: null };
  const pct = Math.round((diff / invoiceUsd) * 10_000) / 100;
  return { recorded_usd: r6(recordedUsd), invoice_usd: invoiceUsd, diff_usd: diff, diff_pct: pct, ok: Math.abs(pct) <= TOLERANCE_PCT };
}
