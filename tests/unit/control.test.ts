import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../src/api/index';
import { check } from '../../src/lib/rules';
import { sign, SESSION, type AuthEnv } from '../../src/lib/auth';

const ENV: AuthEnv = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x', SESSION_SECRET: 's'.repeat(32), OWNER_EMAIL: 'leen@x.co' };
const ORIGIN = 'https://well.test';

type Profile = { id: string; email: string; role: string; dashboards: string[]; active: boolean };
const MEMBER: Profile = { id: 'u1', email: 'm@x.co', role: 'member', dashboards: ['control'], active: true };
const OWNER: Profile = { id: 'u0', email: 'leen@x.co', role: 'owner', dashboards: [], active: true };

async function cookie(p: Profile) {
  const now = Date.now();
  const token = await sign({ uid: p.id, email: p.email, name: '', role: p.role, dash: p.dashboards, depts: [], exp: now + 3600e3, chk: now }, ENV.SESSION_SECRET as string);
  return `${SESSION}=${token}`;
}

// Supabase stand-in: profiles for requireUser, then whatever the route reads or writes
function db(p: Profile, rest: (url: string, init: RequestInit) => unknown) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method || 'GET';
    calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const data = url.includes('/rest/v1/profiles') ? [p] : url.includes('/rest/v1/audit_log') ? null : rest(url, init);
    return new Response(data === null ? '' : JSON.stringify(data), { status: 200 });
  }));
  return calls;
}

async function call(path: string, p: Profile, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('cookie', await cookie(p));
  if (init.method && init.method !== 'GET') { headers.set('origin', ORIGIN); headers.set('content-type', 'application/json'); }
  return api.request(ORIGIN + path, { ...init, headers }, ENV);
}

afterEach(() => vi.unstubAllGlobals());

describe('control rules (rules.py parity)', () => {
  it('flags objective, Advantage+, age and budget', () => {
    expect(check({ objective: 'leads', age_min: 30, budget: '' })).toEqual([]);
    expect(check({ objective: 'awareness', advantage_plus: true, age_min: 25, budget: '0' })).toEqual([
      'الهدف لازم Sales أو Leads', 'بدون Advantage+', 'العمر يبدأ من 30', 'الميزانية لازم رقم أكبر من صفر',
    ]);
  });
});

describe('/api/control', () => {
  it('needs a session', async () => {
    const res = await api.request(ORIGIN + '/api/control/suggestions', {}, ENV);
    expect(res.status).toBe(401);
  });

  it('refuses a user without the control dashboard', async () => {
    db({ ...MEMBER, dashboards: ['ceo'] }, () => []);
    expect((await call('/api/control/suggestions', { ...MEMBER, dashboards: ['ceo'] })).status).toBe(403);
  });

  it('lists open and decided suggestions', async () => {
    db(MEMBER, url => (url.includes('status=eq.open') ? [{ id: 1 }] : [{ id: 2 }]));
    const res = await call('/api/control/suggestions', MEMBER);
    expect(await res.json()).toEqual({ open: [{ id: 1 }], done: [{ id: 2 }] });
  });

  it('refuses a cross-site write', async () => {
    db(MEMBER, () => []);
    const headers = new Headers({ cookie: await cookie(MEMBER), origin: 'https://evil.test', 'content-type': 'application/json' });
    const res = await api.request(ORIGIN + '/api/control/kill', { method: 'POST', headers, body: '{"on":true}' }, ENV);
    expect(res.status).toBe(403);
  });

  it('a member cannot turn the emergency stop off, the owner can', async () => {
    db(MEMBER, () => []);
    expect((await call('/api/control/kill', MEMBER, { method: 'POST', body: '{"on":false}' })).status).toBe(403);
    db(OWNER, () => [{ updated_at: 't' }]);
    expect((await call('/api/control/kill', OWNER, { method: 'POST', body: '{"on":false}' })).status).toBe(200);
  });

  it('only the owner sets canary campaigns or the platform mode', async () => {
    db(MEMBER, () => []);
    expect((await call('/api/control/kill', MEMBER, { method: 'POST', body: '{"canary":["c1"]}' })).status).toBe(403);
    expect((await call('/api/control/settings', MEMBER, { method: 'POST', body: '{"platform":"meta","mode":"auto"}' })).status).toBe(403);
  });

  it('approves only what passed the critic, and a new campaign only for the owner', async () => {
    const row = (kind: string, ok: boolean) => [{ id: 7, status: 'open', kind, critic: { ok } }];
    let calls = db(MEMBER, () => row('pause', false));
    let res = await call('/api/control/suggestions', MEMBER, { method: 'POST', body: '{"id":7,"decision":"approve"}' });
    expect(res.status).toBe(409);
    expect(calls.some(c => c.method === 'PATCH')).toBe(false);
    calls = db(MEMBER, () => row('new_campaign', true));
    res = await call('/api/control/suggestions', MEMBER, { method: 'POST', body: '{"id":7,"decision":"approve"}' });
    expect(res.status).toBe(409);
    calls = db(MEMBER, (_u, init) => (init.method === 'PATCH' ? [{ id: 7, status: 'approved' }] : row('pause', true)));
    res = await call('/api/control/suggestions', MEMBER, { method: 'POST', body: '{"id":7,"decision":"approve"}' });
    expect(res.status).toBe(200);
    expect(calls.find(c => c.method === 'PATCH')?.url).toContain('status=eq.open');
  });

  it('rejecting needs a reason', async () => {
    db(MEMBER, () => []);
    expect((await call('/api/control/suggestions', MEMBER, { method: 'POST', body: '{"id":7,"decision":"reject"}' })).status).toBe(400);
  });

  it('files a new-campaign request paused, with the health-ministry words flagged', async () => {
    const calls = db(MEMBER, () => [{ id: 9 }]);
    const fields = { dept: 'iv', start: '2026-11-05', creative: 'https://x/v.mp4', objective: 'leads', age_min: 30, budget: '', primary: 'الأفضل في الرياض' };
    const res = await call('/api/control/campaigns', MEMBER, { method: 'POST', body: JSON.stringify({ platform: 'meta', fields }) });
    expect(await res.json()).toEqual({ ok: true, id: 9 });
    const saved = calls.find(c => c.url.endsWith('/rest/v1/suggestions') && c.method === 'POST')?.body as Record<string, unknown>;
    expect(saved.kind).toBe('new_campaign');
    expect(saved.after).toMatchObject({ status: 'PAUSED' });
    expect((saved.critic as { ok: boolean }).ok).toBe(false);
    expect((saved.evidence as { moh: string[] }).moh).toEqual(['الأفضل']);
  });
});
