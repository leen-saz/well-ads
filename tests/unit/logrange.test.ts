import { describe, expect, it } from 'vitest';
import { logRange } from '../../src/lib/logrange';

describe('activity log date range', () => {
  it('whole Riyadh days, both ends included', () => {
    expect(logRange('2026-11-01', '2026-11-02')).toBe('&at=gte.2026-10-31T21:00:00.000Z&at=lt.2026-11-02T21:00:00.000Z');
    expect(logRange('2026-11-01', null)).toBe('&at=gte.2026-10-31T21:00:00.000Z');
    expect(logRange(null, '2026-11-01')).toBe('&at=lt.2026-11-01T21:00:00.000Z');
  });
  it('ignores anything that is not a date (no filter injection)', () => {
    expect(logRange('2026-11-01&email=eq.x', 'yesterday')).toBe('');
    expect(logRange('2026-13-45', '')).toBe('');
    expect(logRange(null, null)).toBe('');
  });
});
