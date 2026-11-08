// The marketing judge (pipeline/dash/00-judge.js, shared with the main page) on made-up numbers shaped like Leen's case:
// 4.17M impressions → 3,947 leads → 48 closings. Every step against an absolute target; no «تمام» under target.
import { describe, expect, it } from 'vitest';
import { type Formats, type Input, J, judgeInput } from './judge';
import { addDays, type Dash } from './numbers';

const f: Formats = {
  pct: v => `${Number(v.toFixed(2))}%`, sar: v => `${Math.round(v).toLocaleString('en-US')} SAR`, x: v => `${v.toFixed(2)}×`,
  qty: v => Math.round(v).toLocaleString('en-US'), num: (v, d) => v.toFixed(d),
};
const T = J.targets();   // the defaults: CTR 1%, click→lead 8%, lead→closing 8%, CPL 60, a closing ≤ ⅓ of its value, ROAS 3×
// Leen's shape: CTR 1.25%, 7.6% of clicks become a lead, 48 paid closings in the CRM (1.2%), 400 leads tied to an ad
const leen: Input = {
  top: { impr: 4_170_000, clicks: 52_125, results: 3947, spend: 180_000, cpl: null },
  sale: { crm: true, results: 3947, spend: 180_000, closings: 48, paid: 192_000, adClosings: 5, adLeads: 400, wide: false },
  cohort: null,
};
const run = (i: Input, l: 'ar' | 'en' = 'ar', t = T) => J.judge(i, t, l, f);
const step = (i: Input, k: string) => run(i).steps.find(s => s.key === k)!;
const healthy: Input = {
  top: { impr: 1_000_000, clicks: 12_000, results: 1200, spend: 60_000, cpl: 50 },
  sale: { crm: true, results: 1200, spend: 60_000, closings: 120, paid: 240_000, adClosings: 100, adLeads: 1000, wide: false },
  cohort: null,
};
const arabic = /[؀-ۿ]/;

describe("judge: Leen's shape (4.17M impressions → 3,947 leads → 48 closings)", () => {
  const v = run(leen);
  it('lead to closing is judged on the whole CRM: 48 ÷ 3,947 ≈ 1.2% against 8%, a disaster, owned by Sales', () => {
    const s = v.steps.find(x => x.key === 'sale')!;
    expect(s.now).toBeCloseTo((100 * 48) / 3947);
    expect(s.level).toBe('disaster');
    expect(s.owner).toBe('المبيعات');
    expect(s.line).toContain('1.22% مقابل هدف 8%');
  });
  it('the incomplete attribution is a note, never a reason to skip the sales verdict', () => {
    expect(v.unlinked).not.toBeNull();
    expect(v.step).toBe('sale');
    expect(v).toMatchObject({ level: 'disaster', owner: 'المبيعات', stage: 'من ليد إلى إقفالة', title: 'الليدز ما تصير إقفالات' });
  });
  it('carries every verdict field: severity, owner, stage, evidence, SAR at stake, confidence, rule and what would change it', () => {
    expect(v.evidence).toBe('1.22% مقابل هدف 8%');
    // (8% − 1.22%) × 3,947 leads × 4,000 SAR a closing
    expect(v.sar).toBeCloseTo(((8 - (100 * 48) / 3947) / 100) * 3947 * 4000, 0);
    expect(v.confidence).toBe('low');               // 400 of 3,947 leads tied to an ad
    expect(v.rule).toBe('من ليد إلى إقفالة: أقل من نص الهدف');
    expect(v.change).toContain('لو وصل 4%');        // half the target is «مشكلة»
    expect(v.change).toContain('«مشكلة»');
  });
  it('low attribution gives a best/worst range: only ad-tied closings vs every paid closing', () => {
    const s = v.steps.find(x => x.key === 'sale')!;
    expect(s.range!.worst).toBeCloseTo((100 * 5) / 3947);
    expect(s.range!.best).toBeCloseTo((100 * 48) / 3947);
    expect(s.line).toMatch(/بين 0.13% و1.22%/);
  });
  it('the end-to-end rate and the biggest loss by department', () => {
    expect(v.e2e!.now).toBeCloseTo((1e5 * 48) / 4_170_000);
    expect(v.e2e!.target).toBeCloseTo(6.4);
    expect(v.e2e!.level).toBe('disaster');
    expect(v.e2e!.line).toContain('كل 100 ألف ظهور');
    expect(v.losses[0]).toMatchObject({ key: 'sales' });
    expect(v.biggest).toMatch(/^أكبر خسارة: المبيعات ≈ /);
  });
  it('every under-target step says so with its gap; a step on target says «تمام»', () => {
    expect(step(leen, 'lead')).toMatchObject({ level: 'watch' });     // 7.57% vs 8%
    expect(step(leen, 'click')).toMatchObject({ level: 'fine' });     // 1.25% vs 1%
    expect(step(leen, 'cpl')).toMatchObject({ level: 'fine' });       // 45.6 SAR vs 60
    expect(step(leen, 'cpa').level).toBe('disaster');                 // 3,750 SAR vs a third of 4,000
    expect(step(leen, 'lead').line).toContain('مقابل هدف 8%');
  });
});

