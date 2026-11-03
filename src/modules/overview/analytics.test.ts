import { describe, expect, it } from 'vitest';
import { buckets, depts, granOf, heat, ideaKey, order, outcome, pace, share, wins } from './analytics';
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

  it('outcome: CRM closings by lead day or payment day, return on spend, cost per customer', () => {
    const C = { ...D, crm: {
      rows: [['a', '2026-10-01', '2026-10-12', true, 500], ['a', '2026-10-02', '', false, 0], ['b', '2026-09-28', '2026-10-03', true, 300], ['gone', '2026-10-01', '2026-10-01', true, 999]],
      paid_all: [['2026-10-01', '2026-10-12', 500, 'ad'], ['2026-09-28', '2026-10-03', 300, 'ad'], ['2026-10-05', '2026-10-06', 200, 'walk-in']],
    } } as unknown as Dash;
    const o = outcome(C, F, T, 'lead');
    expect(o).toMatchObject({ spend: 300, impr: 3000, clicks: 30, leads: 7, conv: 5, crm: true, crmLeads: 2, booked: 1, value: 500, closings: 2, paid: 700 });
    expect(o.closeRate).toBe(50);
    expect(o.mer).toBeCloseTo(700 / 300, 6);
    expect(o.cac).toBe(150);
    expect(o.cpl).toBeCloseTo(220 / 7, 6);           // lead ads only: a and the hidden lead ad
    const p = outcome(C, F, T, 'paid');
    expect(p).toMatchObject({ booked: 1, value: 300, closings: 2, paid: 500 });   // paid on 10-03 and 10-06; 10-12 is after the period
    expect(outcome(D, F, T)).toMatchObject({ crm: false, closings: 0, cac: null });
  });

  it('wins: up and down against the period before, cheapest idea, record day and launches', () => {
    const W = { ...D, ads: { ...D.ads, n: { name: 'clip.mp4_فكرة جديدة - Spark', campaign: 'جديدة', platform: 'instagram', goal: 'lead', dept: 'iv' } },
      rows: [...(D.rows ?? []), ['n', '2026-10-09', 30, 300, 3, 12, 0], ['a', '2026-09-25', 10, 100, 1, 2, 0], ['b', '2026-09-26', 10, 100, 1, 0, 1]] } as unknown as Dash;
    const t = wins(W, F, T, true).map(w => w.title);
    expect(t).toContain('الليدز زادت 850%');            // 19 leads vs 2 in Sep 21–30
    expect(t).toContain('أرخص فكرة في الفترة');
    expect(t).toContain('أعلى يوم ليدز من بداية البيانات');
    expect(t).toContain('أطلقنا حملتين وإعلانين جداد');  // the new ad, and the hidden-platform ad first spent on 10-03 (counted like the main dashboard)
    expect(wins(W, F, T, false).some(w => w.title.startsWith('الليدز'))).toBe(false);   // no comparison without a full earlier period
    expect(ideaKey('clip.mp4_فكرة جديدة - Spark')).toBe('فكرة جديدة');
  });

  it('trend: day, week from Sunday, or month; auto by the length of the period; cost per lead per platform', () => {
    expect([granOf('2026-01-01', '2026-02-15', 'auto'), granOf('2026-01-01', '2026-05-01', 'auto'), granOf('2026-01-01', '2026-12-01', 'auto'), granOf(F, T, 'month')]).toEqual(['day', 'week', 'month', 'month']);
    const day = buckets(D, F, T, 'day');
    expect(day).toHaveLength(10);
    expect(day[0]).toEqual({ day: '2026-10-01', spend: 100, results: 4, leads: 4, impr: 1000, clicks: 10, cpl: { instagram: 25 }, plat: { instagram: { spend: 100, results: 4, leads: 4 } } });
    const week = buckets(D, F, T, 'week');
    expect(week.map(b => b.day)).toEqual(['2026-09-27', '2026-10-04']);   // weeks start on Sunday
    expect(week[0]).toMatchObject({ spend: 190, results: 10, leads: 5 });   // Oct 1–3: a 100, b 80, hidden h 10
    expect(week[1]!.cpl).toEqual({ instagram: 55 });                      // 110 over 2 leads; the hidden platform has no line
    expect(buckets(D, F, T, 'month')).toHaveLength(1);
  });

  it('trend buckets: each platform\'s part of a bar, the hidden one only in the total', () => {
    const [w] = buckets(D, F, T, 'week');
    expect(w!.plat).toEqual({ instagram: { spend: 100, results: 4, leads: 4 }, snap: { spend: 80, results: 5, leads: 0 } });
    expect(w!.spend).toBe(190);
  });
});
