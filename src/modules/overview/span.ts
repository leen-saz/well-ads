// How much history the judge sees, for the owner only: the first and last day of daily spend (overall and per channel),
// the days with CRM closings and how many closings in all. Counts and dates only, never an amount, and nothing is
// logged. It tells whether a later media-mix model (MMM) is feasible: that needs about two years of daily spend per channel.
import { type Dash, family } from './numbers';

export const MMM_DAYS = 730;
export interface Span { first: string | null; last: string | null; days: number }
export interface DataSpan {
  spend: Span;
  channels: (Span & { channel: string; mmmReady: boolean })[];
  crm: (Span & { closings: number }) | null;
  mmm: { needDays: number; ready: boolean };
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const n = (v: unknown): number => (typeof v === 'number' && isFinite(v) ? v : Number(v) || 0);
const span = (days: Set<string>): Span => {
  const s = [...days].sort();
  return { first: s[0] ?? null, last: s[s.length - 1] ?? null, days: s.length };
};

// dash.json sends its rows column-wise (pipeline/dash_split.py): key index, day index, spend, … (useDash.ts withRows)
type RowsCols = { k: string[]; d: string[]; c: number[][] };
function* spendRows(d: Dash & { rows_cols?: RowsCols }): Generator<[string, string, number]> {
  const rc = d.rows_cols;
  if (rc) { for (let i = 0; i < (rc.c[0]?.length ?? 0); i++) yield [rc.k[rc.c[0]![i]!]!, rc.d[rc.c[1]![i]!]!, n(rc.c[2]![i])]; return; }
  for (const r of d.rows ?? []) yield [String(r[0]), String(r[1]), n(r[2])];
}

export function dataSpan(d: Dash): DataSpan {
  const all = new Set<string>(), by = new Map<string, Set<string>>();
  for (const [k, day, spend] of spendRows(d)) {
    const ad = d.ads?.[k];
    if (!ad || !DAY.test(day) || !(spend > 0)) continue;
    all.add(day);
    const ch = family(ad.platform);
    if (!by.has(ch)) by.set(ch, new Set());
    by.get(ch)!.add(day);
  }
  const channels = [...by].map(([channel, days]) => ({ channel, ...span(days), mmmReady: days.size >= MMM_DAYS })).sort((a, b) => b.days - a.days);
  // Closings by the day they were paid: every paid closing in the CRM, or the ad-linked ones when that list is missing
  const crm = (d as { crm?: { rows?: unknown[][]; paid_all?: unknown[][] } }).crm;
  let crmSpan: DataSpan['crm'] = null;
  if (crm) {
    const paid = crm.paid_all ? crm.paid_all.map(r => r[1]) : (crm.rows ?? []).filter(r => r[3]).map(r => r[2]);
    const days = new Set(paid.map(String).filter(x => DAY.test(x)));
    crmSpan = { ...span(days), closings: paid.length };
  }
  return { spend: span(all), channels, crm: crmSpan, mmm: { needDays: MMM_DAYS, ready: channels.length > 0 && channels.every(c => c.mmmReady) } };
}
