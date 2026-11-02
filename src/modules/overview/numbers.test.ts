import { describe, expect, it } from 'vitest';
import { addDays, adDaily, byAd, change, daily, lastDay, previous, result, summarize, type Dash } from './numbers';

// Made-up ads: a lead campaign, a WhatsApp campaign, one with no goal, and two platforms that must stay hidden
const D: Dash = {
  ads: {
    a: { name: 'إعلان ليدز', campaign: 'حملة 1', platform: 'instagram', goal: 'lead', live: true },
    b: { name: 'إعلان واتساب', campaign: 'حملة 2', platform: 'snap', goal: 'messages' },
    c: { name: 'بدون هدف', campaign: 'حملة 3', platform: 'google_search' },
    h1: { name: 'مخفي', campaign: 'x', platform: 'audience_network', goal: 'lead' },
    h2: { name: 'مخفي', campaign: 'x', platform: 'meta_whatsapp', goal: 'messages' },
  },
  rows: [
    ['a', '2026-10-01', 100, 1000, 20, 4, 9],
    ['a', '2026-10-02', 50, 500, 5, 1, 0],
    ['b', '2026-10-02', 60, 600, 6, 7, 3],
    ['c', '2026-10-03', 40, 400, 4, 1, 1],
    ['h1', '2026-10-02', 999, 9999, 99, 99, 99],
    ['h2', '2026-10-02', 999, 9999, 99, 99, 99],
    ['a', '2026-09-28', 10, 100, 1, 1, 0],
  ],
};

describe('overview numbers', () => {
  it('counts the result by goal: leads, conversations, or both', () => {
    expect(result('lead', 4, 9)).toBe(4);
    expect(result('messages', 7, 3)).toBe(3);
    expect(result(undefined, 1, 1)).toBe(2);
  });

  it('sums the period and never counts Audience Network or meta_whatsapp', () => {
    const t = summarize(D, '2026-10-01', '2026-10-03');
    expect(t.spend).toBe(250);
    expect(t.results).toBe(4 + 1 + 3 + 2);
    expect(t.cpr).toBeCloseTo(25);
    expect(t.ctr).toBeCloseTo(35 / 2500);
  });

  it('compares with the same number of days just before', () => {
    expect(previous('2026-10-01', '2026-10-03')).toEqual(['2026-09-28', '2026-09-30']);
    expect(change(150, 100)).toBe(50);
    expect(change(5, 0)).toBeNull();
    expect(change(null, 3)).toBeNull();
  });

  it('fills every day of the range, even days with no spend', () => {
    const days = daily(D, '2026-09-30', '2026-10-03');
    expect(days.map(d => d.day)).toEqual(['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']);
    expect(days[0]).toEqual({ day: '2026-09-30', spend: 0, results: 0 });
    expect(days[2]).toEqual({ day: '2026-10-02', spend: 110, results: 1 + 3 });
  });

  it('lists ads by spend, with live status and cost per result', () => {
    const ads = byAd(D, '2026-10-01', '2026-10-03');
    expect(ads.map(a => a.key)).toEqual(['a', 'b', 'c']);
    expect(ads[0]).toMatchObject({ spend: 150, results: 5, cpr: 30, live: true });
    expect(ads[1]).toMatchObject({ results: 3, live: false });
  });

  it('gives one ad its own days, and finds the latest day', () => {
    expect(adDaily(D, 'b', '2026-10-01', '2026-10-02').map(d => d.spend)).toEqual([0, 60]);
    expect(lastDay(D)).toBe('2026-10-03');
    expect(lastDay({})).toBeNull();
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  });
});
