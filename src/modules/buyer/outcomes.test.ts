// Outcome tracking: a change is measured once its 3 and 7 days are over, against the same campaign's days before it; TikTok is
// judged by click rate, never by leads; nothing is measured twice or for a change that did not happen. Made-up names and numbers.
import { describe, expect, it } from 'vitest';
import { measureDue, effectiveDay, type ActionRow } from './outcomes';
import { judgeOutcome, tune } from './learn';
import type { AdRow, MetricRow } from './buyer';

const add = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const TODAY = '2026-11-20';
const ads = (platform: string): AdRow[] => [{ ad_key: 'a1', platform, campaign: 'Camp Alpha', goal: 'lead', live: true }];
const rows = (from: string, to: string, f: (d: string) => Partial<MetricRow>): MetricRow[] => {
  const out: MetricRow[] = []; for (let d = from; d <= to; d = add(d, 1)) out.push({ ad_key: 'a1', day: d, spend: 100, impressions: 5000, clicks: 50, leads: 4, ...f(d) }); return out;
};
const act = (over: Partial<ActionRow> = {}): ActionRow => ({ id: 'x1', platform: 'meta', entity_name: 'camp alpha', rec_rule: 'scale_up', kind: 'budget_up', status: 'applied', applied_at: '2026-11-10T09:00:00Z', decided_at: null, ...over });

describe('measuring outcomes', () => {
  it('measures the 3-day result only once the 3 days are over, and the 7-day one later', () => {
    const m = rows('2026-11-01', '2026-11-19', () => ({}));
    expect(measureDue([act({ applied_at: '2026-11-17T09:00:00Z' })], ads('facebook'), m, TODAY, new Set())).toHaveLength(0);     // D+3 = 20th, not over
    expect(measureDue([act({ applied_at: '2026-11-16T09:00:00Z' })], ads('facebook'), m, TODAY, new Set()).map(x => x.day)).toEqual([3]);
    expect(measureDue([act({ applied_at: '2026-11-12T09:00:00Z' })], ads('facebook'), m, TODAY, new Set()).map(x => x.day)).toEqual([3, 7]);
  });
  it('compares the days after with the same number of days before, and never repeats a saved one', () => {
    const m = rows('2026-11-01', '2026-11-19', d => (d >= '2026-11-11' ? { spend: 120, leads: 5 } : {}));
    const r = measureDue([act()], ads('facebook'), m, TODAY, new Set(['x1:3']));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ day: 7, platform: 'meta', rec_rule: 'scale_up' });
    expect(r[0]!.before.cpl).toBeCloseTo(25, 5);       // 100 ÷ 4
    expect(r[0]!.after.cpl).toBeCloseTo(24, 5);        // 120 ÷ 5
    expect(r[0]!.after.leads).toBe(35);
    expect(r[0]!.result).toBe('worked');               // cost held and leads grew
  });
  it('ignores changes that did not happen, and campaigns it cannot match', () => {
    const m = rows('2026-11-01', '2026-11-19', () => ({}));
    expect(measureDue([act({ status: 'rejected' }), act({ id: 'x2', status: 'failed' }), act({ id: 'x3', entity_name: 'Other' }), act({ id: 'x4', applied_at: null, decided_at: null })], ads('facebook'), m, TODAY, new Set())).toEqual([]);
    expect(measureDue([act({ id: 'x5', status: 'manual_done', applied_at: null, decided_at: '2026-11-12T10:00:00Z' })], ads('facebook'), m, TODAY, new Set()).map(x => x.day)).toEqual([3, 7]);
  });
  it('uses the Saudi day for the moment the change took effect', () => {
    expect(effectiveDay(act({ applied_at: '2026-11-10T22:30:00Z' }))).toBe('2026-11-11');
  });
  it('judges TikTok by click rate, never by leads', () => {
    const m = rows('2026-11-01', '2026-11-19', d => (d >= '2026-11-11' ? { clicks: 80, leads: 0 } : { clicks: 50, leads: 9 }));
    const r = measureDue([act({ platform: 'tiktok', kind: 'refresh_creative', rec_rule: 'low_ctr' })], ads('tiktok'), m, TODAY, new Set());
    expect(r.find(x => x.day === 7)!.result).toBe('worked');      // click rate 1% → 1.6%, though leads went to zero
    expect(judgeOutcome({ rule: 'low_ctr', platform: 'tiktok', kind: 'refresh_creative', days: 7, acted: true, before: { cpl: null, ctr: 1, leads: 0, spend: 100, impr: 100 }, after: { cpl: null, ctr: 2, leads: 0, spend: 100, impr: 100 } })).toBe('unclear');   // too few impressions
  });
  it('feeds the tuning proposals only with enough clear outcomes', () => {
    const o = (worked: boolean) => ({ rule: 'fatigue' as const, platform: 'meta', kind: 'refresh_creative' as const, days: 7, acted: true, before: { cpl: 10, leads: 20, spend: 100 }, after: { cpl: worked ? 8 : 12, leads: 24, spend: 90 } });
    expect(tune(Array.from({ length: 4 }, () => o(false)))[0]!.proposal).toBeNull();
    expect(tune(Array.from({ length: 10 }, (_, i) => o(i < 2)))[0]!.proposal).toContain('fatigueCtrDrop');
  });
});
