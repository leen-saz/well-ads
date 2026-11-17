// What the two public-by-design diagnostics may show: /api/health only { ok, version }; the details and the listening probe need the owner
// (the probe also opens with the x-probe-secret header, and then never says which API keys are set).
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { WELL_COMPANY } from '../../src/lib/tenant';
import { api } from '../../src/api/index';
import { clearHealthCache } from '../../src/lib/health';

const SECRET = 'probe-secret-0123456789abcdef';
const E = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'owner@example.com', APP_ENV: 'staging', BUILD_VERSION: 'v1', YOUTUBE_API_KEY: 'yt', PROBE_SECRET: SECRET } as A.AuthEnv & Record<string, string>;
const cfg = A.env(E);
const owner: A.Profile = { id: '33333333-3333-3333-3333-333333333333', email: 'owner@example.com', role: 'owner', active: true, access: {}, company_id: WELL_COMPANY };
const member: A.Profile = { ...owner, email: 'member@example.com', role: 'member' };

async function get(path: string, p: A.Profile | null, headers: Record<string, string> = {}) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(String(url).includes('/profiles?id=eq.') ? JSON.stringify(p ? [p] : []) : '[]')));
  const cookie = p ? `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(p, cfg), cfg.secret))}` : '';
  return api.request('https://well.example' + path, { headers: { ...(cookie ? { cookie } : {}), ...headers } }, E);
}
afterEach(() => { vi.unstubAllGlobals(); clearHealthCache(); });

describe('/api/health', () => {
  it('anonymous gets only ok and version', async () => {
    const r = await get('/api/health', null);
    expect(r.status).toBe(200);
    expect(Object.keys(await r.json()).sort()).toEqual(['ok', 'version']);
  });
  it('details: anonymous 401, a member 403, the owner gets the full report', async () => {
    expect((await get('/api/health/details', null)).status).toBe(401);
    expect((await get('/api/health/details', member)).status).toBe(403);
    const r = await get('/api/health/details', owner);
    expect(r.status).toBe(200);
    const h = await r.json() as Record<string, unknown>;
    expect(h).toMatchObject({ version: 'v1', env: 'staging' });
    expect(h).toHaveProperty('checks');
    expect(h).toHaveProperty('migrations');
    expect(h).toHaveProperty('data');
  });
});

describe('/api/listening/probe', () => {
  it('no credentials, a wrong secret or a member: refused', async () => {
    expect((await get('/api/listening/probe', null)).status).toBe(401);
    expect((await get('/api/listening/probe', null, { 'x-probe-secret': 'wrong' })).status).toBe(401);
    expect((await get('/api/listening/probe', member)).status).toBe(403);
  });
  it('an unset PROBE_SECRET never matches an empty header', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]')));
    const r = await api.request('https://well.example/api/listening/probe', { headers: { 'x-probe-secret': '' } }, { ...E, PROBE_SECRET: '' });
    expect(r.status).toBe(401);
  });
});
