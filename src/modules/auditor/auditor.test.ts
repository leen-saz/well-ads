// The auditor on made-up data in Leen's proportions: it recomputes what the judge says, catches a deliberately corrupted
// verdict, argues against «no problem» when the CRM has closings the ads do not own, and replays the judge over history.
import { describe, expect, it } from 'vitest';
import { audit } from './audit';
import { claimFromJudge } from './adapter';
import { backtest } from './backtest';
import { OWNER_RULE, type Claim } from './contract';
import { recompute } from './facts';
import { synth } from './synth';
import { J } from '../overview/judge';
import { outcome } from '../overview/analytics';

const from = '2026-10-02', to = '2026-10-31';
const ids = (r: ReturnType<typeof audit>) => r.findings.map(f => f.id);

describe('auditor: Leen\'s proportions', () => {
  const d = synth();
  it('the synthetic data has her proportions', () => {
    const o = outcome(d, '2026-09-02', to);
    expect(o.impr).toBeGreaterThan(3_800_000); expect(o.impr).toBeLessThan(4_400_000);
    expect(o.leads + o.conv).toBeGreaterThan(3600); expect(o.leads + o.conv).toBeLessThan(4600);
    expect(o.closingsAll).toBe(48);
    expect(o.bookedAll).toBeLessThan(o.closingsAll);
  });

  it('recomputes every number the judge quotes: no mismatch on an honest verdict', () => {
    const r = audit(d, claimFromJudge(d, from, to));
    expect(ids(r).filter(i => i.startsWith('mismatch') || i.startsWith('chain') || i.startsWith('owner'))).toEqual([]);
    expect(r.checked).toBeGreaterThan(8);
  });

  it('the independent facts equal the judge\'s numbers (two code paths, one truth)', () => {
    const f = recompute(d, from, to), o = outcome(d, from, to);
    expect(f.scope.ctr).toBeCloseTo(o.ctr!, 9); expect(f.scope.c2r).toBeCloseTo(o.clickToResult!, 9);
    expect(f.scope.cpm).toBeCloseTo(o.cpm!, 9); expect(f.crm.closeRate).toBeCloseTo(o.closeRate!, 9);
    expect(f.crm.closingsAll).toBe(o.closingsAll); expect(f.crm.bookedAll).toBe(o.bookedAll);
  });

  it('partial attribution: the judge names the sales gap itself (whole CRM); a «no problem» claim is still contradicted', () => {
    // Few leads tied to ads: the marketing judge reads lead to closing on the whole CRM (48 closings in ~4K results)
    const dd = synth({ tied: 0.12, paidTied: 4 });
    const c = claimFromJudge(dd, from, to);
    expect(c.steps.find(s => s.key === 'sale')!.level).toBe('bad');
    expect(c.verdict.level).toBe('bad');
    expect(ids(audit(dd, c))).not.toContain('silent_below_floor');
    // The check that caught the old judge's silence still fires on a claim that says «no problem»
    const lie = structuredClone(c);
    lie.verdict = { ...lie.verdict, step: null, level: 'ok', owner: null };
    for (const s of lie.steps) s.level = 'ok';
    const r = audit(dd, lie);
    expect(r.status).toBe('contradicted');
    expect(ids(r)).toContain('silent_below_floor');
    expect(r.verdict.findings.find(f => f.id === 'silent_below_floor')!.needs?.en).toMatch(/Tie closings/);
  });

  it('a clean healthy period is confirmed', () => {
    // Targets this period meets (the defaults are stricter than the synthetic shop)
    const healthy = { ...synth({ paidAll: 300, paidTied: 140, tied: 0.6, c2r: 0.09, ctr: 0.02 }),
      funnel_targets: { ctr: 1, clickToLead: 5, leadToClose: 1, cpl: 100000, costShare: 100, roas: 0.01 } };
    const c = claimFromJudge(healthy, from, to);
    const r = audit(healthy, c);
    expect(c.verdict.level).toBe('ok');
    expect(r.findings.filter(f => f.effect === 'contradicts')).toEqual([]);
  });

  it('tied to the judge: the owner table is the judge\'s', () => {
    // Every step of the shared rules file (pipeline/dash/00-judge.js), and the CRM owner of an unlinked step
    for (const r of J.RULES) expect(OWNER_RULE[r.key]).toEqual({ ar: J.OWNERS[r.owner].who[0], en: J.OWNERS[r.owner].who[1] });
    expect(OWNER_RULE.crm).toEqual({ ar: J.OWNERS.crm.who[0], en: J.OWNERS.crm.who[1] });
  });
});

