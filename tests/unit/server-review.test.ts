// Fixes from the full code review (server side): sessions that can be ended, a suspended company, brakes on the open doors,
// a gate that sees the path the router sees, daily limits that cannot be skipped, owners that cannot lock each other out,
// Well-only reads kept from other companies, listening and social cron. Fake Supabase in memory, synthetic data only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import * as authRoutes from '../../src/api/routes/auth';
import * as accountRoutes from '../../src/api/routes/account';
import * as vitalsRoute from '../../src/api/routes/vitals';
import { users as adminUsers, password as adminPassword } from '../../src/api/routes/admin';
import { api } from '../../src/api/index';
import { gate, need, normalizePath } from '../../src/lib/gate';
import { hit, clearLimits } from '../../src/lib/ratelimit';
import { WELL_COMPANY } from '../../src/lib/tenant';
import { dataHealth } from '../../src/modules/maestro/datahealth';
import { runSocial } from '../../src/modules/social/cron';
import { refresh as listenRefresh } from '../../src/modules/listening/routes';
import { report as debuggerReport } from '../../src/modules/debugger/routes';

const E: A.AuthEnv = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'service', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'leen@example.com' };
const cfg = A.env(E);
const ACME = '22222222-2222-2222-2222-222222222222';
const UID = '11111111-1111-1111-1111-111111111111', OWNER2 = '33333333-3333-3333-3333-333333333333', OWNER1 = '44444444-4444-4444-4444-444444444444';
const member: A.Profile = { id: UID, email: 'm@example.com', role: 'member', active: true, access: { ceo: 'view' }, company_id: WELL_COMPANY };

