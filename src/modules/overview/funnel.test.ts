// The journey's shape and numbers on made-up numbers: a band whose height follows the volume and whose waist narrows on
// a step under target, the journey labels in English, and the platform filter. The rules themselves: judge.test.ts.
import { describe, expect, it } from 'vitest';
import { points, shape, stageX } from './funnel';
import { journey, outcome, type Outcome } from './analytics';
import { addDays, type Dash } from './numbers';

// A healthy period: CTR 1.5%, 3% of clicks become a lead or chat, 10% of ad-linked leads close, 50 SAR a lead
const base: Outcome = {
  spend: 15000, impr: 200000, clicks: 3000, leads: 70, conv: 20, crm: true, crmLinked: true, crmLeads: 60, booked: 6, value: 9000,
  closings: 8, paid: 12000, cpm: 75, cpc: 5, ctr: 1.5, cpl: 50, clickToResult: 3, closeRate: 10, roas: 0.6, mer: 0.8, cac: 1875, closingsAll: 8, bookedAll: 6,
  closeRateAll: 8.9,
};
const as = (o: Partial<Outcome>): Outcome => ({ ...base, ...o });

describe('overview: funnel in English', () => {
  const arabic = /[\u0600-\u06FF]/;
  it('the journey labels and «غير مربوط» in English', () => {
    const j = journey(as({ booked: 0, closings: 45, closingsAll: 45, bookedAll: 0 }), 'en');
    expect(j.stages.map(s => s.n)).toEqual(['Awareness', 'Interest', 'Conversion', 'Sale']);
    const all = j.stages.flatMap(s => [s.n, s.hint, s.main.label, ...s.sub.map(x => x.label + (x.missing ?? '')), s.rate ? s.rate.label + (s.rate.missing ?? '') : '']).join(' ');
    expect(all).not.toMatch(arabic);
    // The lead-to-closing link is CRM-wide (judged); only the ads' own share is «غير مربوط»
    expect(j.stages[3]!.rate!.missing).toBeUndefined();
    expect(j.stages[3]!.sub.find(x => x.label === 'Closings from ads')!.missing).toBe('Not linked');
    expect(journey(as({ crmLinked: false }), 'en').noCrm).not.toMatch(arabic);
  });
  it('the band reads left to right in English: stage 1 on the left', () => {
    expect(stageX(0, 4, 960, false)).toBeLessThan(stageX(3, 4, 960, false));
    const p = points(shape([1000, 100, 10, 1], [1, 1, 1], 190, 28), 960, false);
    expect(p[0]!.h).toBe(190);
    expect(p.every((q, i) => i === 0 || q.x > p[i - 1]!.x)).toBe(true);
  });
});

describe('overview: the journey numbers per platform', () => {
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

  it('the platform filter: only that platform, closings from the ad-linked CRM rows', () => {
    const C = { ...D, crm: { rows: [['a', to, to, true, 500], ['b', to, to, true, 700]], paid_all: [[to, to, 500, 'x'], [to, to, 700, 'y'], [to, to, 900, 'z']] } } as unknown as Dash;
    const all = outcome(C, addDays(to, -6), to), fb = outcome(C, addDays(to, -6), to, 'lead', 'facebook');
    expect(all).toMatchObject({ crm: true, closings: 3, impr: 14000 });
    expect(fb).toMatchObject({ crm: false, crmLinked: true, closings: 1, paid: 500, booked: 1, value: 500, impr: 7000, clicks: 70 });
  });
  it('the sale link is CRM-wide when the CRM has its paid list, even when no closing is tied to an ad', () => {
    const leads = Array.from({ length: 40 }, () => ['a', to, '', false, 0]);
    const C = { ...D, crm: { rows: leads, paid_all: [[to, to, 900, 'manual'], [to, to, 900, 'manual']] } } as unknown as Dash;
    const all = outcome(C, addDays(to, -6), to), fb = outcome(C, addDays(to, -6), to, 'lead', 'facebook');
    expect(all.closeRateAll).toBeCloseTo((100 * 2) / 21);   // 2 closings ÷ 21 results (14 facebook + 7 snap)
    expect(journey(all).stages[3]!.rate!.key).toBe('closeRateAll');
    expect(journey(all).stages[3]!.rate!.missing).toBeUndefined();
    // A platform: the CRM can't split its closings, so the link falls back to the ad-linked rate, «غير مربوط» here
    expect(fb.closeRateAll).toBeNull();
    expect(journey(fb).stages[3]!.rate!.missing).toBe('غير مربوط');
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