describe('judge: severity by how far under target', () => {
  const ctr = (clicks: number) => step({ ...healthy, top: { ...healthy.top, clicks } }, 'click');
  it('at or over target: fine; under 20% short: watch; 20–50%: problem; under half: disaster', () => {
    expect(ctr(10_000).level).toBe('fine');      // 1.0%
    expect(ctr(9_000).level).toBe('watch');      // 0.9%
    expect(ctr(6_000).level).toBe('problem');    // 0.6%
    expect(ctr(4_000).level).toBe('disaster');   // 0.4%
  });
  it('a cost is the other way round: over target is under par', () => {
    const cpl = (v: number) => step({ ...healthy, top: { ...healthy.top, cpl: v } }, 'cpl').level;
    expect([cpl(60), cpl(70), cpl(100), cpl(130)]).toEqual(['fine', 'watch', 'problem', 'disaster']);
  });
  it('no green «تمام» when any step is under target; «لا توجد مشكلة» only when all meet theirs', () => {
    expect(run(healthy)).toMatchObject({ level: 'fine', title: 'لا توجد مشكلة', step: null });
    const oneShort = run({ ...healthy, top: { ...healthy.top, clicks: 9_500 } });
    expect(oneShort.level).toBe('watch');
    expect(oneShort.title).not.toBe('لا توجد مشكلة');
    expect(oneShort.step).toBe('click');
  });
  it('the worst severity leads; among equals the most SAR at stake', () => {
    const v = run({ ...healthy, top: { ...healthy.top, clicks: 4_000, results: 400 }, sale: { ...healthy.sale, results: 400 } });
    expect(v.level).toBe('disaster');
    expect(['click', 'sale']).toContain(v.step);
    const dis = v.steps.filter(s => s.level === 'disaster' && s.sar != null).sort((a, b) => b.sar! - a.sar!);
    expect(v.step).toBe(dis[0]!.key);
  });
});

describe('judge: minimum sample', () => {
  it('under 200 clicks: «العينة صغيرة», never worse than «انتبه», low confidence', () => {
    const s = step({ ...healthy, top: { ...healthy.top, impr: 50_000, clicks: 150, results: 2 } }, 'lead');
    expect(s).toMatchObject({ small: true, level: 'watch', confidence: 'low' });
    expect(s.line).toContain('العينة صغيرة');
    expect(s.rule).toContain('أعلى حكم «انتبه»');
  });
  it('under 30 leads on the CRM side: the sale step is a small sample too', () => {
    const s = step({ ...healthy, sale: { ...healthy.sale, results: 20, closings: 0, adClosings: 0, adLeads: 18 } }, 'sale');
    expect(s).toMatchObject({ small: true, level: 'watch' });
  });
});

describe('judge: data trust', () => {
  const at = (adLeads: number) => step({ ...healthy, sale: { ...healthy.sale, closings: 24, adLeads } }, 'sale');
  it('confidence from how many leads the CRM ties to an ad: ≥70% high, ≥30% medium, else low', () => {
    expect(at(900).confidence).toBe('high');
    expect(at(500).confidence).toBe('medium');
    expect(at(100).confidence).toBe('low');
    expect(at(900).range).toBeNull();
    expect(at(100).range).not.toBeNull();
  });
  it('no CRM: the sale side cannot be judged, the rest still is, and the note says why', () => {
    const v = run({ ...healthy, sale: { ...healthy.sale, crm: false } });
    expect(v.steps.find(s => s.key === 'sale')).toMatchObject({ level: 'na', unattributed: true });
    expect(v.unlinked!.why).toContain('نظام العملاء مو موصول');
    expect(v.e2e).toBeNull();
    expect(v.level).toBe('fine');
  });
  it('a platform filter: the CRM side is account-wide, said so, and no end-to-end rate', () => {
    const v = run({ ...leen, sale: { ...leen.sale, wide: true } });
    expect(v.steps.find(s => s.key === 'sale')!.line).toContain('من كل نظام العملاء');
    expect(v.e2e).toBeNull();
  });
});

