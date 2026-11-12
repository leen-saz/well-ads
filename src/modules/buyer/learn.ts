// The media buyer's learning loop, the pure part: how one recommendation turned out (the same campaign's numbers before it
// and 3 or 7 days after), and what the pile of outcomes says about a rule's threshold. It proposes; it changes nothing.
// A proposed change to playbook.ts goes in as a development PR (docs/media-buyer/learning-loop.md), never straight to main.
import { T, type RuleId } from './playbook';
import type { Kind } from './buyer';

export interface Window { cpl: number | null; ctr?: number | null; leads: number; spend: number; impr?: number }
export interface Outcome { rule: RuleId; platform: string; kind: Kind; days: number; before: Window; after: Window; acted: boolean }
export type Result = 'worked' | 'no_change' | 'worse' | 'unclear' | 'not_acted';

// Spend changes are the media buyer's, so an outcome only counts when the recommendation was acted on
export function judgeOutcome(o: Outcome): Result {
  if (!o.acted) return 'not_acted';
  const { before: b, after: a } = o;
  // TikTok is judged by click rate and engagement, never by leads (the owner's decision)
  if (o.platform === 'tiktok') {
    if (b.ctr == null || a.ctr == null || (b.impr ?? 0) < 2000 || (a.impr ?? 0) < 2000) return 'unclear';
    if (o.kind === 'pause') return a.spend < b.spend * 0.2 ? 'worked' : 'unclear';
    const d = (a.ctr - b.ctr) / b.ctr;
    return d >= 0.1 ? 'worked' : d <= -0.1 ? 'worse' : 'no_change';
  }
  if (b.cpl == null || a.cpl == null || a.leads + b.leads < 5) return 'unclear';
  const d = (a.cpl - b.cpl) / b.cpl;
  if (o.kind === 'budget_up') return a.cpl <= b.cpl * 1.15 && a.leads > b.leads ? 'worked' : a.cpl > b.cpl * 1.3 ? 'worse' : 'no_change';
  if (o.kind === 'pause') return a.spend < b.spend * 0.2 ? 'worked' : 'unclear';
  return d <= -0.1 ? 'worked' : d >= 0.1 ? 'worse' : 'no_change';
}

// Which constant in playbook.ts T each rule is tuned by
export const KNOB: Partial<Record<RuleId, keyof typeof T>> = { scale_up: 'scaleDaysAtTarget', stop_cpl: 'pauseCplMultiple', fatigue: 'fatigueCtrDrop', low_ctr: 'lowCtrOfTarget', page_leak: 'clickToLeadFloor', shift_budget: 'platformGap', placement_gap: 'placementGap', weekday_gap: 'dowGap' };
export interface Tuning { rule: RuleId; n: number; worked: number; worse: number; share: number | null; knob: string | null; proposal: string | null }
export const MIN_OUTCOMES = 8;

export function tune(outcomes: Outcome[]): Tuning[] {
  const by = new Map<RuleId, Outcome[]>();
  for (const o of outcomes) if (o.acted) by.set(o.rule, [...(by.get(o.rule) ?? []), o]);
  return [...by.entries()].map(([rule, list]) => {
    const rs = list.map(judgeOutcome).filter(r => r !== 'unclear');
    const worked = rs.filter(r => r === 'worked').length, worse = rs.filter(r => r === 'worse').length, n = rs.length;
    const share = n ? worked / n : null, knob = (KNOB[rule] as string | undefined) ?? null;
    let proposal: string | null = null;
    if (knob && n >= MIN_OUTCOMES && share != null) {
      if (share < 0.4) proposal = `الإشارة ما تنفع كثير (${worked} من ${n} نجحت): شدّد ${knob} في playbook.ts، وراجع الدليل في docs/media-buyer.`;
      else if (share >= 0.8 && worse === 0) proposal = `الإشارة ممتازة (${worked} من ${n}): ممكن تخفف ${knob} شوي لتلقط حالات أبكر، بعد مراجعة المدقق.`;
    }
    return { rule, n, worked, worse, share, knob, proposal };
  }).sort((a, b) => a.rule.localeCompare(b.rule));
}
