// The rest of the analytics overview page, for the overview tab: each platform's share, the month's pace and forecast,
// cost per lead by weekday, and departments. Pure functions over /dash.json, same rules as pipeline/template.html
// (renderBI, renderPace, renderDeptMini). rows = [key, day, spend, impr, clicks, leads, conv]
import { type Ad, type Dash, HIDDEN, addDays, holes } from './numbers';

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
// The main dashboard's platform order (channels.py), then any other platform present
const FALLBACK = ['facebook', 'instagram', 'messenger', 'snap', 'tiktok', 'google_search', 'google_pmax', 'google_display', 'google_video', 'google_demand_gen', 'google', 'meta'];

type Row = { key: string; ad: Ad; day: string; spend: number; leads: number; conv: number };
function* rows(d: Dash, from: string, to: string): Generator<Row> {
  const ads = d.ads ?? {};
  for (const r of d.rows ?? []) {
    const key = String(r[0]), day = String(r[1]);
    if (day < from || day > to) continue;
    const ad = ads[key];
    if (ad) yield { key, ad, day, spend: num(r[2]), leads: num(r[5]), conv: num(r[6]) };
  }
}

export function order(d: Dash): string[] {
  const present = new Set(Object.values(d.ads ?? {}).map(a => a?.platform).filter((p): p is string => !!p && !HIDDEN.has(p)));
  const base = ((d as { channels?: { order?: string[] } }).channels?.order ?? FALLBACK).filter(p => present.has(p));
  return [...base, ...[...present].filter(p => !base.includes(p))];
}

// ---- Each platform's share of spend and of results (leads + chats). Hidden platforms count nowhere here.
export interface Share { platform: string; spend: number; results: number; spendShare: number; resultShare: number }
export function share(d: Dash, from: string, to: string): Share[] {
  const by = new Map<string, { spend: number; results: number }>();
  for (const x of rows(d, from, to)) { const o = by.get(x.ad.platform) ?? { spend: 0, results: 0 }; o.spend += x.spend; o.results += x.leads + x.conv; by.set(x.ad.platform, o); }
  const list = order(d).filter(p => { const o = by.get(p); return !!o && (o.spend > 0 || o.results > 0); });
  const ts = list.reduce((a, p) => a + by.get(p)!.spend, 0) || 1, tl = list.reduce((a, p) => a + by.get(p)!.results, 0) || 1;
  return list.map(p => { const o = by.get(p)!; return { platform: p, spend: o.spend, results: o.results, spendShare: (100 * o.spend) / ts, resultShare: (100 * o.results) / tl }; });
}

// ---- Cost per lead by weekday (0 = Sunday), lead-goal ads only, per platform. null where there were no leads.
export interface Heat { platform: string; cpl: (number | null)[] }
export function heat(d: Dash, from: string, to: string): { rows: Heat[]; lo: number; hi: number } {
  const by = new Map<string, { s: number; l: number }[]>();
  for (const x of rows(d, from, to)) {
    if (x.ad.goal !== 'lead') continue;
    const w = new Date(x.day + 'T00:00:00Z').getUTCDay();
    const days = by.get(x.ad.platform) ?? Array.from({ length: 7 }, () => ({ s: 0, l: 0 }));
    days[w]!.s += x.spend; days[w]!.l += x.leads;
    by.set(x.ad.platform, days);
  }
  const out = order(d).filter(p => by.has(p)).map(p => ({ platform: p, cpl: by.get(p)!.map(o => (o.l ? o.s / o.l : null)) }));
  const vals = out.flatMap(h => h.cpl.filter((v): v is number => v != null));
  return { rows: out, lo: vals.length ? Math.min(...vals) : 0, hi: vals.length ? Math.max(...vals) : 0 };
}

// ---- This month: spend and results so far, the forecast to month end, and the same days of last month
export interface Pace {
  month: string; prevMonth: string; done: number; days: number; spend: number | null; results: number | null; partialToday: boolean;
  forecast: { spend: number; results: number } | null; waitDays: boolean;
  prev: { spend: number; results: number; full: boolean } | null; vs: { spend: number | null; results: number | null } | null;
}
const monthEnd = (ym: string) => addDays(addDays(ym + '-28', 4).slice(0, 8) + '01', -1);
const dom = (day: string) => new Date(day + 'T00:00:00Z').getUTCDate();
const span = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1;

