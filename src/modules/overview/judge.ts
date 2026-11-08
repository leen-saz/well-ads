// حكم التسويق على رحلة العميل في ملخص الأداء: نفس جدول القواعد اللي في اللوحة الرئيسية (pipeline/dash/00-judge.js)،
// وهنا بس تجهيز الأرقام من dash.json والأهداف (targets.json ثم تعديلات المستخدم في المتصفح). ما يطلع أي رقم من الصفحة.
// The marketing judge for Overview: the main page's own rules file, plus the input from dash.json and the targets.
import '../../../pipeline/dash/00-judge.js';
import type { Formats, Input, Judge, Targets, Verdict } from '../../../pipeline/dash/00-judge.js';
import { type CrmBy, outcome } from './analytics';
import { type Dash, lastDay } from './numbers';
import { fixed, qty } from './format';
import { pageLang } from './lang';

export type { Cohort, Confidence, Field, Formats, Input, Severity, Step, StepKey, Targets, Verdict } from '../../../pipeline/dash/00-judge.js';
export const J: Judge = globalThis.WELL_JUDGE;

// The viewer's own edits to the benchmark table, shared with the main page (same origin, same key)
export const TARGETS_KEY = 'well-ads-funnel-targets';
export function savedTargets(): Partial<Targets> | null {
  try { const s = localStorage.getItem(TARGETS_KEY); return s ? (JSON.parse(s) as Partial<Targets>) : null; } catch { return null; }
}
export function saveTargets(t: Partial<Targets> | null): void {
  try { if (t && Object.keys(t).length) localStorage.setItem(TARGETS_KEY, JSON.stringify(t)); else localStorage.removeItem(TARGETS_KEY); } catch { /* private window: edits last for the visit */ }
}
// targets.json «funnel» (build.py → dash.json funnel_targets), under the viewer's edits
export const configTargets = (d: Dash): Targets => J.targets((d as { funnel_targets?: unknown }).funnel_targets);
export const resolveTargets = (d: Dash, edits: Partial<Targets> | null): Targets => J.targets((d as { funnel_targets?: unknown }).funnel_targets, edits);

export const formats = (): Formats => ({
  pct: v => `${fixed(v, Math.abs(v) < 0.1 ? 3 : 2)}%`,
  sar: v => `${fixed(v, Math.abs(v) >= 100 ? 0 : 2)} ${pageLang() === 'en' ? 'SAR' : 'ر.س'}`,
  x: v => `${fixed(v, 2)}×`,
  qty: v => qty(v),
  num: (v, d) => fixed(v, d),
});

type CrmData = { rows?: unknown[][]; paid_all?: unknown[][] };
const n = (v: unknown): number => (typeof v === 'number' && isFinite(v) ? v : Number(v) || 0);

// The judge's numbers: the top of the funnel from the filtered ads; the CRM side (closings, paid, attribution) from the
// whole account, because the CRM's closings can't be split by platform. The cohort: every ad's leads by the day they came.
export function judgeInput(d: Dash, from: string, to: string, by: CrmBy, plat: string | undefined, maturityDays: number): Input {
  const a = outcome(d, from, to, by, plat), all = plat ? outcome(d, from, to, by) : a;
  const crm = (d as { crm?: CrmData }).crm;
  let cohort = null;
  if (crm) {
    const byDay = new Map<string, number>();
    for (const r of d.rows ?? []) if (d.ads?.[String(r[0])]) { const day = String(r[1]); byDay.set(day, (byDay.get(day) ?? 0) + n(r[5]) + n(r[6])); }
    const paid: [string, string | null][] = crm.paid_all
      ? crm.paid_all.map(r => [String(r[0] ?? ''), r[1] ? String(r[1]) : null])
      : (crm.rows ?? []).filter(r => r[3]).map(r => [String(r[1] ?? ''), r[2] ? String(r[2]) : null]);
    cohort = J.cohort([...byDay], paid, from, to, lastDay(d) ?? to, maturityDays);
  }
  return {
    top: { impr: a.impr, clicks: a.clicks, results: a.leads + a.conv, spend: a.spend, cpl: a.cpl },
    sale: { crm: all.crmLinked, results: all.leads + all.conv, spend: all.spend, closings: all.crm ? all.closings : all.booked,
      paid: all.crm ? all.paid : all.value, adClosings: all.bookedAll, adLeads: all.crmLeads, wide: !!plat },
    cohort,
  };
}

export function judgeFunnel(d: Dash, from: string, to: string, by: CrmBy, plat: string | undefined, t: Targets): Verdict {
  return J.judge(judgeInput(d, from, to, by, plat, t.maturityDays), t, pageLang(), formats());
}
