// The owner adds users from the dashboard: directly with a typed password, from auth accounts that have no profile, and with a new
// password for an existing user. A fake Supabase (in memory), synthetic data only, no network.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { users, direct, orphans, password } from '../../src/api/routes/admin';

const E: A.AuthEnv = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'service', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'leen@example.com' };
const cfg = A.env(E);
const ACME = '22222222-2222-2222-2222-222222222222';
const owner: A.Profile = { id: '33333333-3333-3333-3333-333333333333', email: 'boss@acme.example', role: 'owner', active: true, company_id: ACME };
const memberP: A.Profile = { id: '66666666-6666-6666-6666-666666666666', email: 'm@acme.example', role: 'member', active: true, company_id: ACME, access: { creative: 'view' } };
const STRANGER = '77777777-7777-7777-7777-777777777777';
const PW = 'Temp-pass-not-real-1';
const cookieFor = async (p: A.Profile) => `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(p, cfg), cfg.secret))}`;
const req = (path: string, cookie: string, method = 'GET', body?: unknown) => new Request('https://well.example' + path,
  { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers: { cookie, origin: 'https://well.example', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' } });

type Call = { url: string; method: string; body?: Record<string, unknown> };
// In-memory Supabase: auth users, profiles, audit rows. `inviteStatus` makes the invite answer like a failure.
function fake(opts: { inviteStatus?: number; inviteCode?: string; failProfile?: boolean } = {}) {
  const authUsers = new Map<string, { id: string; email: string; user_metadata?: { name?: string } }>([
    [owner.id, { id: owner.id, email: owner.email! }], [memberP.id, { id: memberP.id, email: memberP.email! }],
    [STRANGER, { id: STRANGER, email: 'by-hand@acme.example', user_metadata: { name: 'By Hand' } }],
  ]);
  const profiles = new Map<string, Record<string, unknown>>([[owner.id, owner as never], [memberP.id, memberP as never]]);
  const calls: Call[] = [];
  const j = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
  vi.stubGlobal('fetch', vi.fn(async (u: string, init: RequestInit = {}) => {
    const url = String(u), method = init.method || 'GET', body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    const path = url.replace('https://sb.example', '');
    if (path.startsWith('/rest/v1/profiles?id=eq.' + owner.id)) return j([owner]);
    if (path.startsWith('/auth/v1/invite')) return opts.inviteStatus ? j({ error_code: opts.inviteCode ?? '' }, opts.inviteStatus) : j({ id: 'a1a1a1a1-0000-4000-8000-000000000001' });
    if (path === '/auth/v1/admin/users' && method === 'POST') {
      if ([...authUsers.values()].some(x => x.email === body.email)) return j({ error_code: 'email_exists' }, 422);
      const id = '88888888-8888-4888-8888-888888888888';
      authUsers.set(id, { id, email: body.email });
      return j({ id, email: body.email });
    }
    if (path.startsWith('/auth/v1/admin/users?')) return j({ users: [...authUsers.values()] });
    const one = path.match(/^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/);
    if (one) {
      if (method === 'DELETE') { authUsers.delete(one[1]!); return j({}); }
      const a = authUsers.get(one[1]!);
      return a ? j(a) : j({}, 404);
    }
    if (path.startsWith('/rest/v1/profiles?select=id')) return j([...profiles.keys()].map(id => ({ id })));
    const byId = path.match(/^\/rest\/v1\/profiles\?id=eq\.([0-9a-f-]{36})&select=([^&]*)(&company_id=eq\.(.*))?$/);
    if (byId) { const p = profiles.get(byId[1]!); return j(p && (!byId[4] || p.company_id === byId[4]) ? [p] : []); }
    if (path === '/rest/v1/profiles' && method === 'POST') {
      if (opts.failProfile) return j({}, 500);
      profiles.set(body.id, body);
      return j([body]);
    }
    return j([]);
  }));
  return { calls, authUsers, profiles, audits: () => calls.filter(c => c.url.endsWith('/rest/v1/audit_log')).map(c => c.body!) };
}
afterEach(() => { vi.unstubAllGlobals(); });

const FORM = { email: 'New.Person@acme.example', name: 'New Person', password: PW, access: { creative: 'edit' }, departments: ['iv'] };

describe('add a user directly', () => {
  it('creates the login without an email, then the profile in the owner\'s company, and audits without the password', async () => {
    const f = fake();
    const res = await direct.POST!(req('/api/admin/direct', await cookieFor(owner), 'POST', FORM), E);
    expect(res.status).toBe(200);
    const made = f.calls.find(c => c.url.endsWith('/auth/v1/admin/users') && c.method === 'POST')!;
    expect(made.body).toMatchObject({ email: 'new.person@acme.example', password: PW, email_confirm: true });
    expect(f.calls.some(c => c.url.includes('/auth/v1/invite'))).toBe(false);
    expect(f.profiles.get('88888888-8888-4888-8888-888888888888')).toMatchObject({ company_id: ACME, role: 'member', access: { creative: 'edit' }, dashboards: ['creative'], departments: ['iv'], active: true });
    const a = f.audits();
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ action: 'user_added_direct', company_id: ACME });
    expect(JSON.stringify(a)).not.toContain(PW);
    expect(JSON.stringify(await res.text())).not.toContain(PW);
  });

  it('a duplicate email says so, and nothing else is written', async () => {
    const f = fake();
    const res = await direct.POST!(req('/api/admin/direct', await cookieFor(owner), 'POST', { ...FORM, email: 'M@acme.example' }), E);
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('الإيميل مسجّل من قبل');
    expect(f.calls.some(c => c.url.endsWith('/rest/v1/profiles') && c.method === 'POST')).toBe(false);
    expect(f.audits()).toHaveLength(0);
  });

  it('refuses a short password, a bad email and no dashboard before touching Supabase', async () => {
    const f = fake();
    const c = await cookieFor(owner);
    for (const body of [{ ...FORM, password: 'x'.repeat(A.PASSWORD_MIN - 1) }, { ...FORM, password: 'x'.repeat(73) }, { ...FORM, email: 'nope' }, { ...FORM, access: {} }]) {
      expect((await direct.POST!(req('/api/admin/direct', c, 'POST', body), E)).status).toBe(400);
    }
    expect(f.calls.filter(x => x.url.includes('/auth/v1/admin/users'))).toHaveLength(0);
  });

  it('takes the login back when the profile cannot be saved, so the email can be tried again', async () => {
    const f = fake({ failProfile: true });
    const res = await direct.POST!(req('/api/admin/direct', await cookieFor(owner), 'POST', FORM), E);
    expect(res.status).toBe(500);
    expect(f.authUsers.has('88888888-8888-4888-8888-888888888888')).toBe(false);
    expect(f.audits()).toHaveLength(0);
  });

  it('is the owner only, and a member cannot reach any of the three', async () => {
    fake();
    const c = await cookieFor(memberP);
    expect((await direct.POST!(req('/api/admin/direct', c, 'POST', FORM), E)).status).toBe(403);
    expect((await orphans.GET!(req('/api/admin/orphans', c), E)).status).toBe(403);
    expect((await orphans.POST!(req('/api/admin/orphans', c, 'POST', { id: STRANGER, access: { creative: 'view' } }), E)).status).toBe(403);
    expect((await password.POST!(req('/api/admin/password', c, 'POST', { id: memberP.id, password: PW }), E)).status).toBe(403);
  });
});

describe('accounts without a profile', () => {
  it('lists only the auth accounts that have no profile', async () => {
    fake();
    const res = await orphans.GET!(req('/api/admin/orphans', await cookieFor(owner)), E);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { accounts: { email: string }[] }).accounts.map(a => a.email)).toEqual(['by-hand@acme.example']);
  });

  it('gives one a profile in the owner\'s company, audited; it then leaves the list; a second try is refused', async () => {
    const f = fake();
    const c = await cookieFor(owner);
    const res = await orphans.POST!(req('/api/admin/orphans', c, 'POST', { id: STRANGER, access: { creative: 'view', ceo: 'edit' }, departments: [] }), E);
    expect(res.status).toBe(200);
    expect(f.profiles.get(STRANGER)).toMatchObject({ email: 'by-hand@acme.example', name: 'By Hand', company_id: ACME, role: 'member', access: { creative: 'view', ceo: 'edit' } });
    expect(f.audits()[0]).toMatchObject({ action: 'user_profile_created' });
    expect(((await (await orphans.GET!(req('/api/admin/orphans', c), E)).json()) as { accounts: unknown[] }).accounts).toEqual([]);
    expect((await orphans.POST!(req('/api/admin/orphans', c, 'POST', { id: STRANGER, access: { creative: 'view' } }), E)).status).toBe(409);
  });

  it('refuses an unknown id, and an id that is not a real account', async () => {
    fake();
    const c = await cookieFor(owner);
    expect((await orphans.POST!(req('/api/admin/orphans', c, 'POST', { id: 'nope', access: { creative: 'view' } }), E)).status).toBe(400);
    expect((await orphans.POST!(req('/api/admin/orphans', c, 'POST', { id: '99999999-9999-4999-8999-999999999999', access: { creative: 'view' } }), E)).status).toBe(404);
    expect((await orphans.POST!(req('/api/admin/orphans', c, 'POST', { id: STRANGER, access: {} }), E)).status).toBe(400);
  });
});