type Call = { url: string; method: string; body?: Record<string, unknown> };
let calls: Call[], profiles: Map<string, A.Profile & Record<string, unknown>>, tokenOk: boolean, auditFails: boolean, auditRows: number;
beforeEach(() => {
  calls = []; profiles = new Map(); tokenOk = false; auditFails = false; auditRows = 0; clearLimits();
  vi.stubGlobal('fetch', vi.fn(async (u: string, init: RequestInit = {}) => {
    const url = String(u), method = init.method || 'GET', body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body });
    const j = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
    if (url.includes('/auth/v1/token')) return tokenOk ? j({ user: { id: UID }, access_token: 't' }) : j({ error_code: 'invalid_credentials' }, 400);
    if (url.includes('/auth/v1/user') && method === 'PUT') return j({ id: UID, email: member.email });
    if (url.includes('/auth/v1/recover') || url.includes('/auth/v1/invite')) return j({});
    if (url.includes('/auth/v1/admin/users/')) return j({});
    const pid = /\/rest\/v1\/profiles\?id=eq\.([0-9a-f-]{36})/.exec(url)?.[1];
    if (pid && method === 'GET') { const p = profiles.get(pid); return j(p ? [p] : []); }
    if (pid && method === 'PATCH') { const p = profiles.get(pid); if (p) Object.assign(p, body); return j(p ? [p] : []); }
    if (url.includes('/rest/v1/audit_log') && method === 'POST') { if (auditFails) return j({}, 500); auditRows++; return new Response('', { status: 201 }); }
    if (url.includes('/rest/v1/audit_log')) return j(Array.from({ length: auditRows }, (_, i) => ({ id: i })));
    return j([]);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const cookieFor = async (p: A.Profile, now?: number) => `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(p, cfg, now), cfg.secret))}`;
const post = (path: string, body: unknown, cookie?: string, headers: Record<string, string> = {}) => new Request('https://well.example' + path, { method: 'POST', body: JSON.stringify(body),
  headers: { origin: 'https://well.example', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers } });
const patched = () => calls.filter(c => c.method === 'PATCH' && c.url.includes('/profiles?id=eq.'));
const warn = () => vi.spyOn(console, 'warn').mockImplementation(() => {});

describe('sessions can be ended (#8)', () => {
  it('a login made before valid_after is refused by the API; a later one and a profile without the column pass', async () => {
    const t0 = Date.now() - 3600_000;
    const old = await cookieFor(member, t0);
    profiles.set(UID, { ...member });
    expect((await api.request('https://well.example/api/account/password', { headers: { cookie: old } }, E)).status).toBe(200);   // no valid_after: nothing revoked
    profiles.set(UID, { ...member, valid_after: new Date(t0 + 60_000).toISOString() });
    const r = await api.request('https://well.example/api/account/password', { headers: { cookie: old } }, E);
    expect(r.status).toBe(401);
    expect(r.headers.get('set-cookie')).toContain('Max-Age=0');
    const fresh = await cookieFor(member, t0 + 120_000);
    expect((await api.request('https://well.example/api/account/password', { headers: { cookie: fresh } }, E)).status).toBe(200);
  });
  it('a cookie from before sessions carried a time counts as the oldest', () => {
    expect(A.revoked({ id: 'x', valid_after: new Date().toISOString() }, {})).toBe(true);
    expect(A.revoked({ id: 'x' }, {})).toBe(false);
    expect(A.revoked({ id: 'x', valid_after: null }, { iat: 1 })).toBe(false);
  });
  it('renewing a page session keeps the time of the original login, and a revoked one is sent to login', async () => {
    const t0 = Date.now() - 3600_000;
    profiles.set(UID, { ...member });
    const s = A.sessionFor(member, cfg, t0);
    const ok = await A.renew(cfg, s);
    expect(ok.kind === 'ok' && ok.session.iat).toBe(t0);
    profiles.set(UID, { ...member, valid_after: new Date(t0 + 1000).toISOString() });
    expect((await A.renew(cfg, s)).kind).toBe('login');
  });
  it('signing out, changing the password and a reset all void the older logins', async () => {
    profiles.set(UID, { ...member });
    const cookie = await cookieFor(member);
    const out = await authRoutes.logout.POST(post('/api/auth/logout', {}, cookie), E);
    expect(out.status).toBe(303);
    expect(patched()).toHaveLength(1);
    expect(Date.parse(String(profiles.get(UID)!.valid_after))).toBeGreaterThan(Date.now() - 5000);
    // reset by the emailed link
    calls = []; delete profiles.get(UID)!.valid_after;
    const reset = await authRoutes.reset.POST(post('/api/auth/reset', { access_token: 'tok', password: 'long-enough-1' }), E);
    expect(reset.status).toBe(200);
    expect(patched()).toHaveLength(1);
    // password change: the other logins end, this one gets a fresh cookie made after the cut-off
    calls = []; delete profiles.get(UID)!.valid_after; tokenOk = true;
    const changed = await accountRoutes.password.POST(post('/api/account/password', { current: 'old-password-1', password: 'long-enough-2' }, cookie), E);
    expect(changed.status).toBe(200);
    expect(patched()).toHaveLength(1);
    const set = changed.headers.get('set-cookie') || '';
    expect(set).toContain(A.SESSION);
    const fresh = await A.verify(decodeURIComponent(set.split(';')[0]!.split('=').slice(1).join('=')), cfg.secret);
    expect(fresh!.iat!).toBeGreaterThanOrEqual(Date.parse(String(profiles.get(UID)!.valid_after)));
    expect(A.revoked(profiles.get(UID)!, fresh!)).toBe(false);
    expect(A.revoked(profiles.get(UID)!, { iat: Date.now() - 60_000 })).toBe(true);
  });
  it('without the column (migration 036 not applied) a failed write is logged and nothing breaks', async () => {
    warn();
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit = {}) => (init.method === 'PATCH' ? new Response(JSON.stringify({ code: '42703' }), { status: 400 }) : new Response('[]'))));
    expect(await A.revokeSessions(cfg, UID)).toBeNull();
    expect(await A.revokeSessions(cfg, 'not-a-uuid')).toBeNull();
  });
  it('an owner setting a user\'s password also ends that user\'s logins', async () => {
    const boss: A.Profile = { id: OWNER1, email: 'boss@acme.example', role: 'owner', active: true, company_id: ACME };
    profiles.set(OWNER1, boss as never); profiles.set(UID, { ...member, company_id: ACME });
    const r = await adminPassword.POST(post('/api/admin/password', { id: UID, password: 'long-enough-3' }, await cookieFor(boss)), E);
    expect(r.status).toBe(200);
    expect(profiles.get(UID)!.valid_after).toBeTruthy();
  });
});

describe('a suspended company (#11)', () => {
  it('companies.active = false refuses the API (and clears the cookie) and sends a page session to login', async () => {
    profiles.set(UID, { ...member, company: { disabled_modules: [], active: false } });
    const r = await api.request('https://well.example/api/account/password', { headers: { cookie: await cookieFor(member) } }, E);
    expect(r.status).toBe(401);
    expect(r.headers.get('set-cookie')).toContain('Max-Age=0');
    expect((await A.renew(cfg, A.sessionFor(member, cfg))).kind).toBe('login');
    profiles.set(UID, { ...member, company: { disabled_modules: [], active: true } });
    expect((await A.renew(cfg, A.sessionFor(member, cfg))).kind).toBe('ok');
  });
  it('login is refused for a user of a suspended company', async () => {
    warn(); tokenOk = true;
    profiles.set(UID, { ...member, company: { disabled_modules: [], active: false } });
    const r = await authRoutes.login.POST(post('/api/auth/login', { email: 'm@example.com', password: 'pw-not-real-1' }), E);
    expect(r.status).toBe(403);
    expect(r.headers.get('set-cookie')).toBeNull();
  });
  it('the profile read asks for the column', async () => {
    profiles.set(UID, { ...member });
    await A.readProfile(cfg, UID);
    expect(calls[0]!.url).toContain('companies(disabled_modules,active)');
  });
});

