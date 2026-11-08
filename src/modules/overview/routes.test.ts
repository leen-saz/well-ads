// /api/overview/data: same reach as the analytics page
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../lib/auth';
import { data, span } from './routes';

const BASE: A.AuthEnv = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'leen@example.com' };
const cfg = A.env(BASE);
const files = { get: async (k: string) => (k === 'site/dash.json' ? { body: '{"rows":[]}' } : null) };
const E = { ...BASE, FILES: files } as unknown as A.AuthEnv;
const member = (dashboards: string[], departments: string[] = []): A.Profile =>
  ({ id: '22222222-2222-2222-2222-222222222222', email: 'm@example.com', active: true, dashboards, departments } as unknown as A.Profile);
const call = async (p: A.Profile, env: A.AuthEnv = E) => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/profiles?id=eq.') ? [p] : []))));
  const cookie = `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(p, cfg), cfg.secret))}`;
  return data.GET(new Request('https://well.example/api/overview/data', { headers: { cookie } }), env);
};

afterEach(() => { vi.unstubAllGlobals(); });

describe('overview data', () => {
  it('returns the dashboard numbers to someone with overview and analytics', async () => {
    const r = await call(member(['overview', 'ceo']));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ rows: [] });
  });
  it('refuses without analytics, and refuses a department manager', async () => {
    expect((await call(member(['overview']))).status).toBe(403);
    expect((await call(member(['overview', 'ceo'], ['iv']))).status).toBe(403);
  });
  it('gives other companies nothing: dash.json is Well\'s own numbers', async () => {
    const other = { ...member(['overview', 'ceo']), company_id: '33333333-3333-4333-8333-333333333333' } as unknown as A.Profile;
    expect((await call(other)).status).toBe(404);
  });
  it('refuses without the overview tab', async () => {
    expect((await call(member(['ceo']))).status).toBe(403);
  });
  it('says so when the pipeline has not uploaded numbers yet', async () => {
    expect((await call(member(['overview', 'ceo']), { ...BASE, FILES: { get: async () => null } } as unknown as A.AuthEnv)).status).toBe(404);
  });
});

// /api/overview/span: the owner sees how much history there is (counts and dates only); nobody else does
describe('overview data span (owner only)', () => {
  // Synthetic: two channels, a few days of spend (one day with 0 spend), and three paid closings over two days
  const dash = {
    ads: { a: { platform: 'facebook' }, b: { platform: 'google_search' } },
    rows_cols: { k: ['a', 'b'], d: ['2026-01-01', '2026-01-02', '2026-01-03'], c: [[0, 0, 1, 1], [0, 1, 1, 2], [10, 0, 5, 7], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] },
    crm: { paid_all: [['2025-12-20', '2026-01-02', 900, 'x'], ['2025-12-21', '2026-01-02', 400, 'y'], ['2025-12-22', '2026-01-03', 700, 'z']] },
  };
  const F = { ...BASE, FILES: { get: async (k: string) => (k === 'site/dash.json' ? { body: JSON.stringify(dash) } : null) } } as unknown as A.AuthEnv;
  const ask = async (p: A.Profile) => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('/profiles?id=eq.') ? [p] : []))));
    const cookie = `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(p, cfg), cfg.secret))}`;
    return span.GET(new Request('https://well.example/api/overview/span', { headers: { cookie } }), F);
  };
  const owner = { ...member(['overview', 'ceo']), email: 'leen@example.com' } as unknown as A.Profile;
  it('gives the owner the first and last day of spend, per channel, and the CRM closing days and count', async () => {
    const r = await ask(owner);
    expect(r.status).toBe(200);
    const body = await r.json() as Record<string, unknown>;
    expect(body).toEqual({
      spend: { first: '2026-01-01', last: '2026-01-03', days: 3 },
      channels: [{ channel: 'google', first: '2026-01-02', last: '2026-01-03', days: 2, mmmReady: false }, { channel: 'meta', first: '2026-01-01', last: '2026-01-01', days: 1, mmmReady: false }],
      crm: { first: '2026-01-02', last: '2026-01-03', days: 2, closings: 3 },
      mmm: { needDays: 730, ready: false },
    });
    // Counts and dates only: no amount from the CRM or the spend comes out
    expect(JSON.stringify(body)).not.toMatch(/900|400|700|"spend":\s*\d/);
  });
  it('refuses everyone else, analytics access included', async () => {
    expect((await ask(member(['overview', 'ceo']))).status).toBe(403);
  });
});
