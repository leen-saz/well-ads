// Performance numbers for reports and alerts (docs/PRD.md §7 M17), from the same dashboard file and the same outcome() as the
// overview and /api/v1, so a report never disagrees with the page. Pure functions plus two small runners.
import type { Cfg } from './auth';
import { loadDash } from './apiv1';
import { outcome } from '../modules/overview/analytics';
import { addDays, lastDay } from '../modules/overview/numbers';
import { emit } from '../mcp/events';

type Dash = NonNullable<Awaited<ReturnType<typeof loadDash>>>;
export interface Line { spend: number; leads: number; clicks: number; impr: number; cpl: number | null; ctr: number | null }
const line = (o: ReturnType<typeof outcome>): Line => ({ spend: round(o.spend), leads: o.leads, clicks: o.clicks, impr: o.impr, cpl: o.cpl == null ? null : round(o.cpl), ctr: o.ctr == null ? null : round(o.ctr) });
const round = (n: number) => Math.round(n * 100) / 100;
const platformsOf = (d: Dash): string[] => [...new Set(Object.values(d.ads ?? {}).map(a => String((a as { platform?: string }).platform || '')).filter(Boolean))].sort();

/** The period, the one before it (same length), overall and per platform. */
export function performance(d: Dash, from: string, to: string) {
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
  const pTo = addDays(from, -1), pFrom = addDays(pTo, -(days - 1));
  const per = Object.fromEntries(platformsOf(d).map(p => [p, { now: line(outcome(d, from, to, 'lead', p)), before: line(outcome(d, pFrom, pTo, 'lead', p)) }]));
  return { period: { from, to, days }, previous: { from: pFrom, to: pTo }, total: { now: line(outcome(d, from, to)), before: line(outcome(d, pFrom, pTo)) }, platforms: per, generated_at: (d as { generated_at?: string }).generated_at ?? null };
}

// ---- alerts: yesterday against the 7 days before it, per platform. Thresholds are deliberately plain.
export const MIN_SPEND = 100;      // SAR: below this a day says nothing
export const CPL_UP = 1.5;         // yesterday's cost per lead at least 1.5× the week's
export const MIN_BASE_LEADS = 5;   // the week needs this many leads for its cost per lead to mean something
export type AlertCode = 'no_results' | 'cpl_up';
export interface Alert { platform: string; code: AlertCode; day: string; spend: number; cpl: number | null; base_cpl: number | null }

export function perfAlerts(d: Dash, day = lastDay(d)): Alert[] {
  if (!day) return [];
  const out: Alert[] = [];
  for (const p of platformsOf(d)) {
    const y = outcome(d, day, day, 'lead', p), w = outcome(d, addDays(day, -7), addDays(day, -1), 'lead', p);
    if (y.spend < MIN_SPEND) continue;
    if (y.leads + y.conv === 0) out.push({ platform: p, code: 'no_results', day, spend: round(y.spend), cpl: null, base_cpl: w.cpl == null ? null : round(w.cpl) });
    else if (y.cpl != null && w.cpl != null && w.leads >= MIN_BASE_LEADS && y.cpl >= CPL_UP * w.cpl) out.push({ platform: p, code: 'cpl_up', day, spend: round(y.spend), cpl: round(y.cpl), base_cpl: round(w.cpl) });
  }
  return out;
}

const NAMES: Record<string, string> = { facebook: 'ميتا', meta: 'ميتا', snap: 'سناب شات', tiktok: 'تيك توك', google: 'قوقل' };
export function alertText(a: Alert[]): { subject: string; text: string } | null {
  if (!a.length) return null;
  const lines = a.map(x => x.code === 'no_results'
    ? `• ${NAMES[x.platform] || x.platform}: صرف ${x.spend} ريال يوم ${x.day} بدون أي نتيجة.`
    : `• ${NAMES[x.platform] || x.platform}: تكلفة النتيجة ${x.cpl} ريال يوم ${x.day}، والمعدل في الأسبوع قبله ${x.base_cpl}.`);
  return { subject: `Well: تنبيه أداء (${a.length})`, text: `${lines.join('\n')}\n\nافتح لوحة القرارات تشوف التوصيات.` };
}

/** Daily, 06:xx UTC (09:xx Riyadh): one message with every alert, and one event per alert. */
export async function runPerfAlerts(cfg: Cfg, e: { FILES?: R2Bucket }, send: (m: { subject: string; text: string }) => Promise<unknown>, company: string): Promise<number> {
  const d = await loadDash(e as never);
  if (!d) return 0;
  const a = perfAlerts(d);
  const m = alertText(a);
  if (!m) return 0;
  await send(m);
  for (const x of a) await emit(cfg, company, 'insights.alert', { ...x });
  return a.length;
}