describe('the open doors have a brake (#7, #21)', () => {
  it('the same email is stopped after 8 tries in 10 minutes, before Supabase is asked', async () => {
    warn();
    const go = () => authRoutes.login.POST(post('/api/auth/login', { email: 'who@example.com', password: 'wrong-pw-1' }, undefined, { 'cf-connecting-ip': '203.0.113.7' }), E);
    for (let i = 0; i < 8; i++) expect((await go()).status).toBe(401);
    const tokenCalls = calls.filter(c => c.url.includes('/auth/v1/token')).length;
    const stopped = await go();
    expect(stopped.status).toBe(429);
    expect(calls.filter(c => c.url.includes('/auth/v1/token')).length).toBe(tokenCalls);
    // another email from another address is not affected
    expect((await authRoutes.login.POST(post('/api/auth/login', { email: 'other@example.com', password: 'wrong-pw-1' }, undefined, { 'cf-connecting-ip': '203.0.113.8' }), E)).status).toBe(401);
  });
  it('one address is stopped after 30 tries even across emails', async () => {
    warn();
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await authRoutes.login.POST(post('/api/auth/login', { email: `u${i}@example.com`, password: 'wrong-pw-1' }, undefined, { 'cf-connecting-ip': '203.0.113.9' }), E)).status;
    expect(last).toBe(429);
  });
  it('anonymous audit rows are capped per minute: a flood writes a handful, not thousands', async () => {
    warn();
    for (let i = 0; i < 6; i++) { // 6 emails, each tried once: all 401, but only the first rows reach audit_log
      await authRoutes.login.POST(post('/api/auth/login', { email: `f${i}@example.com`, password: 'wrong-pw-1' }, undefined, { 'cf-connecting-ip': `203.0.113.${20 + i}` }), E);
    }
    for (let i = 0; i < 6; i++) await A.auditAnon(cfg, { email: 'x@example.com' }, 'login_failed');
    expect(calls.filter(c => c.url.includes('/audit_log') && c.method === 'POST').length).toBe(6);
  });
  it('forgot: 3 requests per email in 10 minutes, then 429 without sending anything', async () => {
    const go = () => authRoutes.forgot.POST(post('/api/auth/forgot', { email: 'someone@example.com' }, undefined, { 'cf-connecting-ip': '203.0.113.30' }), E);
    for (let i = 0; i < 3; i++) expect((await go()).status).toBe(200);
    const sent = calls.filter(c => c.url.includes('/auth/v1/recover')).length;
    expect((await go()).status).toBe(429);
    expect(calls.filter(c => c.url.includes('/auth/v1/recover')).length).toBe(sent);
  });
  it('reset is braked per address', async () => {
    let last = 0;
    for (let i = 0; i < 21; i++) last = (await authRoutes.reset.POST(post('/api/auth/reset', { access_token: 't', password: 'short' }, undefined, { 'cf-connecting-ip': '203.0.113.40' }), E)).status;
    expect(last).toBe(429);
  });
  it('web vitals: 30 reports a minute per user, the 31st is refused', async () => {
    profiles.set(UID, { ...member });
    const cookie = await cookieFor(member);
    const send = () => vitalsRoute.report.POST(post('/api/vitals/report', { path: '/today/', lcp: 1200 }, cookie), E);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    for (let i = 0; i < 30; i++) expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(429);
  });
  it('the limiter forgets old calls and keeps its memory bounded', () => {
    expect(hit('k', 2, 1000, 0)).toBe(true); expect(hit('k', 2, 1000, 1)).toBe(true); expect(hit('k', 2, 1000, 2)).toBe(false);
    expect(hit('k', 2, 1000, 1500)).toBe(true);
    for (let i = 0; i < 6000; i++) hit('many:' + i, 1, 1000, 10);
    expect(hit('many:5999', 1, 1000, 11)).toBe(false);   // recent keys survive the clean-up
  });
});

