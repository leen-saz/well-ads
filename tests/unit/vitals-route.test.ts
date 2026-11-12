// /api/vitals/report stores a row; /api/maestro/vitals shows the owner the last 24 hours per page. Synthetic data, fetch stubbed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { api } from '../../src/api/index';

const E = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'service', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'owner@example.test' };
const cfg = A.env(E);
const owner: A.Profile = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.test', role: 'owner', active: true };
const member: A.Profile = { id: '22222222-2222-4222-8222-222222222222', email: 'm@example.test', role: 'member', dashboards: ['creative'], active: true };
const cookie = async (p: A.Profile) => `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(p, cfg), cfg.secret))}`;
const call = async (path: string, who: A.Profile, init: RequestInit = {}) =>
  api.request('https://well.example' + path, { ...init, headers: { cookie: await cookie(who), origin: 'https://well.example', 'content-type': 'application/json' } }, E);

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function world(who: A.Profile, vitals: unknown, status = 200) {
  const seen: { url: string; method: string; body?: string }[] = [];
  vi.stubGlobal('fetch', async (u: string, init?: RequestInit) => {
    const url = String(u);
    seen.push({ url, method: init?.method ?? 'GET', ...(typeof init?.body === 'string' ? { body: init.body } : {}) });
    if (url.includes('/profiles')) return new Response(JSON.stringify([who]), { status: 200 });
    if (url.includes('/web_vitals') && (init?.method ?? 'GET') === 'GET') return new Response(JSON.stringify(vitals), { status });
    return new Response('[]', { status: 200 });
  });
  return seen;
}

describe('vitals card', () => {
  it('a report is stored as a row of path and numbers only', async () => {
    const seen = world(member, []);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const r = await call('/api/vitals/report', member, { method: 'POST', body: JSON.stringify({ path: '/knowledge/?q=secret', lcp: 2100, inp: 90, cls: 0.02, ttfb: 300, mobile: true }) });
    expect(r.status).toBe(200);
    const post = seen.find(s => s.url.includes('/web_vitals') && s.method === 'POST');
    expect(JSON.parse(post!.body!)).toEqual({ path: '/knowledge/', lcp: 2100, inp: 90, cls: 0.02, ttfb: 300, mobile: true });
  });
  it('a store that is down does not fail the report', async () => {
    vi.stubGlobal('fetch', async (u: string) => { if (String(u).includes('/profiles')) return new Response(JSON.stringify([member]), { status: 200 }); throw new Error('down'); });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect((await call('/api/vitals/report', member, { method: 'POST', body: JSON.stringify({ path: '/x/', lcp: 1 }) })).status).toBe(200);
  });
  it('the owner gets the last 24 hours per page', async () => {
    const seen = world(owner, [
      { path: '/a/', lcp: 1000, inp: 50, cls: 0, ttfb: 200, mobile: false },
      { path: '/a/', lcp: 3000, inp: 80, cls: 0.05, ttfb: 250, mobile: true },
      { path: '/b/', lcp: 900, inp: null, cls: 0, ttfb: 100, mobile: false },
    ]);
    const r = await call('/api/maestro/vitals', owner);
    expect(r.status).toBe(200);
    const j = await r.json() as { pages: { path: string; n: number; lcp: number }[]; reports: number };
    expect(j.reports).toBe(3);
    expect(j.pages[0]).toMatchObject({ path: '/a/', n: 2, lcp: 3000 });
    expect(seen.find(s => s.url.includes('/web_vitals') && s.method === 'GET')!.url).toMatch(/at=gte\./);
    expect(JSON.stringify(j)).not.toMatch(/email|uid|user/i);
  });
  it('only the owner', async () => {
    world(member, []);
    expect((await call('/api/maestro/vitals', member)).status).toBe(403);
  });
  it('a table that is not created yet says which migration to run', async () => {
    world(owner, { code: '42P01', message: 'missing' }, 404);
    const j = await (await call('/api/maestro/vitals', owner)).json() as { missing?: string };
    expect(j.missing).not.toMatch(/022_web_vitals|Supabase|SQL/); expect(j.missing).toContain('صحة الداتا');
  });
});
