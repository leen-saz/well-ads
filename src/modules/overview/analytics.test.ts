import { describe, expect, it } from 'vitest';
import { depts, heat, order, pace, share } from './analytics';
import type { Dash } from './numbers';

// Made-up numbers: a lead ad (Instagram, IV), a WhatsApp ad (Snap, midwife), and a hidden platform counted in totals only
const D = {
  range: { start: '2026-09-01', end: '2026-10-10', today: '2026-10-11' },
  departments: { order: ['iv', 'midwife', 'foot', 'brand'], departments: { iv: { ar: 'محاليل' }, midwife: { ar: 'قبالة' }, foot: { ar: 'قدم' }, brand: { ar: 'علامة' } } },
  ads: {
    a: { name: 'ليدز', campaign: 'x', platform: 'instagram', goal: 'lead', dept: 'iv' },
    b: { name: 'واتساب', campaign: 'y', platform: 'snap', goal: 'messages', dept: 'midwife' },
    h: { name: 'مخفي', campaign: 'z', platform: 'audience_network', goal: 'lead', dept: 'iv' },
  },
  rows: [
    ['a', '2026-10-01', 100, 1000, 10, 4, 0], // Thursday
    ['a', '2026-10-04', 50, 500, 5, 0, 0],    // Sunday, no leads
    ['a', '2026-10-08', 60, 600, 6, 2, 0],    // Thursday
    ['b', '2026-10-02', 80, 800, 8, 0, 5],
    ['h', '2026-10-03', 10, 100, 1, 1, 0],
    ['a', '2026-09-02', 40, 400, 4, 2, 0],    // last month, same days
    ['b', '2026-09-05', 20, 200, 2, 0, 1],
    ['a', '2026-10-11', 999, 9999, 99, 99, 0], // today, partial
  ],
} as unknown as Dash;
const F = '2026-10-01', T = '2026-10-10';

describe('overview: the rest of the analytics page', () => {
  it('platform order: the dashboard order, hidden ones out', () => {
    expect(order(D)).toEqual(['instagram', 'snap']);
  });
  it('share of spend and of results (leads + chats)', () => {
    const s = share(D, F, T);
    expect(s.map(x => x.platform)).toEqual(['instagram', 'snap']);
    expect(s[0]!.spendShare).toBeCloseTo(72.41, 2);
    expect(s[0]!.resultShare).toBeCloseTo(54.55, 2);
    expect(s[1]).toMatchObject({ spend: 80, results: 5 });
  });
  it('cost per lead by weekday: lead ads only, null without leads', () => {
    const h = heat(D, F, T);
    expect(h.rows).toEqual([{ platform: 'instagram', cpl: [null, null, null, null, 160 / 6, null, null] }]);
    expect(h.lo).toBeCloseTo(26.67, 2);
  });
  it('month pace: complete days only, forecast, and the same days last month', () => {
    const p = pace(D, F, T);
    expect(p).toMatchObject({ month: '2026-10', prevMonth: '2026-09', done: 10, days: 31, spend: 300, results: 12, partialToday: false });
    expect(p.forecast).toEqual({ spend: 930, results: 37.2 });
    expect(p.prev).toEqual({ spend: 60, results: 3, full: false });
    expect(p.vs).toEqual({ spend: 400, results: 300 });
  });
  it('no forecast before 3 complete days, and none over a gap', () => {
    expect(pace(D, '2026-10-01', '2026-10-02')).toMatchObject({ done: 2, forecast: null, waitDays: true });
    const gap = { ...D, platforms: { snap: { ok: false, stale_from: '2026-10-05' } } } as Dash;
    expect(pace(gap, F, T)).toMatchObject({ forecast: null, vs: null, waitDays: false });
  });
  it('departments in order, brand left out, cost per lead from lead ads', () => {
    const d = depts(D, F, T);
    expect(d.map(x => x.key)).toEqual(['iv', 'midwife', 'foot']);
    expect(d[0]).toMatchObject({ name: 'محاليل', spend: 220, leads: 7 });
    expect(d[0]!.cpl).toBeCloseTo(220 / 7, 6);
    expect(d[1]).toMatchObject({ spend: 80, leads: 0, cpl: null });
    expect(d[2]).toMatchObject({ spend: 0, cpl: null });
  });
});
