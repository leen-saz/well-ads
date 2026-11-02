// /api/overview/data: same reach as the analytics page
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../lib/auth';
import { data } from './routes';

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
  it('refuses without the overview tab', async () => {
    expect((await call(member(['ceo']))).status).toBe(403);
  });
  it('says so when the pipeline has not uploaded numbers yet', async () => {
    expect((await call(member(['overview', 'ceo']), { ...BASE, FILES: { get: async () => null } } as unknown as A.AuthEnv)).status).toBe(404);
  });
});