describe('the gate sees the path the router sees (#22)', () => {
  it('normalizePath decodes (twice), resolves dot segments and repeated slashes, keeps a trailing slash', () => {
    expect(normalizePath('/api/%61dmin/users')).toBe('/api/admin/users');
    expect(normalizePath('/api/%2561dmin/users')).toBe('/api/admin/users');
    expect(normalizePath('/assets/..%2fapi/admin')).toBe('/api/admin');
    expect(normalizePath('//api//admin/./users')).toBe('/api/admin/users');
    expect(normalizePath('/today/')).toBe('/today/');
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('/a/%E0%A4%A')).toBe('/a/%E0%A4%A');   // a cut escape is left alone, never an error
  });
  it('an encoded admin path is classified as owner-only', () => {
    for (const p of ['/api/%61dmin/users', '/api/admin%2Fusers', '/%61pi/admin/log', '/assets/..%2fapi/admin/users', '//api/admin/users']) expect(need(p, '')).toBe('owner');
    expect(need('/assets/app.css', '')).toBeNull();
    expect(need('/api/auth/login', '')).toBeNull();
  });
  it('a member opening an encoded admin API path gets 403 from the gate itself', async () => {
    profiles.set(UID, { ...member });
    const d = await gate(new Request('https://well.example/api/%61dmin/users', { headers: { cookie: await cookieFor(member) } }), E);
    expect(d instanceof Response && d.status).toBe(403);
  });
});

describe('daily limits cannot be skipped (#17)', () => {
  const day = '2026-11-14T00:00:00.000Z';
  it('the row is written first and counted after: at the limit passes, one more is over', async () => {
    expect(await A.claimDaily(cfg, { uid: UID }, 'ahlam_ask', 3, day)).toBe('ok');   // count answers 1 row
    auditRows = 3;
    expect(await A.claimDaily(cfg, { uid: UID }, 'ahlam_ask', 3, day)).toBe('over');   // rows are now 4
    const order = calls.map(c => c.method + ' ' + (c.url.includes('audit_log?') ? 'count' : 'write'));
    expect(order.slice(0, 2)).toEqual(['POST write', 'GET count']);
  });
  it('a row that cannot be saved or a count that fails refuses (fail closed)', async () => {
    auditFails = true;
    expect(await A.claimDaily(cfg, { uid: UID }, 'ahlam_ask', 3, day)).toBe('error');
    auditFails = false;
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit = {}) => (init.method === 'POST' ? new Response('', { status: 201 }) : new Response('{}', { status: 500 }))));
    expect(await A.claimDaily(cfg, { uid: UID }, 'ahlam_ask', 3, day)).toBe('error');
    expect(await A.claimDaily(cfg, { uid: 'bad' }, 'ahlam_ask', 3, day)).toBe('error');
  });
});

describe('owners cannot lock each other out (#24)', () => {
  const boss: A.Profile = { id: OWNER1, email: 'boss@acme.example', role: 'owner', active: true, company_id: ACME };
  const other: A.Profile = { id: OWNER2, email: 'second@acme.example', role: 'owner', active: true, company_id: ACME };
  const patch = async (body: unknown) => adminUsers.PATCH(new Request('https://well.example/api/admin/users', { method: 'PATCH', body: JSON.stringify(body),
    headers: { cookie: await cookieFor(boss), origin: 'https://well.example', 'sec-fetch-site': 'same-origin' } }), E);
  it('one owner cannot switch off or ban another owner: nothing is written, nothing is banned', async () => {
    profiles.set(OWNER1, boss as never); profiles.set(OWNER2, other as never);
    const r = await patch({ id: OWNER2, active: false });
    expect(r.status).toBe(403);
    expect(calls.some(c => c.url.includes('/auth/v1/admin/users/'))).toBe(false);
    expect(patched().filter(c => c.url.includes(OWNER2))).toHaveLength(0);
  });
  it('a member of the company can still be switched off, and an owner\'s other fields can still be edited', async () => {
    profiles.set(OWNER1, boss as never); profiles.set(OWNER2, other as never); profiles.set(UID, { ...member, company_id: ACME });
    expect((await patch({ id: UID, active: false })).status).toBe(200);
    expect(calls.some(c => c.url.includes(`/auth/v1/admin/users/${UID}`) && c.body?.ban_duration === '876000h')).toBe(true);
    expect((await patch({ id: OWNER2, name: 'Second Owner' })).status).toBe(200);
    expect((await patch({ id: OWNER1, active: false })).status).toBe(400);   // not yourself either (as before)
  });
});

