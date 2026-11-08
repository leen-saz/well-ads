// Synthetic dash.json for the auditor's tests: made-up numbers in Leen's proportions (about 4.1M impressions, 4K leads, 48
// paid closings, only part of them tied to ads). Nothing here is a real figure. Used by tests only; no app code imports it.
import type { Dash } from '../overview/numbers';

export interface Synth { days?: number; last?: string; impr?: number; ctr?: number; c2r?: number; tied?: number; paidAll?: number; paidTied?: number; lagDays?: number; seed?: number }
const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const add = (d: string, k: number) => new Date(Date.parse(d + 'T00:00:00Z') + k * 864e5).toISOString().slice(0, 10);

// tied = share of results that are CRM leads tied to an ad; paidAll closings in the CRM over the whole span, paidTied of them tied to an ad
export function synth(o: Synth = {}): Dash & { crm: { rows: unknown[][]; paid_all: unknown[][] } } {
  const days = o.days ?? 60, last = o.last ?? '2026-10-31', rand = rng(o.seed ?? 7);
  const plats = [['meta', 'lead', 0.55], ['snap', 'lead', 0.3], ['google_search', 'lead', 0.15]] as const;
  const ads: Record<string, { name: string; campaign: string; platform: string; dept: string; goal: string; live: boolean }> = {};
  const rows: unknown[][] = [];
  const impr = (o.impr ?? 4_100_000) / days;
  for (const [p, goal] of plats) ads[`${p}|1`] = { name: `ad ${p}`, campaign: `camp ${p}`, platform: p, dept: 'iv', goal, live: true };
  for (let i = 0; i < days; i++) {
    const day = add(last, -(days - 1 - i));
    for (const [p, , share] of plats) {
      const im = Math.round(impr * share * (0.9 + 0.2 * rand())), cl = Math.round(im * (o.ctr ?? 0.017) * (0.95 + 0.1 * rand()));
      const res = Math.round(cl * (o.c2r ?? 0.058) * (0.9 + 0.2 * rand()));
      rows.push([`${p}|1`, day, Math.round(im * 0.012), im, cl, res, 0]);
    }
  }
  const results = rows.reduce((a, r) => a + (r[5] as number), 0);
  // CRM: `tied` of the results are leads tied to an ad; the first paidTied of them paid, lag lagDays after the lead
  // CRM: `tied` of the results are leads tied to an ad; paidTied of them paid (spread over the whole span), lagDays after the lead
  const paidTied = o.paidTied ?? 16, paidAll = o.paidAll ?? 48, lag = o.lagDays ?? 6, tied = o.tied ?? 0.35;
  const crmRows: unknown[][] = [], paid: unknown[][] = [];
  const every = Math.max(1, Math.floor((results * tied) / Math.max(1, paidTied)));
  for (const r of rows) for (let j = 0; j < (r[5] as number); j++) {
    if (rand() > tied) continue;
    const isPaid = paid.length < paidTied && crmRows.length % every === every - 1, pd = add(String(r[1]), lag);
    crmRows.push([r[0], r[1], isPaid ? pd : '', isPaid, isPaid ? 1500 : 0]);
    if (isPaid) paid.push([r[1], pd, 1500, 'meta_form']);
  }
  for (let i = paid.length; i < paidAll; i++) paid.push([add(last, -(i % (days - 10)) - 10), add(last, -(i % (days - 10)) - 8), 1500, 'whatsapp']);
  return { ads, rows, range: { start: add(last, -(days - 1)), end: last, today: last }, crm: { rows: crmRows, paid_all: paid } } as Dash & { crm: { rows: unknown[][]; paid_all: unknown[][] } };
}
