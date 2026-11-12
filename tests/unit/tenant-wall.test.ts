// What is Well's alone stays Well's: the pipeline pages and data in R2, the decisions board and the connectors (their
// tables and Vault names have no company column yet). Another company's users are refused whatever dashboards they hold.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { gate } from '../../src/lib/gate';
import { WELL_COMPANY } from '../../src/lib/tenant';
import { api } from '../../src/api/index';
import * as control from '../../src/api/routes/control';
import * as connectors from '../../src/api/routes/connectors';

const E: A.AuthEnv = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'owner@example.com' };
const cfg = A.env(E);
const OTHER = '22222222-2222-2222-2222-222222222222';
const ALL = Object.fromEntries(Object.keys(A.DASHBOARDS).map(k => [k, 'approve']));
const profile = (co: string, extra: Partial<A.Profile> = {}): A.Profile => ({ id: '33333333-3333-3333-3333-333333333333', email: 'member@example.com', role: 'member', active: true, access: ALL, company_id: co, ...extra });
const cookieOf = async (p: A.Profile) => `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(p, cfg), cfg.secret))}`;
afterEach(() => { vi.unstubAllGlobals(); });

describe('gate: Well pages and data', () => {
  const PATHS = ['/', '/?view=creative', '/c/', '/dept/iv/', '/dash.json', '/control/ads.json', '/thumbs/aaaaaaaaaaaaaaaaaaaa.jpg', '/control/', '/connectors/', '/creative/', '/api/control/suggestions', '/api/connectors/list'];
  it("refuses another company's users on every one of them", async () => {
    const cookie = await cookieOf(profile(OTHER));
    for (const p of PATHS) {
      const d = await gate(new Request('https://x.test' + p, { headers: { cookie } }), E);
      // a page goes to the «not available for your company» screen; data files and the API keep a plain 403
      const page = !/\.[a-z0-9]+$/i.test(p) && !p.startsWith('/api/');
      expect(d instanceof Response ? d.status : 'pass', p).toBe(page ? 302 : 403);
      if (page) expect((d as Response).headers.get('location'), p).toContain('/soon/?t=');
    }
  });
  it('a department manager of another company gets no Well department page by a rewrite', async () => {
    const cookie = await cookieOf(profile(OTHER, { departments: ['iv'] }));
    const d = await gate(new Request('https://x.test/anything', { headers: { cookie } }), E);
    expect(d instanceof Response ? d.status : 'pass').toBe(302);   // to the same screen; no department page is rewritten
  });
  it("still opens them for Well's users, and the other company keeps its own tabs", async () => {
    const well = await cookieOf(profile(WELL_COMPANY));
    for (const p of ['/', '/dash.json', '/control/', '/api/control/suggestions']) expect(await gate(new Request('https://x.test' + p, { headers: { cookie: well } }), E), p).toEqual({ pass: true });
    const other = await cookieOf(profile(OTHER));
    for (const p of ['/design/', '/api/design/options', '/today/', '/api/dash/data', '/api/today/state']) expect(await gate(new Request('https://x.test' + p, { headers: { cookie: other } }), E), p).toEqual({ pass: true });
  });
  it("the sidebar hubs never send another company's user to a Well page", async () => {
    const d = await gate(new Request('https://x.test/performance', { headers: { cookie: await cookieOf(profile(OTHER)) } }), E);
    expect((d as Response).headers.get('location')).toBe('https://x.test/listening/');
  });
});

describe("handlers refuse another company's users themselves (the gate is not the only wall)", () => {
  async function call(path: string, method: string, co: string) {
    const calls: string[] = [];
    const p = profile(co);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { calls.push(String(url)); return new Response(JSON.stringify(String(url).includes('/profiles?id=eq.') ? [p] : [])); }));
    const res = await api.request('https://x.test' + path, { method, headers: { cookie: await cookieOf(p), origin: 'https://x.test', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, ...(method === 'GET' ? {} : { body: '{}' }) }, E);
    return { status: res.status, writes: calls.filter(u => !u.includes('/profiles?id=eq.')) };
  }
  const routes = [...Object.entries(control), ...Object.entries(connectors)].flatMap(([name, h]) => Object.keys(h as object).map(m => [name, m] as const));
  it('has routes to walk', () => { expect(routes.length).toBeGreaterThan(12); });
  for (const [name, m] of [...Object.entries(control).flatMap(([n, h]) => Object.keys(h).map(x => ['control/' + n, x] as const)), ...Object.entries(connectors).flatMap(([n, h]) => Object.keys(h).map(x => ['connectors/' + n, x] as const))].filter(([n]) => n !== 'connectors/callback')) {
    it(`${m} /api/${name}: 403 and not one query`, async () => {
      const r = await call('/api/' + name, m, OTHER);
      expect(r.status).toBe(403);
      expect(r.writes).toEqual([]);
    });
  }
  it('Well still reads the board', async () => {
    expect((await call('/api/control/suggestions', 'GET', WELL_COMPANY)).status).toBe(200);
    expect((await call('/api/connectors/list', 'GET', WELL_COMPANY)).status).toBe(200);
  });
  it('the start page shows no decisions or setup of Well to another company', async () => {
    const r = await call('/api/today/state', 'GET', OTHER);
    expect(r.status).toBe(200);
    expect(r.writes.filter(u => u.includes('/suggestions') || u.includes('/connections'))).toEqual([]);
  });
  it("the connector callback does not store keys for another company's user", async () => {
    const env = { ...E, META_APP_ID: 'app', META_APP_SECRET: 'sec' };
    async function callback(co: string) {
      const p = profile(co);
      const state = await A.sign({ uid: p.id, p: 'meta', n: 'n1', exp: Date.now() + 60_000 }, cfg.secret, 'oauth');
      const calls: string[] = [];
      vi.stubGlobal('fetch', vi.fn(async (url: string) => { calls.push(String(url)); return new Response(JSON.stringify(String(url).includes('/profiles?id=eq.') ? [p] : { error: 'x' }), { status: String(url).includes('/profiles?id=eq.') ? 200 : 400 }); }));
      const res = await api.request(`https://x.test/api/connectors/callback?state=${encodeURIComponent(state)}&code=c`, { headers: { cookie: '__Secure-well_oauth=n1' } }, env);
      return { body: await res.text(), calls };
    }
    const other = await callback(OTHER);
    expect(other.body).toContain('err=access');
    expect(other.calls.filter(u => !u.includes('/profiles?id=eq.'))).toEqual([]);
    // the same request from Well gets past the company check (the platform's answer is stubbed to fail: err=exchange)
    expect((await callback(WELL_COMPANY)).body).toContain('err=exchange');
  });
});