export function pace(d: Dash, from: string, to: string): Pace {
  const ym = to.slice(0, 7), first = ym + '-01', last = monthEnd(ym), days = dom(last);
  const today = d.range?.today || d.range?.end || to, max = d.range?.end || to, min = d.range?.start || '';
  const pFrom = from > first ? from : first, pTo = to < last ? to : last;
  // Today's partial day never counts towards the forecast
  const dropToday = pTo === today && today !== max;
  const completeTo = dropToday ? addDays(today, -1) : pTo, complete = completeTo >= pFrom;
  const prevEnd = addDays(first, -1), prevYm = prevEnd.slice(0, 7), prevLast = dom(prevEnd);
  const prevDays = new Set<string>();
  if (complete) for (let x = pFrom; x <= completeTo; x = addDays(x, 1)) if (dom(x) <= prevLast) prevDays.add(`${prevYm}-${String(dom(x)).padStart(2, '0')}`);
  const pl = [...prevDays].sort();
  const prevKnown = pl.length > 0 && pl.every(x => x >= min) && !holes(d, pl[pl.length - 1]!).length;
  const cur = { s: 0, l: 0 }, bit = { s: 0, l: 0 }, prev = { s: 0, l: 0 };
  for (const x of rows(d, min || '0000', max > today ? max : today)) {
    const r = x.leads + x.conv;
    if (complete && x.day >= pFrom && x.day <= completeTo) { cur.s += x.spend; cur.l += r; }
    if (dropToday && x.day === today) { bit.s += x.spend; bit.l += r; }
    if (prevDays.has(x.day)) { prev.s += x.spend; prev.l += r; }
  }
  const done = complete ? span(pFrom, completeTo) : 0;
  const open = complete && holes(d, completeTo).length > 0;
  const change = (a: number, b: number) => (b ? (100 * (a - b)) / b : null);
  return {
    month: ym, prevMonth: prevYm, done, days,
    spend: complete ? cur.s : dropToday ? bit.s : null, results: complete ? cur.l : dropToday ? bit.l : null, partialToday: !complete && dropToday,
    // Fewer than 3 complete days is too little to project a whole month
    forecast: done < 3 || open ? null : { spend: (cur.s * days) / done, results: (cur.l * days) / done }, waitDays: done < 3 && !open,
    prev: prevKnown ? { spend: prev.s, results: prev.l, full: prevDays.size === prevLast && done === days } : null,
    vs: open || !prevKnown ? null : { spend: change(cur.s, prev.s), results: change(cur.l, prev.l) },
  };
}

// ---- Departments: spend, leads and cost per lead (lead-goal ads), in the dashboard's order; brand is not a department
export interface Dept { key: string; name: string; spend: number; leads: number; cpl: number | null }
type DeptCfg = { order?: string[]; departments?: Record<string, { ar?: string }> };
export function depts(d: Dash, from: string, to: string): Dept[] {
  const cfg = (d as { departments?: DeptCfg }).departments ?? {};
  const names = cfg.departments ?? {};
  const keys = (cfg.order ?? Object.keys(names)).filter(k => names[k] && k !== 'brand');
  const by = new Map<string, { spend: number; leads: number; ls: number; ln: number }>();
  for (const x of rows(d, from, to)) {
    const k = x.ad.dept || 'brand', o = by.get(k) ?? { spend: 0, leads: 0, ls: 0, ln: 0 };
    o.spend += x.spend; o.leads += x.leads;
    if (x.ad.goal === 'lead') { o.ls += x.spend; o.ln += x.leads; }
    by.set(k, o);
  }
  return keys.map(k => { const o = by.get(k) ?? { spend: 0, leads: 0, ls: 0, ln: 0 }; return { key: k, name: names[k]!.ar || k, spend: o.spend, leads: o.leads, cpl: o.ln ? o.ls / o.ln : null }; });
}

// ---- The outcome and the customer journey (template.html agg + renderKpis). CRM rows from pipeline/crm/join.py:
// crm.rows = [ad key, lead day, paid day, paid?, amount] (leads matched to ads), crm.paid_all = [lead day, paid day, amount, source]
// (every paid lead in the CRM, with or without an ad). Closings count on the lead's day or on the payment day, as Leen picks.
export type CrmBy = 'lead' | 'paid';
export interface Outcome {
  spend: number; impr: number; clicks: number; leads: number; conv: number;
  crm: boolean; crmLeads: number; booked: number; value: number; closings: number; paid: number;
  cpm: number | null; cpc: number | null; ctr: number | null; cpl: number | null; clickToResult: number | null;
  closeRate: number | null; roas: number | null; mer: number | null; cac: number | null;
}
type CrmData = { rows?: unknown[][]; paid_all?: unknown[][] };
const ratio = (a: number, b: number): number | null => (b ? a / b : null);

export function outcome(d: Dash, from: string, to: string, by: CrmBy = 'lead'): Outcome {
  let spend = 0, impr = 0, clicks = 0, leads = 0, conv = 0, ls = 0, ln = 0;
  for (const r of d.rows ?? []) {
    const day = String(r[1]);
    if (day < from || day > to || !d.ads?.[String(r[0])]) continue;
    const s = num(r[2]), l = num(r[5]);
    spend += s; impr += num(r[3]); clicks += num(r[4]); leads += l; conv += num(r[6]);
    if (d.ads[String(r[0])]!.goal === 'lead') { ls += s; ln += l; }
  }
  const crmData = (d as { crm?: CrmData }).crm;
  let crmLeads = 0, booked = 0, value = 0, closings = 0, paid = 0;
  for (const [k, leadDay, paidDay, isPaid, amount] of (crmData?.rows ?? []) as [string, string, string, unknown, number][]) {
    if (!d.ads?.[k]) continue;
    if (leadDay >= from && leadDay <= to) crmLeads++;
    const day = by === 'paid' ? paidDay : leadDay;
    if (isPaid && day && day >= from && day <= to) { booked++; value += num(amount); }
  }
  for (const [leadDay, paidDay, amount] of (crmData?.paid_all ?? []) as [string, string, number][]) {
    const day = by === 'paid' ? paidDay : leadDay;
    if (day && day >= from && day <= to) { closings++; paid += num(amount); }
  }
  return {
    spend, impr, clicks, leads, conv, crm: !!crmData?.paid_all, crmLeads, booked, value, closings, paid,
    cpm: impr ? (1000 * spend) / impr : null, cpc: ratio(spend, clicks), ctr: impr ? (100 * clicks) / impr : null, cpl: ratio(ls, ln),
    clickToResult: clicks ? (100 * (leads + conv)) / clicks : null, closeRate: crmLeads ? (100 * booked) / crmLeads : null,
    roas: spend && value ? value / spend : null, mer: ratio(paid, spend), cac: ratio(spend, closings),
  };
}
