// Web Vitals reports: only a clean path and numbers in range are logged
import { describe, expect, it } from 'vitest';
import { cleanVitals } from '../../src/lib/vitals';

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
