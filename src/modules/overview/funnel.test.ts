// The journey's rules and shape on made-up numbers: which step is the bottleneck and why, the usual level (30-day
// median), the floors, and a band whose height follows the volume and whose waist narrows on a weak step.
import { describe, expect, it } from 'vitest';
import { FLOORS, medians, points, shape, stageX, steps, verdict } from './funnel';
import { outcome, type Outcome } from './analytics';
import { addDays, type Dash } from './numbers';

// A healthy period: CTR 1.5%, 3% of clicks become a lead or chat, 10% of ad-linked leads close, 50 SAR a lead
const base: Outcome = {
  spend: 15000, impr: 200000, clicks: 3000, leads: 70, conv: 20, crm: true, crmLinked: true, crmLeads: 60, booked: 6, value: 9000,
  closings: 8, paid: 12000, cpm: 75, cpc: 5, ctr: 1.5, cpl: 50, clickToResult: 3, closeRate: 10, roas: 0.6, mer: 0.8, cac: 1875, closingsAll: 8, bookedAll: 6,
};
const as = (o: Partial<Outcome>): Outcome => ({ ...base, ...o });
const usual = { click: 1.5, lead: 3, cpl: 50 };

describe('overview: funnel rules', () => {
  it('all steps as usual: no clear bottleneck, still names the weakest', () => {
    const v = verdict(steps(base, base, usual));
    expect(v.level).toBe('ok');
    expect(v.title).toBe('ما فيه عنق زجاجة واضح');
  });

  it('a low click rate points at the creative and the first line', () => {
    const v = verdict(steps(as({ ctr: 0.9 }), base, usual));
    expect(v).toMatchObject({ step: 'click', level: 'bad', where: 'من الظهور للنقرة' });
    expect(v.todo).toContain('أول سطر');
  });

  it('clicks that stop becoming leads point at the form, the page and the WhatsApp entry', () => {
    const v = verdict(steps(as({ clickToResult: 2 }), base, usual));
    expect(v).toMatchObject({ step: 'lead', where: 'من النقرة لليد' });
    expect(v.why).toContain('النموذج');
    expect(v.why).toContain('الواتساب');
  });

  it('leads that stop closing point at follow-up speed and lead quality', () => {
    const v = verdict(steps(as({ closeRate: 5 }), base, usual));
    expect(v).toMatchObject({ step: 'sale', level: 'bad' });
    expect(v.why).toContain('المتابعة');
  });

  it('a rising cost per lead points at audience and creative fatigue (lower is better)', () => {
    const list = steps(as({ cpl: 80 }), base, usual);
    expect(list.find(s => s.key === 'cpl')!.score).toBeCloseTo(50 / 80);
    expect(verdict(list)).toMatchObject({ step: 'cpl', where: 'تكلفة الليد' });
  });

  it('no CRM, too few leads tied to ads, or paid closings with none tied to an ad: «غير مربوط», never the bottleneck', () => {
    for (const o of [as({ crmLinked: false, crm: false, crmLeads: 0 }), as({ crmLeads: 10 }), as({ booked: 0, closeRate: 0, closings: 45, closingsAll: 45, bookedAll: 0 })]) {
      const list = steps(o, base, usual);
      const sale = list.find(s => s.key === 'sale')!;
      expect(sale).toMatchObject({ unattributed: true, now: null, score: null });
      expect(sale.line).toMatch(/^غير مربوط/);
      const v = verdict(list);
      expect(v.step).not.toBe('sale');
      expect(v.unlinked?.todo).toContain('صفحة الربط');
    }
  });

  it("Leen's case: 45 paid closings, none tied to an ad, a valid earlier rate: no 0% and no −100% bottleneck", () => {
    const now = as({ booked: 0, closeRate: 0, closings: 45, closingsAll: 45, bookedAll: 0 });
    const list = steps(now, base, usual), sale = list.find(s => s.key === 'sale')!;
    expect(sale.prev).toBeNull();
    expect(sale.line).toContain('45 إقفالة');
    expect(sale.line).toContain('مو صفر');
    expect(sale.line).not.toMatch(/0\.00%|100%/);
    expect(verdict(list)).toMatchObject({ level: 'ok', title: 'ما فيه عنق زجاجة واضح' });
  });

  it('a step under its floor is the bottleneck before one that is only weaker than usual, even with a higher score', () => {
    // click→lead 1.43% (floor 1.5, 17% under the earlier 1.72: score 0.83, bad); cost per lead +23% (score 0.82, watch)
    const v = verdict(steps(as({ clickToResult: 1.43, cpl: 81.5 }), as({ clickToResult: 1.72, cpl: 66.5 }), { click: null, lead: null, cpl: null }));
    expect(v).toMatchObject({ step: 'lead', level: 'bad' });
  });

  it('below the floor is weak even when the history was as bad', () => {
    const low = as({ ctr: FLOORS.click / 2 });
    const st = steps(low, low, { ...usual, click: FLOORS.click / 2 }).find(s => s.key === 'click')!;
    expect(st.level).toBe('bad');
    expect(st.line).toContain('تحت الحد المقبول');
  });

  it('with no valid comparison it judges on the usual level and the floor only', () => {
    const st = steps(as({ ctr: 1.2 }), null, usual).find(s => s.key === 'click')!;
    expect(st.prev).toBeNull();
    expect(st.score).toBeCloseTo(1.2 / 1.5);
    expect(st.level).toBe('watch');
    expect(st.line).not.toContain('الفترة اللي قبلها');
  });

  it('every line and verdict addresses the reader in the masculine', () => {
    const all = [as({ ctr: 0.5 }), as({ clickToResult: 1 }), as({ closeRate: 1 }), as({ cpl: 200 }), as({ crmLinked: false }), as({ booked: 0, closings: 9, closingsAll: 9, bookedAll: 0 })]
      .flatMap(o => { const l = steps(o, base, usual); const v = verdict(l); return [v.why, v.todo, v.unlinked?.why ?? '', v.unlinked?.todo ?? '', ...l.map(s => s.line)]; }).join(' ');
    expect(all).not.toMatch(/تسوين|شيكي|جربي|غيري|وسعي|قصري|تأكدي/);
  });
});

