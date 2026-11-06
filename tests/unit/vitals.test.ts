// Web Vitals reports: only a clean path and numbers in range are logged
import { describe, expect, it } from 'vitest';
import { cleanVitals, p75, summarize } from '../../src/lib/vitals';

describe('cleanVitals', () => {
  it('keeps the path without its query and rounds the numbers', () => {
    expect(cleanVitals({ path: '/design/?x=1', lcp: 2412.3456, inp: 180, cls: 0.0421, ttfb: 300, mobile: true }))
      .toEqual({ path: '/design/', lcp: 2412.346, inp: 180, cls: 0.042, ttfb: 300, mobile: true });
  });
  it('drops a bad path and out-of-range numbers', () => {
    expect(cleanVitals({ path: 'https://evil.example', lcp: 1 })).toBeNull();
    expect(cleanVitals({ path: '/', lcp: -5, inp: 'x', cls: 999 })).toBeNull();
  });
});

describe('vitals summary', () => {
  it('ids in a path are not pages', () => {
    expect(cleanVitals({ path: '/c/123e4567-e89b-12d3-a456-426614174000', lcp: 1 })?.['path']).toBe('/c/:id');
    expect(cleanVitals({ path: '/journeys/42/', lcp: 1 })?.['path']).toBe('/journeys/:id/');
  });
  it('p75 is the figure 75% of visits are inside', () => {
    expect(p75([1, 2, 3, 4])).toBe(3);
    expect(p75([null, 5])).toBe(5);
    expect(p75([null])).toBeNull();
  });
  it('groups per page, busiest first, counts mobile', () => {
    const row = (path: string, lcp: number | null, mobile = false) => ({ path, lcp, inp: null, cls: 0, ttfb: 100, mobile });
    const s = summarize([row('/a/', 1000), row('/b/', 3000, true), row('/b/', 5000), row('/b/', null, true)]);
    expect(s.map(p => p.path)).toEqual(['/b/', '/a/']);
    expect(s[0]).toMatchObject({ n: 3, mobile: 2, lcp: 5000, inp: null, ttfb: 100 });
  });
});
