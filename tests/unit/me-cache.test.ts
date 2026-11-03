// The stored copy of the user that draws the sidebar at once (public/assets/me-cache.js): no email, and not drawn
// after 12 hours, so a shared computer does not show the last user's name and menu once their session ran out.
import { describe, expect, it } from 'vitest';
import { MAX_AGE, readMe, slim } from '../../public/assets/me-cache.js';

const v = { email: 'a@x', name: 'A', role: 'member', dashboards: ['ceo'], departments: [], modules: [] };
const at = (t: number) => JSON.stringify({ t, v: slim(v) });

describe('readMe', () => {
  const now = 1_800_000_000_000;
  it('draws a copy under 12 hours old', () => {
    expect(readMe(at(now - 60_000), now)?.v).toEqual(slim(v));
    expect(readMe(at(now - MAX_AGE), now)).not.toBeNull();
  });
  it('ignores a copy older than 12 hours', () => {
    expect(MAX_AGE).toBe(12 * 60 * 60 * 1000);
    expect(readMe(at(now - MAX_AGE - 1), now)).toBeNull();
  });
  it('ignores nothing stored, broken text, and a time in the future', () => {
    expect(readMe(null, now)).toBeNull();
    expect(readMe('{', now)).toBeNull();
    expect(readMe(JSON.stringify({ v }), now)).toBeNull();
    expect(readMe(at(now + 60 * 60 * 1000), now)).toBeNull();
  });
});

describe('slim', () => {
  it('keeps what the sidebar draws and drops the email', () => {
    expect(slim(v)).toEqual({ name: 'A', role: 'member', dashboards: ['ceo'], departments: [], modules: [] });
    expect('email' in slim(v)).toBe(false);
  });
});
