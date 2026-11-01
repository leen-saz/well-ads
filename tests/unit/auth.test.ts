// Port of well-ads-dashboard tests/test_auth.mjs: same cases. No network: Supabase is stubbed.
// The old middleware signalled pass/rewrite with x-middleware-* headers; the gate returns { pass, rewrite } instead.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { gate, need, type Decision } from '../../src/lib/gate';
import * as authRoutes from '../../src/api/routes/auth';
import { api } from '../../src/api/index';

const E: A.AuthEnv = {
  SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'service',
  SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'leen@example.com',
};
const cfg = A.env(E);
const member: A.Profile = { id: '11111111-1111-1111-1111-111111111111', email: 'p@example.com', role: 'member', dashboards: ['creative'], active: true };
const cookieFor = async (p: A.Profile, now?: number) => `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(p, cfg, now), cfg.secret))}`;
const req = (path: string, cookie?: string | null, init: RequestInit & { headers?: Record<string, string> } = {}) =>
  new Request('https://well.example' + path, { ...init, headers: { ...(cookie ? { cookie } : {}), ...(init.headers || {}) } });
const M = (r: Request) => gate(r, E);
const status = (d: Decision) => (d instanceof Response ? d.status : 200);
const location = (d: Decision) => (d instanceof Response ? d.headers.get('location') || '' : '');
const passed = (d: Decision) => !(d instanceof Response) && !d.rewrite;
const rewrite = (d: Decision) => (d instanceof Response ? null : d.rewrite ?? null);

afterEach(() => { vi.unstubAllGlobals(); });

