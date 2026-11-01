// Modules: the registry drives routes, the gate and the sidebar; a company can lock a module for everyone in it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { gate, need } from '../../src/lib/gate';
import { MODULES, LIVE } from '../../src/modules/registry';
import { ROUTES } from '../../src/modules/routes';
import { password } from '../../src/api/routes/account';
import { modules } from '../../src/api/routes/admin';
import * as routesModule from '../../src/modules/routes';

const E: A.AuthEnv = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'leen@example.com' };
const cfg = A.env(E);
const leen: A.Profile = { id: '11111111-1111-1111-1111-111111111111', email: 'leen@example.com', active: true, company: { disabled_modules: ['journeys'] } };
const cookieFor = async (p: A.Profile) => `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(p, cfg), cfg.secret))}`;
const req = (path: string, cookie: string, init: RequestInit = {}) => new Request('https://well.example' + path,
  { ...init, headers: { cookie, origin: 'https://well.example', 'sec-fetch-site': 'same-origin' } });
const stubProfile = (p: A.Profile, extra: (url: string, init: RequestInit) => Response | null = () => null) =>
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => extra(url, init) ?? new Response(JSON.stringify(url.includes('/profiles?id=eq.') ? [p] : []))));

afterEach(() => { vi.unstubAllGlobals(); });

describe('registry', () => {
  it('every live module has routes, and only live ones', () => {
    expect(Object.keys(ROUTES).sort()).toEqual([...LIVE].sort());
    expect(new Set(MODULES.map(m => m.key)).size).toBe(MODULES.length);
    expect(A.DASHBOARDS).toMatchObject({ ceo: 'التحليلات', maestro: 'المايسترو', social: 'السوشال' });
    for (const m of MODULES.filter(x => x.status === 'soon')) expect(Object.keys(A.DASHBOARDS)).not.toContain(m.key); // soon modules are not dashboards
    expect(A.DASHBOARDS).toMatchObject({ voice: 'الصوت', debugger: 'التتبع' });
    expect(Object.keys(routesModule)).toEqual(['ROUTES']);
  });
  it('the gate maps module paths to their dashboard', () => {
    expect(need('/social/', '')).toBe('social');
    expect(need('/api/maestro/state', '')).toBe('maestro');
    expect(need('/voice/', '')).toBe('voice');
    expect(need('/api/compliance/scan', '')).toBe('compliance');
    expect(need('/nothing/', '')).toBe('ceo');                            // not a module: no special rule
  });
});

describe('locked modules', () => {
  it('lock even the owner out, on pages and APIs', async () => {
    const s = A.sessionFor(leen, cfg);
    expect(s.off).toEqual(['journeys']);
    expect(A.can(s, 'journeys', cfg)).toBe(false);
    expect(A.can(s, 'social', cfg)).toBe(true);
    const cookie = await cookieFor(leen);
    const page = await gate(req('/journeys/', cookie), E);
    expect(page instanceof Response && page.status).toBe(403);
    stubProfile(leen);
    const { ROUTES: R } = await import('../../src/modules/routes');
    const res = await R.journeys.list.GET(req('/api/journeys/list', cookie), E);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe(A.LOCKED);
  });

  it('the sidebar list marks locked and soon modules', async () => {
    stubProfile(leen);
    const me = (await (await password.GET(req('/api/account/password', await cookieFor(leen)), E)).json()) as { modules: { key: string }[] };
    const by = Object.fromEntries(me.modules.map(m => [m.key, m]));
    expect(by.journeys).toMatchObject({ locked: true, ok: false });
    expect(by.social).toMatchObject({ locked: false, ok: true, status: 'live' });
    expect(by.voice).toMatchObject({ status: 'live', ok: true });
    for (const m of MODULES.filter(x => x.status === 'soon')) expect(by[m.key]).toMatchObject({ status: 'soon', ok: true });
  });

  it('the owner switches modules off; unknown keys are dropped', async () => {
    let saved: unknown;
    stubProfile(leen, (url, init) => (url.includes('/companies?id=eq.') && init.method === 'PATCH' ? (saved = JSON.parse(String(init.body)), new Response('')) : null));
    const r = await modules.PATCH!(req('/api/admin/modules', await cookieFor(leen), { method: 'PATCH', body: JSON.stringify({ off: ['journeys', 'voice', 'hack', 'journeys'] }) }), E);
    expect(r.status).toBe(200);
    expect(saved).toEqual({ disabled_modules: ['journeys', 'voice'] });
  });
});