describe('overview: the usual level (30-day median of daily values)', () => {
  const to = '2026-10-30';
  const ads = { a: { name: 'a', campaign: 'c', platform: 'facebook', goal: 'lead' }, b: { name: 'b', campaign: 'c', platform: 'snap', goal: 'lead' } };
  // 20 days: facebook at 1% CTR, snap at 3%; one tiny day that must not count; one day outside the 30
  const rows: unknown[][] = [];
  for (let i = 0; i < 20; i++) {
    const day = addDays(to, -i);
    rows.push(['a', day, 100, 1000, 10, 2, 0], ['b', day, 100, 1000, 30, 1, 0]);
  }
  rows.push(['a', addDays(to, -25), 1, 50, 40, 0, 0], ['a', addDays(to, -40), 100, 1000, 900, 0, 0]);
  const D = { ads, rows } as unknown as Dash;

  it('takes the median of days with enough volume, inside the 30 days', () => {
    const m = medians(D, to);
    expect(m.click).toBeCloseTo(2);           // (10 + 30) / 2000
    expect(m.lead).toBeCloseTo(7.5);          // 3 results / 40 clicks
    expect(m.cpl).toBeCloseTo(200 / 3);
  });
  it('per platform', () => {
    expect(medians(D, to, 'facebook').click).toBeCloseTo(1);
    expect(medians(D, to, 'snap').click).toBeCloseTo(3);
  });
  it('no usual level with fewer than 7 qualifying days', () => {
    expect(medians({ ads, rows: rows.slice(0, 10) } as unknown as Dash, to).click).toBeNull();
  });
  it('the platform filter: only that platform, closings from the ad-linked CRM rows', () => {
    const C = { ...D, crm: { rows: [['a', to, to, true, 500], ['b', to, to, true, 700]], paid_all: [[to, to, 500, 'x'], [to, to, 700, 'y'], [to, to, 900, 'z']] } } as unknown as Dash;
    const all = outcome(C, addDays(to, -6), to), fb = outcome(C, addDays(to, -6), to, 'lead', 'facebook');
    expect(all).toMatchObject({ crm: true, closings: 3, impr: 14000 });
    expect(fb).toMatchObject({ crm: false, crmLinked: true, closings: 1, paid: 500, booked: 1, value: 500, impr: 7000, clicks: 70 });
  });
  it('a platform filter cannot turn missing attribution into a 0% close rate: attribution is judged across all platforms', () => {
    // Paid closings in the CRM, none tied to an ad; plenty of CRM leads tied to facebook ads
    const leads = Array.from({ length: 40 }, () => ['a', to, '', false, 0]);
    const C = { ...D, crm: { rows: leads, paid_all: [[to, to, 900, 'manual'], [to, to, 900, 'manual']] } } as unknown as Dash;
    const fb = outcome(C, addDays(to, -6), to, 'lead', 'facebook');
    expect(fb).toMatchObject({ booked: 0, closeRate: 0, closingsAll: 2, bookedAll: 0 });
    const sale = steps(fb, null, { click: null, lead: null, cpl: null }).find(s => s.key === 'sale')!;
    expect(sale).toMatchObject({ unattributed: true, now: null });
    expect(sale.line).toContain('2 إقفالة');
  });
});

describe('overview: the band', () => {
  it('height shrinks with the numbers (eased scale); the sale stage stays visible; no data = the thinnest', () => {
    const s = shape([2000000, 30000, 600, 12], [1, 1, 1], 190, 28);
    expect(s.heights[0]).toBe(190);
    expect(s.heights.every((h, i) => i === 0 || h < s.heights[i - 1]!)).toBe(true);
    expect(s.heights[1]).toBeLessThan(190 * 0.6);   // 66x fewer clicks than impressions must look much smaller
    expect(s.heights[3]).toBeGreaterThan(28);
    expect(shape([100, 10, 1, null], [1, 1, 1], 190, 28).heights[3]).toBe(28);
  });
  it('every link narrows into a neck; a weak step pinches it further', () => {
    const ok = shape([1000, 100, 10, 1], [1, 1, 1], 190, 28), weak = shape([1000, 100, 10, 1], [1, 0.5, 1], 190, 28);
    expect(weak.waists[1]).toBeLessThan(ok.waists[1]!);
    expect(weak.waists[1]).toBeCloseTo(ok.waists[1]! * 0.5);
    ok.waists.forEach((w, i) => expect(w).toBeLessThan(Math.min(ok.heights[i]!, ok.heights[i + 1]!)));
    expect(shape([1000, 100, 10, 1], [1, 0, 1], 190, 28).waists[1]).toBeGreaterThan(0);
  });
  it('reads right to left: stage 1 on the right, the points run left to right across the full width', () => {
    expect(stageX(0, 4, 960)).toBeGreaterThan(stageX(3, 4, 960));
    const p = points(shape([1000, 100, 10, 1], [1, 1, 1], 190, 28), 960);
    expect(p[0]!.x).toBe(0);
    expect(p[p.length - 1]!.x).toBe(960);
    expect(p.every((q, i) => i === 0 || q.x > p[i - 1]!.x)).toBe(true);
    expect(p[p.length - 1]!.h).toBe(190);          // the right end is the impressions
  });
});
