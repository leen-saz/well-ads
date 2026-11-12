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
    expect(A.DASHBOARDS).toMatchObject({ ceo: 'الحملات والمنصات', maestro: 'المدير', social: 'السوشال' });
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
    // A page is a screen in Well's own shell that says the section is off, not a bare white page with a «sign in» link
    expect(page instanceof Response && page.status).toBe(302);
    expect(page instanceof Response && page.headers.get('location')).toBe('https://well.example/soon/?t=journeys&why=locked');
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

describe('tabs with sections (voiceover in voice, copy in content)', () => {
  const dest = (r: unknown) => (r instanceof Response ? r.headers.get('location') : null);
  it('the section is picked with ?tab= and keeps its own access, on pages only', () => {
    expect(need('/voice/', '?tab=voiceover')).toBe('voiceover');
    expect(need('/content/', '?tab=copy')).toBe('copy');
    expect(need('/voice/', '?tab=copy')).toBe('voice');            // a section of another tab: not this one's
    expect(need('/api/voice/guide', '?tab=voiceover')).toBe('voice');
    expect(need('/api/voiceover/guide', '')).toBe('voiceover'); expect(need('/api/copy/projects', '')).toBe('copy');
  });
  it('the old addresses open the section inside the tab', async () => {
    const cookie = await cookieFor({ ...leen, company: { disabled_modules: [] } });
    expect(dest(await gate(req('/voiceover/', cookie), E))).toBe('https://well.example/voice/?tab=voiceover');
    expect(dest(await gate(req('/copy/', cookie), E))).toBe('https://well.example/content/?tab=copy');
  });
  it('a locked section stays locked, at the old address and inside the tab', async () => {
    const cookie = await cookieFor({ ...leen, company: { disabled_modules: ['voiceover'] } });
    for (const p of ['/voiceover/', '/voice/?tab=voiceover']) { const r = await gate(req(p, cookie), E); expect(r instanceof Response && r.status).toBe(302); expect(r instanceof Response && r.headers.get('location')).toContain('/soon/?t=voiceover&why=locked'); }
    expect(await gate(req('/voice/', cookie), E)).toEqual({ pass: true });
  });
  it('the sections have no sidebar entry; the tab opens its only section for a user who has just that', async () => {
    const { sections } = await import('../../public/assets/sidebar.js');
    const all = (m: unknown) => (sections(m, (ar: string) => ar) as { items: { href: string; key: string; state: string }[] }[]).flatMap(s => s.items);
    const base = (ok: (k: string) => boolean) => ({ role: 'member', email: 'x@x', dashboards: [], modules: MODULES.map(m => ({ ...m, ok: ok(m.key), locked: false })) });
    const full = all(base(() => true));
    expect(full.map(i => i.key)).not.toContain('voiceover'); expect(full.map(i => i.key)).not.toContain('copy');
    expect(full.find(i => i.key === 'voice')?.href).toBe('/voice/');
    const only = all(base(k => k === 'voiceover' || k === 'copy'));
    expect(only.find(i => i.key === 'voice')).toMatchObject({ href: '/voice/?tab=voiceover', state: 'ok' });
    expect(only.find(i => i.key === 'content')).toMatchObject({ href: '/content/?tab=copy', state: 'ok' });
  });
});

describe('the Media buyer is a tab of the decisions board, not a module of its own', () => {
  it('is in no module registry, route list or dashboard list; its API asks for the decisions board; its old page redirects', async () => {
    expect(MODULES.some(m => m.key === 'buyer')).toBe(false);
    expect(LIVE).not.toContain('buyer');
    expect(Object.keys(ROUTES)).not.toContain('buyer');
    expect(Object.keys(A.DASHBOARDS)).not.toContain('buyer');
    expect(need('/api/buyer/report', '')).toBe('control');
    expect(need('/api/buyer/apply', '')).toBe('control');
    const d = await gate(req('/buyer/', ''), E);
    expect(d instanceof Response && d.status).toBe(301);
    expect(d instanceof Response && d.headers.get('location')).toBe('/control/?tab=buyer');
  });
});
