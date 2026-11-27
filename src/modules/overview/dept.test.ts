// The department filter: one department's ads and rows everywhere, the choice from the address, and a manager's scope.
import { describe, expect, it } from 'vitest';
import { deptOptions, filterDept, resolveDept } from './dept';
import { outcome } from './analytics';
import { byAd, daily, summarize } from './numbers';
import type { Dash } from './numbers';

const D = {
  range: { start: '2026-10-01', end: '2026-10-10', today: '2026-10-11' },
  departments: { order: ['iv', 'midwife', 'foot', 'brand'], departments: { iv: { ar: 'محاليل' }, midwife: { ar: 'قبالة' }, foot: { ar: 'قدم' }, brand: { ar: 'علامة' } } },
  ads: {
    a: { name: 'ليدز', campaign: 'x', platform: 'instagram', goal: 'lead', dept: 'iv' },
    b: { name: 'واتساب', campaign: 'y', platform: 'snap', goal: 'messages', dept: 'midwife' },
    c: { name: 'وعي', campaign: 'z', platform: 'tiktok', goal: 'lead' },
  },
  rows: [
    ['a', '2026-10-01', 100, 1000, 10, 4, 0],
    ['b', '2026-10-02', 80, 800, 8, 0, 5],
    ['c', '2026-10-03', 20, 200, 2, 1, 0],
  ],
  crm: { rows: [['a', '2026-10-01', '2026-10-05', true, 500], ['b', '2026-10-02', '2026-10-06', true, 300]], paid_all: [['2026-10-01', '2026-10-05', 500, 'x'], ['2026-10-02', '2026-10-06', 300, 'y'], ['2026-10-03', '2026-10-07', 99, 'z']] },
} as unknown as Dash;

describe('overview: department filter', () => {
  it('lists the departments that have ads, in the dashboard order; an ad with no department is brand', () => {
    expect(deptOptions(D).map(o => o.key)).toEqual(['iv', 'midwife', 'brand']);
    expect(deptOptions(D)[0]!.name).toBe('محاليل');
  });
  it('all leaves the data as it is', () => {
    expect(filterDept(D, 'all')).toBe(D);
  });
  it('one department keeps only its ads and rows, and the numbers follow', () => {
    const iv = filterDept(D, 'iv');
    expect(Object.keys(iv.ads!)).toEqual(['a']);
    expect(summarize(iv, '2026-10-01', '2026-10-10')).toMatchObject({ spend: 100, results: 4 });
    expect(byAd(iv, '2026-10-01', '2026-10-10').map(r => r.key)).toEqual(['a']);
    expect(daily(iv, '2026-10-01', '2026-10-03').map(x => x.spend)).toEqual([100, 0, 0]);
    expect(Object.keys(filterDept(D, 'brand').ads!)).toEqual(['c']);   // no dept = brand
  });
  it('the parts add up to the whole', () => {
    const sum = deptOptions(D).reduce((s, o) => s + summarize(filterDept(D, o.key), '2026-10-01', '2026-10-10').spend, 0);
    expect(sum).toBe(summarize(D, '2026-10-01', '2026-10-10').spend);
  });
  it('closings are the ones tied to the department’s ads (the CRM paid list has no ad)', () => {
    const o = outcome(filterDept(D, 'iv'), '2026-10-01', '2026-10-10');
    expect(o).toMatchObject({ closings: 1, paid: 500, crm: false, closingsAll: 0 });
    expect(o.mer).toBe(5);
    expect(outcome(D, '2026-10-01', '2026-10-10')).toMatchObject({ closings: 3, paid: 899, crm: true });
  });
  it('the address: a known department, else all', () => {
    expect(resolveDept(D, 'midwife')).toBe('midwife');
    expect(resolveDept(D, 'nope')).toBe('all');
    expect(resolveDept(D, null)).toBe('all');
    expect(resolveDept(D, 'foot')).toBe('all');   // no ads in it
  });
  it('a manager sees only their departments, and no all', () => {
    expect(deptOptions(D, ['iv']).map(o => o.key)).toEqual(['iv']);
    expect(resolveDept(D, 'midwife', ['iv'])).toBe('iv');   // a link to someone else’s department falls back to theirs
    expect(resolveDept(D, null, ['iv', 'midwife'])).toBe('iv');
    expect(resolveDept(D, 'midwife', ['iv', 'midwife'])).toBe('midwife');
  });
});