describe('Well-only reads stay Well\'s (#2)', () => {
  it('the data-health page of another company never reads the CRM sync state, dash.json or the pipeline status', async () => {
    const files = { get: vi.fn(async () => null) } as unknown as R2Bucket;
    const r = await dataHealth(cfg, ACME, 'sources', files) as { freshness: { crm: unknown; dash_json_uploaded: unknown }; data_status: unknown; joins: unknown };
    expect(calls.some(c => c.url.includes('crm_sync_state'))).toBe(false);
    expect((files.get as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(r.freshness.crm).toBeNull(); expect(r.freshness.dash_json_uploaded).toBeNull(); expect(r.data_status).toBeNull(); expect(r.joins).toBeNull();
  });
  it('Well\'s own owner still reads them', async () => {
    const files = { get: vi.fn(async () => null) } as unknown as R2Bucket;
    await dataHealth(cfg, WELL_COMPANY, 'sources', files);
    expect(calls.some(c => c.url.includes('crm_sync_state'))).toBe(true);
    expect((files.get as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });
  it('counts: the platform-wide ad_metrics count and the orphan counts are Well\'s; another company gets null and none', async () => {
    const heads = () => calls.filter(c => c.method === 'HEAD').map(c => c.url);
    const other = await dataHealth(cfg, ACME, 'counts') as { counts: Record<string, number | null>; orphans: Record<string, unknown> };
    expect(other.counts['ad_metrics']).toBeNull();
    expect(Object.keys(other.orphans)).toHaveLength(0);
    expect(heads().some(u => u.includes('/ad_metrics'))).toBe(false);
    expect(calls.some(c => c.url.includes('/companies?select=id'))).toBe(false);
    calls = [];
    await dataHealth(cfg, WELL_COMPANY, 'counts');
    expect(heads().some(u => u.includes('/ad_metrics'))).toBe(true);
  });
  it('the debugger report gives another company no Well linked-lead share', async () => {
    const dash = { crm: { by_platform: {} } };
    const files = { get: vi.fn(async () => ({ json: async () => dash })) } as unknown as R2Bucket;
    const asCompany = async (co: string, uid: string) => {
      const p: A.Profile = { id: uid, email: 'd@example.com', role: 'owner', active: true, company_id: co };
      profiles.set(uid, p as never);
      const res = await debuggerReport.GET(new Request('https://well.example/api/debugger/report', { headers: { cookie: await cookieFor(p) } }), { ...E, FILES: files } as A.AuthEnv);
      return res.json() as Promise<{ linked: unknown }>;
    };
    expect((await asCompany(ACME, OWNER1)).linked).toBeNull();
    expect((files.get as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    await asCompany(WELL_COMPANY, OWNER2);
    expect((files.get as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });
});

describe('listening refresh (#20)', () => {
  const recent = new Date(Date.now() - 3600_000).toISOString();
  const watch = { id: 5, name: 'كلمة', fetched_at: recent, terms: [], sources: [] };
  const run = async (p: A.Profile) => {
    profiles.set(p.id, p as never);
    vi.stubGlobal('fetch', vi.fn(async (u: string, init: RequestInit = {}) => {
      calls.push({ url: String(u), method: init.method || 'GET' });
      if (String(u).includes('/profiles?id=eq.')) return new Response(JSON.stringify([p]));
      if (String(u).includes('/listen_watch')) return new Response(JSON.stringify([watch]));
      return new Response('[]');
    }));
    return listenRefresh.POST(post('/api/listening/refresh', { id: 5 }, await cookieFor(p)), E);
  };
  it('an editor naming a watch that was refreshed today runs nothing; the paid search is not started', async () => {
    const r = await run({ id: UID, email: 'e@example.com', role: 'member', active: true, access: { listening: 'edit' }, company_id: WELL_COMPANY });
    expect(await r.json()).toMatchObject({ ok: true, ran: 0 });
    expect(calls.some(c => /x\.ai|openai|youtube|reddit|news\.google|rss/i.test(c.url))).toBe(false);
  });
  it('the owner may force it', async () => {
    const r = await run({ id: OWNER2, email: 'o@example.com', role: 'owner', active: true, company_id: WELL_COMPANY });
    expect(((await r.json()) as { ran: number }).ran).toBe(1);
  });
});

describe('social cron (#6)', () => {
  it('fetches only approved posts: an unapproved overdue post cannot fill the 50-row window', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => { urls.push(String(u)); return new Response('[]'); }));
    await runSocial({ ...E } as A.AuthEnv, Date.now());
    const due = urls.find(u => u.includes('/social_posts?') && u.includes('status=eq.scheduled'))!;
    expect(due).toContain('approved_at=not.is.null');
    expect(due).toContain('limit=50');
  });
});