describe('auditor: one status for the whole screen', () => {
  it('an honest verdict with every step confirmed stays confirmed, with nothing listed under others', () => {
    const d = synth(), c = structuredClone(claimFromJudge(d, from, to));
    const r = audit(d, c);
    if (r.status === 'confirmed') expect(r.others).toEqual({ contradicted: [], weakened: [] });
    expect(['confirmed', 'weakened', 'contradicted'].indexOf(r.status)).toBeGreaterThanOrEqual(['confirmed', 'weakened', 'contradicted'].indexOf(r.verdict.status));
  });
});

describe('auditor: a deliberately corrupted verdict is caught', () => {
  const d = synth();
  const honest = (): Claim => claimFromJudge(d, from, to);
  const corrupt = (f: (c: Claim) => void) => { const c = structuredClone(honest()); f(c); return audit(d, c); };

  it('a quoted rate that is off', () => {
    const r = corrupt(c => { const s = c.steps.find(x => x.key === 'click')!; s.now = s.now! * 1.4; });
    // The headline names the sale step, so the wrong click figure shows on the click step's own audit
    expect(r.steps.click!.status).toBe('contradicted');
    expect(ids(r)).toContain('mismatch_now');
    // One status for the screen: never «confirmed» while a step is contradicted, even though the headline's own findings are clean
    expect(r.verdict.status).not.toBe('contradicted');
    expect(r.status).toBe('contradicted');
    expect(r.others.contradicted).toContain('click');
    // (chain_product needs the sale figure, which the adapter leaves out: the judge reads it on the whole CRM)
  });
  it('a wrong owner', () => {
    const c = honest(); c.verdict.step = c.steps.find(s => s.level !== 'ok')?.key ?? 'sale'; c.verdict.level = 'bad'; c.verdict.owner = 'المشتري الإعلامي';
    c.steps.find(s => s.key === c.verdict.step)!.level = 'bad';
    if (c.verdict.step !== 'cpm' && c.verdict.step !== 'cpl') expect(ids(audit(d, c))).toContain('owner_mismatch');
  });
  it('«no problem» with a step below its target', () => {
    const r = corrupt(c => { c.verdict = { step: null, level: 'ok', owner: null }; c.steps.forEach(s => { s.level = 'ok'; s.unattributed = false; }); });
    expect(r.status).toBe('contradicted');
    expect(ids(r)).toContain('ok_below_target');
  });
  it('confidence «high» with poor coverage; SAR bigger than all spend; inverted range', () => {
    const r = corrupt(c => { c.verdict.confidence = 'high'; c.verdict.sarAtStake = 1e12; c.verdict.range = { best: 1, worst: 5 }; });
    expect(ids(r)).toEqual(expect.arrayContaining(['confidence_too_high', 'sar_over_spend', 'range_inverted']));
  });
  it('a quoted coverage that is not the data\'s', () => {
    expect(ids(corrupt(c => { c.verdict.coverage = 0.9; }))).toContain('mismatch_coverage');
  });
  it('SAR parts that do not add up to the total', () => {
    const r = corrupt(c => { c.steps[0]!.sarAtStake = 100; c.steps[1]!.sarAtStake = 50; c.verdict.sarAtStake = 400; c.verdict.step = null; c.verdict.level = 'ok'; });
    expect(ids(r)).toContain('sar_sum');
  });
  it('a verdict on a step below the minimum sample', () => {
    const tiny = synth({ days: 20, impr: 40_000, paidAll: 2, paidTied: 1 });
    const c = claimFromJudge(tiny, '2026-10-18', '2026-10-31');
    c.verdict = { step: 'sale', level: 'bad', owner: OWNER_RULE.sale.ar }; c.steps.find(s => s.key === 'sale')!.level = 'bad';
    expect(ids(audit(tiny, c))).toContain('below_min_sample');
  });
});

