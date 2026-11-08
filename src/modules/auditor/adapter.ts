// The ONE place that knows the judge: it turns what overview/funnel.ts says about a period into a Claim. When the judge
// gains fields (SAR at stake, confidence, editable targets, a range), they are mapped here and nothing else changes.
import { outcome, type CrmBy } from '../overview/analytics';
import { medians, steps as judgeSteps, verdict as judgeVerdict } from '../overview/funnel';
import { canCompare, previous, type Dash } from '../overview/numbers';
import type { Claim } from './contract';

function judged(d: Dash, from: string, to: string, by: CrmBy, plat: string | undefined, l: 'ar' | 'en') {
  const a = outcome(d, from, to, by, plat);
  const [pf, pt] = previous(from, to);
  const b = canCompare(d, from, to) ? outcome(d, pf, pt, by, plat) : null;
  const list = judgeSteps(a, b, medians(d, to, plat), l);
  return { list, v: judgeVerdict(list, l) };
}
// What the judge shows the reader for this period, in both languages: the headline and the owner (for the owner's audit page)
export function judgeHeadline(d: Dash, from: string, to: string, by: CrmBy = 'lead', plat?: string): { ar: { title: string; owner: string | null }; en: { title: string; owner: string | null } } {
  const x = judged(d, from, to, by, plat, 'ar').v, y = judged(d, from, to, by, plat, 'en').v;
  return { ar: { title: x.title, owner: x.owner }, en: { title: y.title, owner: y.owner } };
}

export function claimFromJudge(d: Dash, from: string, to: string, by: CrmBy = 'lead', plat?: string): Claim {
  const { list, v } = judged(d, from, to, by, plat, 'ar');
  return {
    from, to, plat, by,
    // The shipped judge has hard floors nobody edits; its verdict carries no SAR, confidence or range yet
    steps: list.map(s => ({ key: s.key, now: s.now, prev: s.prev, median: s.median, target: s.floor, targetEdited: false, level: s.level, unattributed: s.unattributed, owner: s.owner })),
    verdict: { step: v.step, level: v.level, owner: v.owner },
  };
}