describe('judge: cohort maturity', () => {
  const to = '2026-10-31';
  const byDay: [string, number][] = Array.from({ length: 60 }, (_, i) => [addDays(to, -i), 50]);
  it('splits the leads into mature (older than the window) and young, with the median days to close', () => {
    const paid: [string, string | null][] = [[addDays(to, -50), addDays(to, -40)], [addDays(to, -45), addDays(to, -41)], [addDays(to, -10), addDays(to, -2)]];
    const c = J.cohort(byDay, paid, addDays(to, -59), to, to, 30);
    expect(c.mature).toBe(30 * 50);          // days 30..59 back
    expect(c.young).toBe(30 * 50);
    expect(c.matureClosings).toBe(2);
    expect(c.medianDays).toBe(8);            // 10, 4, 8 days
  });
  it('judges lead to closing on the mature leads when there are enough, and says so', () => {
    const s = J.judge({ ...healthy, cohort: { mature: 600, young: 600, matureClosings: 60, medianDays: 9, cut: to } }, T, 'ar', f).steps.find(x => x.key === 'sale')!;
    expect(s.now).toBeCloseTo(10);
    expect(s.line).toContain('على الليدز الناضجة');
  });
  it('too few mature leads: the whole period, «الحكم مبدئي», at most medium confidence', () => {
    const v = J.judge({ ...healthy, cohort: { mature: 10, young: 1190, matureClosings: 1, medianDays: null, cut: to } }, T, 'ar', f);
    const s = v.steps.find(x => x.key === 'sale')!;
    expect(s.now).toBeCloseTo(10);           // 120 ÷ 1,200
    expect(s.line).toContain('الحكم مبدئي');
    expect(s.confidence).toBe('medium');
    expect(v.cohort!.line).toContain('ليدز لسه بدري: 1,190');
  });
});

describe('judge: targets and languages', () => {
  it('targets: defaults, then targets.json, then the viewer; nonsense is ignored', () => {
    expect(J.targets({ ctr: 1.5 }, { leadToClose: 10, cpl: -3, roas: 'x' })).toMatchObject({ ctr: 1.5, leadToClose: 10, cpl: 60, roas: 3 });
    expect(J.FIELDS.map(x => x.key)).toEqual(Object.keys(J.DEFAULTS));
  });
  it('a stricter target turns «تمام» into «انتبه»', () => {
    expect(J.judge(healthy, J.targets({ ctr: 1.3 }), 'ar', f).steps.find(s => s.key === 'click')!.level).toBe('watch');   // 1.2% vs 1.3%
  });
  it('every text in English has no Arabic letters, in every scenario', () => {
    for (const i of [leen, healthy, { ...healthy, sale: { ...healthy.sale, crm: false } }, { ...leen, sale: { ...leen.sale, wide: true } },
      { ...healthy, top: { ...healthy.top, clicks: 150 } }, { ...healthy, cohort: { mature: 10, young: 1190, matureClosings: 1, medianDays: 6, cut: '2026-10-01' } }]) {
      const v = run(i, 'en');
      const text = [v.title, v.why, v.todo, v.owner ?? '', v.stage, v.evidence, v.rule, v.change, v.biggest ?? '', v.trust.line, v.cohort?.line ?? '', v.e2e?.line ?? '',
        v.unlinked?.why ?? '', v.unlinked?.todo ?? '', v.unlinked?.owner ?? '', ...v.steps.flatMap(s => [s.label, s.line, s.owner, s.fix, s.rule, s.change])].join(' ');
      expect(text).not.toMatch(arabic);
    }
    expect(run(healthy, 'en').title).toBe('No problem');
    expect(run(leen, 'en').evidence).toBe('1.22% vs a target of 8%');
  });
  it('the Arabic addresses the reader in the masculine', () => {
    const v = run(leen);
    const text = [v.todo, v.change, ...v.steps.map(s => s.fix)].join(' ');
    expect(text).not.toMatch(/(راجعي|سرّعي|تأكدي|وسّعي|شيكي|جرّبي|قصّري)/);
  });
});

describe('judge: input from dash.json (Overview)', () => {
  const to = '2026-10-30', from = addDays(to, -6);
  const ads = { a: { name: 'a', campaign: 'c', platform: 'facebook', goal: 'lead' }, b: { name: 'b', campaign: 'c', platform: 'snap', goal: 'lead' } };
  const rows: unknown[][] = [];
  for (let i = 0; i < 7; i++) rows.push(['a', addDays(to, -i), 100, 10_000, 100, 10, 0], ['b', addDays(to, -i), 50, 5_000, 50, 5, 0]);
  const D = { ads, rows, range: { end: to }, crm: { rows: [['a', to, to, true, 900]], paid_all: [[to, to, 900, 'x'], [addDays(to, -3), to, 400, 'y']] } } as unknown as Dash;
  it('the top from the filtered ads, the CRM side from the whole account', () => {
    const i = judgeInput(D, from, to, 'lead', 'facebook', 30);
    expect(i.top).toMatchObject({ impr: 70_000, clicks: 700, results: 70 });
    expect(i.sale).toMatchObject({ crm: true, results: 105, closings: 2, paid: 1300, adClosings: 1, wide: true });
    expect(i.cohort).toMatchObject({ mature: 0, young: 105, matureClosings: 0, medianDays: 1.5 });
  });
  it('all platforms: not wide, and the end-to-end rate shows', () => {
    const i = judgeInput(D, from, to, 'lead', undefined, 30);
    expect(i.sale.wide).toBe(false);
    expect(J.judge(i, T, 'ar', f).e2e).not.toBeNull();
  });
});