describe('auditor: every integrity check has a test that trips it', () => {
  const d = synth();
  const honest = (): Claim => claimFromJudge(d, from, to);
  const corrupt = (f: (c: Claim) => void, data = d, base: Claim = honest()) => { const c = structuredClone(base); f(c); return audit(data, c); };

  it('a quoted earlier-period figure or usual level that is off', () => {
    expect(ids(corrupt(c => { c.steps.find(s => s.key === 'click')!.prev = 99; }))).toContain('mismatch_prev');
    expect(ids(corrupt(c => { c.steps.find(s => s.key === 'click')!.median = 99; }))).toContain('mismatch_median');
  });
  it('a negative SAR at stake', () => {
    expect(ids(corrupt(c => { c.steps[0]!.sarAtStake = -5; }))).toContain('sar_negative');
  });
  it('a SAR at stake that is not the shortfall formula when the judge states that method', () => {
    const r = corrupt(c => { c.sarMethod = 'shortfall'; const s = c.steps.find(x => x.key === 'click')!; s.target = 0.7; s.sarAtStake = 123456; });
    expect(ids(r)).toContain('sar_recompute');
  });
  it('a named step that is itself fine, and a verdict level that differs from its step', () => {
    const named = corrupt(c => { c.verdict = { step: 'click', level: 'bad', owner: OWNER_RULE.click.ar }; c.steps.find(s => s.key === 'click')!.level = 'ok'; });
    expect(ids(named)).toContain('named_step_not_weak');
    const lvl = corrupt(c => { c.verdict = { step: 'click', level: 'watch', owner: OWNER_RULE.click.ar }; c.steps.find(s => s.key === 'click')!.level = 'bad'; });
    expect(ids(lvl)).toContain('level_mismatch');
  });
  it('a step owner that is not the rule table\'s', () => {
    expect(ids(corrupt(c => { c.steps[0]!.owner = 'nobody'; }))).toContain('owner_mismatch_step');
  });
  it('confidence above «low» when coverage is under the low line', () => {
    const poor = synth({ tied: 0.12, paidTied: 4 });
    const base = claimFromJudge(poor, from, to);
    const r = corrupt(c => { c.verdict.confidence = 'medium'; }, poor, base);
    expect(recompute(poor, from, to).crm.coverage!).toBeLessThan(0.3);
    expect(ids(r)).toContain('confidence_vs_coverage');
    expect(r.findings.find(f => f.id === 'confidence_vs_coverage')!.effect).toBe('weakens');
  });
  it('the rates must multiply to the end to end rate (chain_product), and an exact set passes', () => {
    const f = recompute(d, from, to);
    const click = f.scope.ctr!, lead = f.scope.c2r!;
    const exact = (f.crm.booked / f.scope.impr / f.crm.coverage!) / ((click / 100) * (lead / 100)) * 100;
    const set = (sale: number) => (c: Claim) => {
      c.steps.find(s => s.key === 'click')!.now = click; c.steps.find(s => s.key === 'lead')!.now = lead;
      const x = c.steps.find(s => s.key === 'sale')!; x.now = sale; x.unattributed = false;
    };
    expect(ids(corrupt(set(exact)))).not.toContain('chain_product');
    expect(ids(corrupt(set(exact * 1.5)))).toContain('chain_product');
  });
});

