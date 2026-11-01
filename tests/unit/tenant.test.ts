// SaaS isolation: a company owner sees and edits only their own company's users and log. No network.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { WELL_COMPANY, companyOf, scoped } from '../../src/lib/tenant';
import { users, log } from '../../src/api/routes/admin';

const E: A.AuthEnv = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'service', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'leen@example.com' };
const cfg = A.env(E);
const ACME = '22222222-2222-2222-2222-222222222222';
const acmeOwner: A.Profile = { id: '33333333-3333-3333-3333-333333333333', email: 'boss@acme.example', role: 'owner', active: true, company_id: ACME };
const cookieFor = async (p: A.Profile) => `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(p, cfg), cfg.secret))}`;
const req = (path: string, cookie: string, init: RequestInit = {}) => new Request('https://well.example' + path,
  { ...init, headers: { cookie, origin: 'https://well.example', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' } });

afterEach(() => { vi.unstubAllGlobals(); });

describe('tenant', () => {
  it('defaults to Well and rejects junk company ids', () => {
    expect(companyOf(undefined)).toBe(WELL_COMPANY);
    expect(companyOf('x; drop table')).toBe(WELL_COMPANY);
    expect(companyOf(ACME.toUpperCase())).toBe(ACME);
    expect(A.sessionFor(acmeOwner, cfg).co).toBe(ACME);
    expect(A.sessionFor({ id: acmeOwner.id, email: 'p@example.com' }, cfg).co).toBe(WELL_COMPANY);
  });

  it('scopes REST paths with or without a query', () => {
    expect(scoped('/rest/v1/profiles', ACME)).toBe(`/rest/v1/profiles?company_id=eq.${ACME}`);
    expect(scoped('/rest/v1/profiles?select=*', ACME)).toBe(`/rest/v1/profiles?select=*&company_id=eq.${ACME}`);
    expect(() => scoped('/rest/v1/profiles', 'eq.x')).toThrow();
  });

  it("a company owner lists, invites and edits only their company's users", async () => {
    const calls: { url: string; body?: unknown }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined });
      if (url.includes('/rest/v1/profiles?id=eq.' + acmeOwner.id)) return new Response(JSON.stringify([acmeOwner]));
      if (url.includes('/auth/v1/invite')) return new Response(JSON.stringify({ id: '44444444-4444-4444-4444-444444444444' }));
      if (url.includes('/rest/v1/profiles?id=eq.55555555')) return new Response('[]'); // another company's user: not found in ours
      return new Response(JSON.stringify([{ email: 'x@acme.example' }]));
    }));
    const cookie = await cookieFor(acmeOwner);
    expect((await users.GET!(req('/api/admin/users', cookie), E)).status).toBe(200);
    expect((await log.GET!(req('/api/admin/log', cookie), E)).status).toBe(200);
    const inv = await users.POST!(req('/api/admin/users', cookie, { method: 'POST', body: JSON.stringify({ email: 'new@acme.example', dashboards: ['creative'] }) }), E);
    expect(inv.status).toBe(200);
    const other = await users.PATCH!(req('/api/admin/users', cookie, { method: 'PATCH', body: JSON.stringify({ id: '55555555-5555-5555-5555-555555555555', active: false }) }), E);
    expect(other.status).toBe(404);
    const lists = calls.filter(c => /profiles\?select=|audit_log\?select=/.test(c.url));
    expect(lists.length).toBe(2);
    for (const c of lists) expect(c.url).toContain(`company_id=eq.${ACME}`);
    expect(calls.find(c => c.url.endsWith('/rest/v1/profiles'))?.body).toMatchObject({ company_id: ACME, role: 'member' });
    expect(calls.some(c => c.url.includes('55555555') && !c.url.includes(`company_id=eq.${ACME}`))).toBe(false);
  });
});
