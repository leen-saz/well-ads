// The ONE place that knows the judge: it turns what overview/funnel.ts says about a period into a Claim. When the judge
// gains fields (SAR at stake, confidence, editable targets, a range), they are mapped here and nothing else changes.
import { outcome, type CrmBy } from '../overview/analytics';
import { medians, steps as judgeSteps, verdict as judgeVerdict } from '../overview/funnel';
import { canCompare, previous, type Dash } from '../overview/numbers';
import type { Claim } from './contract';

export function claimFromJudge(d: Dash, from: string, to: string, by: CrmBy = 'lead', plat?: string): Claim {
  const a = outcome(d, from, to, by, plat);
  const [pf, pt] = previous(from, to);
  const b = canCompare(d, from, to) ? outcome(d, pf, pt, by, plat) : null;
  const list = judgeSteps(a, b, medians(d, to, plat), 'ar');
  const v = judgeVerdict(list, 'ar');
  return {
    from, to, plat, by,
    // The shipped judge has hard floors nobody edits; its verdict carries no SAR, confidence or range yet
    steps: list.map(s => ({ key: s.key, now: s.now, prev: s.prev, median: s.median, target: s.floor, targetEdited: false, level: s.level, unattributed: s.unattributed, owner: s.owner })),
    verdict: { step: v.step, level: v.level, owner: v.owner },
  };
}