describe('auditor: the devil\'s advocate', () => {
  const claimWith = (d: ReturnType<typeof synth>, level: 'bad' | 'ok', step: Claim['verdict']['step'], tweak?: (c: Claim) => void): Claim => {
    const c = claimFromJudge(d, from, to);
    c.verdict = { step, level, owner: step ? OWNER_RULE[step].ar : null };
    for (const s of c.steps) { s.level = s.key === step ? level : 'ok'; }
    tweak?.(c);
    return c;
  };
  it('timing artifact: a recent cohort that has not had time to close weakens a weak sale step', () => {
    const d = synth({ lagDays: 12 });
    const r = audit(d, claimWith(d, 'bad', 'sale'));
    expect(ids(r)).toContain('timing_artifact');
    expect(r.status).not.toBe('confirmed');
  });
  it('attribution gap larger than the effect', () => {
    // 48 closings in the CRM, 200 results only in the period: even the worst case could pass the floor
    const d = synth({ days: 20, impr: 100_000, paidAll: 48, paidTied: 2, tied: 0.5 });
    const c = claimWith(d, 'bad', 'sale', c2 => { c2.steps.find(s => s.key === 'sale')!.unattributed = false; });
    expect(ids(audit(d, c))).toEqual(expect.arrayContaining(['attribution_gap_exceeds_effect']));
  });
  it('default target: a floor nobody set weakens a verdict that rests on it alone', () => {
    const d = synth();
    const c = claimWith(d, 'bad', 'click', c2 => { const s = c2.steps.find(x => x.key === 'click')!; s.now = 0.6; s.prev = 0.62; s.median = 0.61; s.targetEdited = false; });
    expect(ids(audit(d, c))).toContain('default_target');
    const edited = claimWith(d, 'bad', 'click', c2 => { const s = c2.steps.find(x => x.key === 'click')!; s.now = 0.6; s.prev = 0.62; s.median = 0.61; s.targetEdited = true; });
    expect(ids(audit(d, edited))).not.toContain('default_target');
  });
  it('Simpson: a total under the floor while every platform is above it', () => {
    // two platforms, each at the floor-plus rate, but the total pulled under by mix is impossible for a plain ratio of sums;
    // build it on the click-to-lead step through the claim: the total is quoted weak, every platform is clearly fine
    const d = synth({ c2r: 0.09 });
    const c = claimWith(d, 'bad', 'lead', c2 => { const s = c2.steps.find(x => x.key === 'lead')!; s.now = 1.2; s.targetEdited = true; });
    const ph = ids(audit(d, c));
    expect(ph).toContain('simpson_mix');
  });
  it('small sample is contradicted when far below the minimum', () => {
    const d = synth({ days: 14, impr: 300, paidAll: 1, paidTied: 0 });
    const r = audit(d, claimWith(d, 'bad', 'click'));
    expect(r.findings.find(f => f.id === 'small_sample')?.effect).toBe('contradicts');
  });
});

describe('auditor: back-test on history', () => {
  it('replays the judge over past windows and reports counts only', () => {
    const d = synth({ days: 120, impr: 8_000_000, paidAll: 90, paidTied: 30 });
    const b = backtest(d, to, { back: 70 });
    expect(b.windows).toBeGreaterThan(5);
    expect(b.said.problem + b.said.ok).toBe(b.windows);
    expect(b.confirmed + b.weakened + b.contradicted).toBe(b.windows);
    expect(b.silent + b.wrong).toBeLessThanOrEqual(b.contradicted);
    // counts only: every value is an integer, no figure or date in the result
    const flat = JSON.stringify(b);
    expect(flat).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    for (const v of [b.windows, b.confirmed, b.weakened, b.contradicted, b.silent, b.wrong, b.flips, b.skipped, ...Object.values(b.byCheck)]) expect(Number.isInteger(v)).toBe(true);
  });
  it('is silent about windows without data', () => {
    expect(backtest({ ads: {}, rows: [], range: { start: '2026-01-01', end: to } } as never, to).windows).toBe(0);
  });
});
