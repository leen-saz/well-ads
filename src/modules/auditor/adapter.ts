// The ONE place that knows the judge: it turns what the marketing judge (overview/judge.ts, the shared rules file
// pipeline/dash/00-judge.js) says about a period into a Claim. Only what the auditor recomputes the same way is stated;
// the rest is left out (a check whose input is missing is skipped, never guessed):
// - the sale, cost-per-closing and return figures: the judge reads them on the whole CRM (and lead to closing on the
//   mature cohort when there is one), the auditor's facts on the ad-tied CRM rows;
// - SAR at stake: the judge's is revenue at stake (closings × what one brings), the auditor bounds it by spend;
// - targets on the costs: the auditor's «under target» test reads a rate (lower is worse).
import type { CrmBy } from '../overview/analytics';
import type { Dash } from '../overview/numbers';
import { J, configTargets, formats, judgeInput, resolveTargets, savedTargets, type Severity, type Verdict } from '../overview/judge';
import type { Claim, Level, StepKey } from './contract';

const level = (s: Severity): Level => (s === 'problem' || s === 'disaster' ? 'bad' : s === 'watch' ? 'watch' : 'ok');
const RATES: StepKey[] = ['click', 'lead', 'sale'], CRM_SIDE: StepKey[] = ['sale', 'cpa', 'roas'];

function judged(d: Dash, from: string, to: string, by: CrmBy, plat: string | undefined, l: 'ar' | 'en'): Verdict {
  const t = resolveTargets(d, savedTargets());
  return J.judge(judgeInput(d, from, to, by, plat, t.maturityDays), t, l, formats());
}
// What the judge shows the reader for this period, in both languages: the headline and the owner (for the owner's audit page)
export function judgeHeadline(d: Dash, from: string, to: string, by: CrmBy = 'lead', plat?: string): { ar: { title: string; owner: string | null }; en: { title: string; owner: string | null } } {
  const x = judged(d, from, to, by, plat, 'ar'), y = judged(d, from, to, by, plat, 'en');
  return { ar: { title: x.title, owner: x.owner }, en: { title: y.title, owner: y.owner } };
}

export function claimFromJudge(d: Dash, from: string, to: string, by: CrmBy = 'lead', plat?: string): Claim {
  const v = judged(d, from, to, by, plat, 'ar');
  const cfg = configTargets(d), edits = savedTargets() ?? {};
  const field = { click: 'ctr', lead: 'clickToLead', sale: 'leadToClose' } as const;
  const sale = v.steps.find(s => s.key === 'sale');
  return {
    from, to, plat, by,
    steps: v.steps.map(s => {
      const k = s.key as StepKey, rate = RATES.includes(k);
      const f = rate ? field[k as 'click' | 'lead' | 'sale'] : null;
      return {
        key: k, level: level(s.level), unattributed: s.unattributed, owner: s.owner,
        ...(CRM_SIDE.includes(k) ? {} : { now: s.now }),
        ...(rate ? { target: s.target, targetEdited: !!f && edits[f] != null && edits[f] !== cfg[f] } : {}),
      };
    }),
    verdict: {
      step: v.step as StepKey | null, level: level(v.level), owner: v.owner, rule: v.rule, whatWouldChange: v.change,
      // How sure the judge is about the CRM side, stated only when the headline is on that side; the account-wide coverage
      // only when the period is not narrowed to a platform (the auditor's facts follow the filter)
      ...(v.step && CRM_SIDE.includes(v.step as StepKey) ? { confidence: v.confidence } : {}),
      ...(plat ? {} : { coverage: v.trust.coverage }),
      range: sale?.range && sale.range.best != null ? { best: sale.range.best, worst: sale.range.worst } : null,
    },
  };
}
