// Who can be named as a Social approver: only people with «approve» on the tab (or the owner), and only the owner sees addresses.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { approvers } from '../../src/modules/social/routes';
import { WELL_COMPANY } from '../../src/lib/tenant';

const E: A.AuthEnv = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'boss@example.com' };
const cfg = A.env(E);
const P = (id: string, email: string, name: string, extra: Partial<A.Profile>): A.Profile => ({ id, email, name, role: 'member', active: true, company_id: WELL_COMPANY, ...extra });
const owner = P('11111111-1111-4111-8111-111111111111', 'boss@example.com', 'Boss', { role: 'owner' });
const approver = P('22222222-2222-4222-8222-222222222222', 'sara@example.com', 'Sara', { access: { social: 'approve' } });
const editor = P('33333333-3333-4333-8333-333333333333', 'edit@example.com', 'Edwin', { access: { social: 'edit' } });
const outsider = P('44444444-4444-4444-8444-444444444444', 'personal@gmail.com', '', { access: { creative: 'view' } });
const legacy = P('55555555-5555-4555-8555-555555555555', 'old@example.com', 'Old', { dashboards: ['social'] });
const ALL = [owner, approver, editor, outsider, legacy];
afterEach(() => vi.unstubAllGlobals());

let saved: unknown;
async function call(who: A.Profile, method: 'GET' | 'PUT', named: string[] = [], body?: unknown) {
  saved = undefined;
  vi.stubGlobal('fetch', vi.fn(async (u: string, init: RequestInit = {}) => {
    const url = String(u);
    if (url.includes('/profiles?id=eq.')) return new Response(JSON.stringify([who]));
    if (url.includes('/rest/v1/profiles')) return new Response(JSON.stringify(ALL));
    if (url.includes('/rest/v1/companies')) { if (init.method === 'PATCH') { saved = JSON.parse(String(init.body)); return new Response('[]'); } return new Response(JSON.stringify([{ social_approvers: named }])); }
    return new Response('[]');
  }));
  const h = approvers[method]!;
  return h(new Request('https://well.example/api/social/approvers', { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { cookie: `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(who, cfg), cfg.secret))}`, origin: 'https://well.example', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' } }), E);
}

describe('social approvers', () => {
  it('the owner is offered only people with approve (and the owner), never an outsider\'s address', async () => {
    const j = await (await call(owner, 'GET')).json() as { people: { email: string }[] };
    expect(j.people.map(p => p.email).sort()).toEqual(['boss@example.com', 'old@example.com', 'sara@example.com']);
    expect(JSON.stringify(j)).not.toContain('personal@gmail.com');
    expect(JSON.stringify(j)).not.toContain('edit@example.com');
  });
  it('a member sees who approves by name only: no addresses at all', async () => {
    const j = await (await call(editor, 'GET', ['sara@example.com', 'gone@elsewhere.org'])).json() as { approvers: string[]; who: string[]; people: unknown[] };
    expect(j.who).toEqual(['Sara', 'g***@elsewhere.org']);
    expect(j.approvers).toEqual([]);
    expect(j.people).toEqual([]);
    expect(JSON.stringify(j)).not.toContain('sara@example.com');
  });
  it('naming someone without approve (or an outsider) is refused and nothing is saved; an eligible name saves', async () => {
    for (const bad of ['personal@gmail.com', 'edit@example.com']) {
      expect((await call(owner, 'PUT', [], { approvers: [bad] })).status).toBe(400);
      expect(saved).toBeUndefined();
    }
    expect((await call(owner, 'PUT', [], { approvers: ['sara@example.com'] })).status).toBe(200);
    expect(saved).toEqual({ social_approvers: ['sara@example.com'] });
  });
  it('only the owner can change the list', async () => {
    expect((await call(approver, 'PUT', [], { approvers: ['sara@example.com'] })).status).toBe(403);
  });
});
