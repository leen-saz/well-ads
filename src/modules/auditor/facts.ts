// The auditor's own recomputation from the raw dash.json (rows = [ad key, day, spend, impr, clicks, leads, chats], crm.rows =
// [ad key, lead day, paid day, paid?, amount], crm.paid_all = [lead day, paid day, amount, source]). It does NOT import the
// judge's numbers (analytics.ts / funnel.ts): a bug there must not be repeated here. Written per ad first, then folded.
import type { StepKey } from './contract';

export type Raw = { ads?: Record<string, { platform?: string; goal?: string }>; rows?: unknown[][]; rows_cols?: { k: string[]; d: string[]; c: number[][] };
  crm?: { rows?: unknown[][]; paid_all?: unknown[][] }; range?: { start?: string; end?: string } };

const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const HIDDEN = ['audience_network', 'meta_whatsapp'];
const DAY_MS = 86_400_000;
export const dayAdd = (d: string, k: number): string => new Date(Date.parse(d + 'T00:00:00Z') + k * DAY_MS).toISOString().slice(0, 10);
const gap = (a: string, b: string): number => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY_MS);

// dash.json sends rows column-wise; both shapes are read
export function rowsOf(d: Raw): unknown[][] {
  if (d.rows) return d.rows;
  const rc = d.rows_cols;
  if (!rc) return [];
  const out: unknown[][] = [];
  for (let i = 0; i < (rc.c[0]?.length ?? 0); i++) out.push([rc.k[rc.c[0]![i]!], rc.d[rc.c[1]![i]!], rc.c[2]![i], rc.c[3]![i], rc.c[4]![i], rc.c[5]![i], rc.c[6]![i]]);
  return out;
}

export interface Tally { spend: number; impr: number; clicks: number; leads: number; chats: number; ls: number; ln: number; results: number; days: number }
const blank = (): Tally => ({ spend: 0, impr: 0, clicks: 0, leads: 0, chats: 0, ls: 0, ln: 0, results: 0, days: 0 });
export const rates = (t: Tally) => ({
  ctr: t.impr > 0 ? (100 * t.clicks) / t.impr : null,
  c2r: t.clicks > 0 ? (100 * t.results) / t.clicks : null,
  cpl: t.ln > 0 ? t.ls / t.ln : null,
  cpm: t.impr > 0 ? (1000 * t.spend) / t.impr : null,
});

export interface CrmTally { leads: number; booked: number; amount: number }
export interface Facts {
  from: string; to: string; scope: Tally & ReturnType<typeof rates>;
  crm: CrmTally & { linked: boolean; closeRate: number | null; coverage: number | null; closingsAll: number; bookedAll: number; unattributed: number };
  byPlat: Record<string, Tally & ReturnType<typeof rates> & { crm: CrmTally }>;
  // How long closings take (days from lead to payment, over every paid CRM lead in the data) and what share of this period's leads are younger
  lag: { n: number; p50: number | null; p75: number | null };
  cohort: { leads: number; matureLeads: number; matureBooked: number; immatureShare: number | null; matureRate: number | null };
  usual: { click: number | null; lead: number | null; cpl: number | null; cpm: number | null };
  prev: { from: string; to: string; daysWithData: number; days: number; scope: Tally & ReturnType<typeof rates>; closeRate: number | null; coverage: number | null };
}

function window_(d: Raw, from: string, to: string): { all: Tally; plat: Map<string, Tally> } {
  const perAd = new Map<string, Map<string, [number, number, number, number, number, number]>>();
  for (const r of rowsOf(d)) {
    const day = String(r[1]);
    if (day < from || day > to) continue;
    const ad = d.ads?.[String(r[0])];
    if (!ad) continue;
    const key = String(r[0]);
    const m = perAd.get(key) ?? new Map();
    const c = m.get(day) ?? [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 5; i++) c[i]! += n(r[i + 2]);
    m.set(day, c as [number, number, number, number, number, number]);
    perAd.set(key, m);
  }
  const all = blank(), plat = new Map<string, Tally>(), seen = new Set<string>(), seenBy = new Map<string, Set<string>>();
  for (const [key, m] of perAd) {
    const ad = d.ads![key]!, p = ad.platform || '?', t = plat.get(p) ?? blank();
    plat.set(p, t);
    for (const [day, c] of m) {
      seen.add(day);
      (seenBy.get(p) ?? seenBy.set(p, new Set()).get(p)!).add(day);
      for (const x of [all, t]) {
        x.spend += c[0]; x.impr += c[1]; x.clicks += c[2]; x.leads += c[3]; x.chats += c[4];
        if (ad.goal === 'lead') { x.ls += c[0]; x.ln += c[3]; }
      }
    }
  }
  for (const x of [all, ...plat.values()]) x.results = x.leads + x.chats;
  all.days = seen.size;
  for (const [p, t] of plat) t.days = seenBy.get(p)?.size ?? 0;
  return { all, plat };
}

function median(xs: number[], min: number): number | null {
  if (xs.length < min) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
}