describe('set a new password', () => {
  it('changes it in the auth system for a user of the owner\'s company, and audits without it', async () => {
    const f = fake();
    const res = await password.POST!(req('/api/admin/password', await cookieFor(owner), 'POST', { id: memberP.id, password: PW }), E);
    expect(res.status).toBe(200);
    expect(f.calls.find(x => x.method === 'PUT' && x.url.endsWith(`/auth/v1/admin/users/${memberP.id}`))?.body).toEqual({ password: PW });
    expect(f.audits()[0]).toMatchObject({ action: 'user_password_set', target: { id: memberP.id, email: memberP.email } });
    expect(JSON.stringify(f.audits())).not.toContain(PW);
    expect(await res.text()).not.toContain(PW);
  });

  it('refuses a short password and a user of another company or none', async () => {
    const f = fake();
    const c = await cookieFor(owner);
    expect((await password.POST!(req('/api/admin/password', c, 'POST', { id: memberP.id, password: 'short' }), E)).status).toBe(400);
    expect((await password.POST!(req('/api/admin/password', c, 'POST', { id: STRANGER, password: PW }), E)).status).toBe(404);
    expect(f.calls.some(x => x.method === 'PUT')).toBe(false);
  });
});

describe('invite failures are said plainly', () => {
  const ask = async (opts: Parameters<typeof fake>[0]) => {
    fake(opts);
    const res = await users.POST!(req('/api/admin/users', await cookieFor(owner), 'POST', { email: 'a@acme.example', access: { creative: 'view' } }), E);
    return (await res.json() as { error: string }).error;
  };
  it('email limit, already registered, and anything else', async () => {
    expect(await ask({ inviteStatus: 429, inviteCode: 'over_email_send_rate_limit' })).toBe('وصلنا حد الإيميلات، أضفه مباشرة');
    expect(await ask({ inviteStatus: 422, inviteCode: 'email_exists' })).toBe('الإيميل مسجّل من قبل');
    expect(await ask({ inviteStatus: 500 })).toContain('أضفه مباشرة');
  });
});