describe('auth', () => {
  it('signature: tampered or expired cookies are rejected', async () => {
    const t = await A.sign(A.sessionFor(member, cfg), cfg.secret);
    expect(await A.verify(t, cfg.secret)).toBeTruthy();
    expect(await A.verify(t.slice(0, -2) + 'aa', cfg.secret)).toBeNull();
    expect(await A.verify(t, 'y'.repeat(40))).toBeNull();
    const old = await A.sign(A.sessionFor(member, cfg, Date.now() - 13 * 3600e3), cfg.secret);
    expect(await A.verify(old, cfg.secret)).toBeNull();
  });

  it('owner gets every dashboard, members only what Leen picked', () => {
    const owner = A.sessionFor({ id: member.id, email: 'LEEN@example.com', dashboards: [] }, cfg);
    expect([...owner.dash].sort()).toEqual(['ceo', 'connectors', 'content', 'control', 'creative', 'journeys', 'maestro', 'social']);
    const s = A.sessionFor({ ...member, dashboards: ['creative', 'bogus'] }, cfg);
    expect(s.dash).toEqual(['creative']);
    expect(A.can(s, 'creative', cfg)).toBe(true);
    expect(A.can(s, 'ceo', cfg)).toBe(false);
    expect(A.can(s, 'owner', cfg)).toBe(false);
  });

  it('SUPABASE_URL works with or without the /rest/v1 suffix', () => {
    for (const u of ['https://sb.example', 'https://sb.example/', 'https://sb.example/rest/v1', 'https://sb.example/rest/v1/']) {
      expect(A.env({ ...E, SUPABASE_URL: u }).url).toBe('https://sb.example');
    }
  });

  it('keyKind names the key type without revealing it', () => {
    const jwt = (role: string) => 'x.' + btoa(JSON.stringify({ role })).replace(/=+$/, '') + '.y';
    expect(A.keyKind(jwt('service_role'))).toBe('jwt:service_role');
    expect(A.keyKind(jwt('anon'))).toBe('jwt:anon');
    expect(A.keyKind('sb_secret_abc')).toBe('sb_secret');
    expect(A.keyKind('sb_publishable_abc')).toBe('sb_publishable');
  });

  it('route map', () => {
    expect(need('/login/', '')).toBeNull();
    expect(need('/api/auth/login', '')).toBeNull();
    expect(need('/assets/app.css', '')).toBeNull();
    expect(need('/', '')).toBe('ceo');
    expect(need('/', '?view=creative')).toBe('creative');
    expect(need('/creative', '')).toBe('creative');
    expect(need('/organic/', '')).toBe('ceo');
    expect(need('/control/', '')).toBe('control');
    expect(need('/api/control/suggestions', '')).toBe('control');
    expect(need('/admin/', '')).toBe('owner');
    expect(need('/api/admin/users', '')).toBe('owner');
    expect(need('/account/', '')).toBe('any');
    expect(need('/social/', '')).toBe('social');
    expect(need('/api/social/posts', '')).toBe('social');
    expect(need('/soon/', '?t=seo')).toBe('any');
  });

  it('gate: no cookie → login, wrong dashboard → own home, allowed → through', async () => {
    let r = await M(req('/'));
    expect(status(r)).toBe(302);
    expect(location(r)).toMatch(/\/login\/\?next=%2F$/);
    r = await M(req('/api/control/suggestions'));
    expect(status(r)).toBe(401);
    const c = await cookieFor(member);
    r = await M(req('/', c));
    expect(status(r)).toBe(302);
    const u = new URL(location(r));
    expect(u.pathname + u.search).toBe('/?view=creative');
    r = await M(req('/admin/', c));
    expect(status(r)).toBe(302);
    r = await M(req('/?view=creative', c));
    expect(rewrite(r)).toBe('https://well.example/c/?view=creative'); // creative without analytics
  });

  it('gate: stale session re-checks permissions', async () => {
    const r = await M(req('/?view=creative', await cookieFor(member, Date.now() - 11 * 60e3)));
    expect(status(r)).toBe(302);
    expect(location(r)).toMatch(/\/api\/auth\/refresh\?next=/);
  });

  it('safePath blocks redirects to other sites', () => {
    expect(A.safePath('/control/')).toBe('/control/');
    expect(A.safePath('//evil.com')).toBe('');
    expect(A.safePath('https://evil.com')).toBe('');
    expect(A.safePath('/\\evil.com')).toBe('');
  });

  it('requireUser: disabled account and cross-site writes are refused', async () => {
    const isStatus = (n: number) => (r: unknown) => r instanceof Response && r.status === n;
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify([{ ...member, active: false }]), { status: 200 }));
    await A.requireUser(req('/api/account/password', await cookieFor(member)), E, 'any').then(() => { throw new Error('resolved'); }, r => expect(isStatus(401)(r)).toBe(true));
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify([member]), { status: 200 }));
    const ok = await A.requireUser(req('/api/account/password', await cookieFor(member)), E, 'creative');
    expect(ok.user.email).toBe('p@example.com');
    await A.requireUser(req('/api/control/x', await cookieFor(member)), E, 'control').then(() => { throw new Error('resolved'); }, r => expect(isStatus(403)(r)).toBe(true));
    const cross = req('/api/account/password', await cookieFor(member), { method: 'POST', headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } });
    await A.requireUser(cross, E, 'any', { write: true }).then(() => { throw new Error('resolved'); }, r => expect(isStatus(403)(r)).toBe(true));
  });

  it('department managers only reach their department copy', async () => {
    const ivMgr = { ...member, dashboards: ['ceo', 'creative'], departments: ['iv'] };
    const c = await cookieFor(ivMgr);
    expect(rewrite(await M(req('/', c)))).toBe('https://well.example/dept/iv/');
    expect(rewrite(await M(req('/?view=creative', c)))).toBe('https://well.example/dept/iv/?view=creative');
    expect(status(await M(req('/dept/foot/', c)))).toBe(403);
    expect(passed(await M(req('/dept/iv/', c)))).toBe(true);
    // No scope: sees everything and can open any department copy
    const all = await cookieFor({ ...member, dashboards: ['ceo'] });
    expect(passed(await M(req('/', all)))).toBe(true);
    expect(passed(await M(req('/dept/foot/', all)))).toBe(true);
    // The department copy does not open without analytics
    const ctl = await cookieFor({ ...member, dashboards: ['control'] });
    expect(status(await M(req('/dept/iv/', ctl)))).toBe(302);
  });

  it('owner is never department-scoped; unknown departments are dropped', () => {
    const o = A.sessionFor({ id: member.id, email: 'leen@example.com', departments: ['iv'] }, cfg);
    expect(o.depts).toEqual([]);
    expect(A.sessionFor({ ...member, departments: ['iv', 'hacker'] }, cfg).depts).toEqual(['iv']);
  });

  it('images need any dashboard; creative-only users get the creative copy', async () => {
    const cr = await cookieFor({ ...member, dashboards: ['creative'] });
    expect(passed(await M(req('/thumbs/abc.jpg', cr)))).toBe(true);
    expect(status(await M(req('/thumbs/abc.jpg')))).toBe(302);
    expect(status(await M(req('/thumbs/abc.jpg', await cookieFor({ ...member, dashboards: [] }))))).toBe(403);
    expect(rewrite(await M(req('/?view=creative', cr)))).toBe('https://well.example/c/?view=creative');
    const ceo = await cookieFor({ ...member, dashboards: ['ceo', 'creative'] });
    expect(passed(await M(req('/?view=creative', ceo)))).toBe(true);
    expect(status(await M(req('/c/', await cookieFor({ ...member, dashboards: ['control'] }))))).toBe(302);
  });

  it('one route per API group dispatches by the last path segment', async () => {
    const call = (path: string, init?: RequestInit) => api.request(path, init, E);
    expect((await call('/api/auth/nope')).status).toBe(404);
    expect((await call('/api/admin/users')).status).toBe(401); // no cookie: reaches the handler, which says 401
    const get = await authRoutes.logout.GET(req('/api/auth/logout'), E);
    expect(get.status).toBe(303);
    expect(get.headers.get('set-cookie')).toBeNull(); // a link from another site logs nobody out
    const cross = await call('/api/auth/logout', { method: 'POST', headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } });
    expect(cross.status).toBe(403);
    const out = await authRoutes.logout.POST(req('/api/auth/logout', null, { method: 'POST', headers: { origin: 'https://well.example', 'sec-fetch-site': 'same-origin' } }), E);
    expect(out.status).toBe(303);
    expect(out.headers.get('set-cookie')).toMatch(/Max-Age=0/i);
  });
});