// The usual level: the median of the daily values of the 30 days up to `to`, over days with enough volume (the same
// volume gates the judge documents: 200 impressions, 20 clicks, 1 lead). 7 such days at least.
function usual(d: Raw, to: string, plat?: string) {
  const from = dayAdd(to, -29), byDay = new Map<string, Tally>();
  for (const r of rowsOf(d)) {
    const day = String(r[1]), ad = d.ads?.[String(r[0])];
    if (day < from || day > to || !ad || (plat && ad.platform !== plat)) continue;
    const t = byDay.get(day) ?? blank();
    t.spend += n(r[2]); t.impr += n(r[3]); t.clicks += n(r[4]); t.results += n(r[5]) + n(r[6]);
    if (ad.goal === 'lead') { t.ls += n(r[2]); t.ln += n(r[5]); }
    byDay.set(day, t);
  }
  const days = [...byDay.values()];
  return {
    click: median(days.filter(t => t.impr >= 200).map(t => (100 * t.clicks) / t.impr), 7),
    lead: median(days.filter(t => t.clicks >= 20).map(t => (100 * t.results) / t.clicks), 7),
    cpl: median(days.filter(t => t.ln >= 1).map(t => t.ls / t.ln), 7),
    cpm: median(days.filter(t => t.impr >= 200).map(t => (1000 * t.spend) / t.impr), 7),
  };
}

export function recompute(d: Raw, from: string, to: string, by: 'lead' | 'paid' = 'lead', plat?: string): Facts {
  const cur = window_(d, from, to), span = gap(from, to) + 1, pf = dayAdd(from, -span), pt = dayAdd(from, -1), prv = window_(d, pf, pt);
  const scopeT = plat ? cur.plat.get(plat) ?? blank() : cur.all;
  const prevT = plat ? prv.plat.get(plat) ?? blank() : prv.all;

  // CRM: leads tied to an ad (rows) and every paid closing (paid_all). The counting day is the lead's or the payment's.
  const rows = (d.crm?.rows ?? []) as [string, string, string, unknown, number][];
  const dayOf = (leadDay: string, paidDay: string) => (by === 'paid' ? paidDay : leadDay);
  const crmFor = (a: string, b: string, only?: string): CrmTally => {
    const o: CrmTally = { leads: 0, booked: 0, amount: 0 };
    for (const [k, ld, pd, paid, amt] of rows) {
      const ad = d.ads?.[k];
      if (!ad || (only && ad.platform !== only)) continue;
      if (ld >= a && ld <= b) o.leads++;
      const day = dayOf(ld, pd);
      if (paid && day && day >= a && day <= b) { o.booked++; o.amount += n(amt); }
    }
    return o;
  };
  const crmScope = crmFor(from, to, plat), crmPrev = crmFor(pf, pt, plat);
  let closingsAll = 0, bookedAll = 0;
  for (const [ld, pd] of (d.crm?.paid_all ?? []) as [string, string][]) { const day = dayOf(ld, pd); if (day && day >= from && day <= to) closingsAll++; }
  const everyone = crmFor(from, to);
  bookedAll = everyone.booked;

  const byPlat: Facts['byPlat'] = {};
  for (const [p, t] of cur.plat) if (!HIDDEN.includes(p)) byPlat[p] = { ...t, ...rates(t), crm: crmFor(from, to, p) };

  // Lag between lead and payment, over every paid CRM lead
  const lags = rows.filter(r => r[3] && r[1] && r[2]).map(r => gap(r[1], r[2])).filter(x => x >= 0).sort((a, b) => a - b);
  const q = (p: number) => (lags.length ? lags[Math.min(lags.length - 1, Math.floor(p * lags.length))]! : null);
  const p75 = lags.length >= 10 ? q(0.75) : null;
  let leads = 0, mLeads = 0, mBooked = 0;
  const cut = p75 == null ? null : dayAdd(to, -p75);
  for (const [k, ld, , paid] of rows) {
    const ad = d.ads?.[k];
    if (!ad || (plat && ad.platform !== plat) || ld < from || ld > to) continue;
    leads++;
    if (cut != null && ld <= cut) { mLeads++; if (paid) mBooked++; }
  }
  const unattributed = Math.max(0, closingsAll - bookedAll);
  const ratesNow = rates(scopeT);
  return {
    from, to, scope: { ...scopeT, ...ratesNow },
    crm: { ...crmScope, linked: !!d.crm, closeRate: crmScope.leads ? (100 * crmScope.booked) / crmScope.leads : null,
      coverage: scopeT.results ? crmScope.leads / scopeT.results : null, closingsAll, bookedAll, unattributed },
    byPlat, lag: { n: lags.length, p50: lags.length >= 10 ? q(0.5) : null, p75 },
    cohort: { leads, matureLeads: mLeads, matureBooked: mBooked, immatureShare: p75 == null || !leads ? null : 1 - mLeads / leads, matureRate: p75 == null || !mLeads ? null : (100 * mBooked) / mLeads },
    usual: usual(d, to, plat),
    prev: { from: pf, to: pt, daysWithData: prevT.days, days: span, scope: { ...prevT, ...rates(prevT) }, closeRate: crmPrev.leads ? (100 * crmPrev.booked) / crmPrev.leads : null, coverage: prevT.results ? crmPrev.leads / prevT.results : null },
  };
}

// The number each step is measured by, and the volume it stands on (its denominator)
export function valueOf(f: Facts, key: StepKey): number | null {
  const s = f.scope;
  return key === 'click' ? s.ctr : key === 'lead' ? s.c2r : key === 'sale' ? f.crm.closeRate : key === 'cpl' ? s.cpl : s.cpm;
}
export function volumeOf(f: Facts, key: StepKey): { kind: 'impr' | 'clicks' | 'results' | 'crmLeads'; n: number } {
  const s = f.scope;
  return key === 'click' || key === 'cpm' ? { kind: 'impr', n: s.impr } : key === 'lead' ? { kind: 'clicks', n: s.clicks } : key === 'cpl' ? { kind: 'results', n: s.ln } : { kind: 'crmLeads', n: f.crm.leads };
}
