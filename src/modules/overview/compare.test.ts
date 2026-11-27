// The last-month comparison window: same calendar days one month back, clamped to the month's last day, and none when the
// earlier window is not fully inside the data.
import { describe, expect, it } from 'vitest';
import { compareWindow, monthBack, monthWindow } from './compare';
import type { Dash } from './numbers';

describe('overview: the same days one month back', () => {
  it('moves a day to the same day of the month before', () => {
    expect(monthBack('2026-11-15')).toBe('2026-10-15');
    expect(monthBack('2026-01-10')).toBe('2025-12-10');   // across the year
  });
  it('clamps to the last day of a shorter month: 31 Dec vs 30 Nov', () => {
    expect(monthBack('2026-12-31')).toBe('2026-11-30');
    expect(monthBack('2026-05-31')).toBe('2026-04-30');
    expect(monthBack('2026-03-31')).toBe('2026-02-28');
  });
  it('knows a leap year', () => {
    expect(monthBack('2028-03-31')).toBe('2028-02-29');
    expect(monthBack('2028-03-30')).toBe('2028-02-29');
    expect(monthBack('2100-03-31')).toBe('2100-02-28');   // 2100 is not a leap year
  });
  it('a whole month compares with the whole month before, even when it is a day shorter', () => {
    expect(monthWindow('2026-12-01', '2026-12-31')).toEqual(['2026-11-01', '2026-11-30']);
    expect(monthWindow('2026-03-01', '2026-03-31')).toEqual(['2026-02-01', '2026-02-28']);
    expect(monthWindow('2026-01-01', '2026-01-31')).toEqual(['2025-12-01', '2025-12-31']);
  });
  it('a partial current month compares with the same elapsed days of the month before', () => {
    expect(monthWindow('2026-11-01', '2026-11-27')).toEqual(['2026-10-01', '2026-10-27']);
    expect(monthWindow('2026-03-01', '2026-03-30')).toEqual(['2026-02-01', '2026-02-28']);   // 28 days is all February has
  });
  it('a period inside the month, and one that crosses a month end', () => {
    expect(monthWindow('2026-11-14', '2026-11-20')).toEqual(['2026-10-14', '2026-10-20']);
    expect(monthWindow('2026-10-25', '2026-11-05')).toEqual(['2026-09-25', '2026-10-05']);
  });
  it('keeps the length when only the start had to be clamped', () => {
    expect(monthWindow('2026-03-29', '2026-03-30')).toEqual(['2026-02-28', '2026-03-01']);   // 2 days vs 2 days, not 1 day
  });
  it('rejects nonsense', () => {
    expect(monthWindow('2026-11-10', '2026-11-01')).toBeNull();
    expect(monthWindow('nope', '2026-11-01')).toBeNull();
  });
});

// Data from 2026-09-01 to 2026-11-27, one ad, spend every day (the platform is covered to the last day)
function dash(over: Partial<Dash> = {}, skip: (day: string) => boolean = () => false): Dash {
  const rows: unknown[][] = [];
  for (let t = Date.parse('2026-09-01'); t <= Date.parse('2026-11-27'); t += 864e5) {
    const day = new Date(t).toISOString().slice(0, 10);
    if (!skip(day)) rows.push(['a', day, 10, 100, 5, 1, 0]);
  }
  return { range: { start: '2026-09-01', end: '2026-11-27', today: '2026-11-28' }, ads: { a: { name: 'x', campaign: 'c', platform: 'instagram', goal: 'lead', dept: 'iv' } }, rows, ...over } as Dash;
}

describe('overview: when there is a last month to compare with', () => {
  it('gives the window when it is inside the data', () => {
    expect(compareWindow(dash(), '2026-11-01', '2026-11-27')).toEqual({ from: '2026-10-01', to: '2026-10-27' });
    expect(compareWindow(dash(), '2026-10-01', '2026-10-31')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });
  it('says nothing when the earlier window starts before the data does', () => {
    expect(compareWindow(dash(), '2026-09-15', '2026-09-30')).toBeNull();   // Aug 15–30 is not in the data
    expect(compareWindow(dash({ range: { end: '2026-11-27' } }), '2026-11-01', '2026-11-27')).toBeNull();   // the data does not say where it starts
  });
  it('says nothing when the earlier window has no spend and no results', () => {
    expect(compareWindow(dash({}, day => day >= '2026-10-01' && day <= '2026-10-31'), '2026-11-01', '2026-11-27')).toBeNull();
  });
  it('says nothing when a platform stops before the end of the period', () => {
    const d = dash({ platforms: { meta: { coverage_end: '2026-11-20' } } });
    expect(compareWindow(d, '2026-11-01', '2026-11-27')).toBeNull();
  });
  it('says nothing for a period the data cannot answer for', () => {
    expect(compareWindow(dash(), '2026-11-10', '2026-11-01')).toBeNull();
  });
});
