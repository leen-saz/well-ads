import { describe, expect, it } from 'vitest';
import { addDays, adDaily, byAd, canCompare, change, daily, family, holes, lastDay, previous, summarize, type Dash } from './numbers';

// Made-up ads: a lead campaign, a WhatsApp campaign, one with no goal, and two platforms that are counted but never listed
const D: Dash = {
  range: { start: '2026-09-25', end: '2026-10-03', today: '2026-10-04' },
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
    ['h1', '2026-10-02', 10, 100, 1, 1, 0],
    ['h2', '2026-10-02', 20, 200, 2, 0, 2],
    ['a', '2026-10-04', 999, 9999, 99, 99, 99], // today, partial
    ['a', '2026-09-28', 10, 100, 1, 1, 0],
  ],
};

describe('overview numbers (same rules as the main dashboard)', () => {
  it('ends on the last full day, not on today', () => {
    expect(lastDay(D)).toBe('2026-10-03');
    expect(lastDay({ rows: [['a', '2026-10-02']] })).toBe('2026-10-02');
    expect(lastDay({})).toBeNull();
  });

  it('counts results as leads + conversations, and keeps hidden platforms in the totals', () => {
    const t = summarize(D, '2026-10-01', '2026-10-03');
    expect(t.spend).toBe(100 + 50 + 60 + 40 + 10 + 20);
    expect(t.results).toBe(13 + 1 + 10 + 2 + 1 + 2);
    expect(t.cpr).toBeCloseTo(280 / 29);
    expect(t.ctr).toBeCloseTo(38 / 2800);
  });

  it('lists ads by spend, without hidden platforms', () => {
    const ads = byAd(D, '2026-10-01', '2026-10-03');
    expect(ads.map(a => a.key)).toEqual(['a', 'b', 'c']);
    expect(ads[0]).toMatchObject({ spend: 150, results: 14, live: true });
    expect(ads[1]).toMatchObject({ results: 10, live: false });
  });

  it('compares only when the earlier period is inside the data', () => {
    expect(previous('2026-10-01', '2026-10-03')).toEqual(['2026-09-28', '2026-09-30']);
    expect(canCompare(D, '2026-10-01', '2026-10-03')).toBe(true);
    expect(canCompare(D, '2026-09-27', '2026-10-03')).toBe(false); // earlier week starts before range.start
    expect(change(150, 100)).toBe(50);
    expect(change(5, 0)).toBeNull();
    expect(change(null, 3)).toBeNull();
  });

  it('does not compare over a platform whose data stopped early', () => {
    const stale: Dash = { ...D, platforms: { snap: { ok: false, stale_from: '2026-10-02' } } };
    expect(holes(stale, '2026-10-03')).toEqual(['snap']);
    expect(canCompare(stale, '2026-10-01', '2026-10-03')).toBe(false);
    expect(holes({ ...D, platforms: { tiktok: {} } }, '2026-10-03')).toEqual([]); // no TikTok ads
    expect(family('instagram')).toBe('meta');
    expect(family('google_pmax')).toBe('google');
  });

  it('fills every day of the range, and gives one ad its own days', () => {
    const days = daily(D, '2026-09-30', '2026-10-03');
    expect(days.map(d => d.day)).toEqual(['2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']);
    expect(days[0]).toEqual({ day: '2026-09-30', spend: 0, results: 0 });
    expect(days[2]).toEqual({ day: '2026-10-02', spend: 140, results: 1 + 10 + 1 + 2 });
    expect(adDaily(D, 'b', '2026-10-01', '2026-10-02').map(d => d.spend)).toEqual([0, 60]);
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  });
});
