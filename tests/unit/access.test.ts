// Access levels: view < edit < approve per dashboard/module. Reads need view, writes edit, approvals approve.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { ROUTES } from '../../src/modules/routes';
import { users } from '../../src/api/routes/admin';

const E: A.AuthEnv = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'leen@example.com' };
const cfg = A.env(E);
const member = (access: Record<string, string>): A.Profile => ({ id: '22222222-2222-2222-2222-222222222222', email: 'm@example.com', role: 'member', active: true, access });
const cookieFor = async (p: A.Profile) => `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(p, cfg), cfg.secret))}`;
const req = (path: string, cookie: string, method = 'GET', body?: unknown) => new Request('https://well.example' + path,
  { method, headers: { cookie, origin: 'https://well.example', 'sec-fetch-site': 'same-origin' }, ...(body ? { body: JSON.stringify(body) } : {}) });
const stub = (p: A.Profile, rest: (url: string, init: RequestInit) => unknown = () => []) => {
  const calls: { url: string; body?: unknown }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(url.includes('/profiles?id=eq.' + p.id) ? [p] : rest(url, init)));
  }));
  return calls;
};
afterEach(() => { vi.unstubAllGlobals(); });

describe('levels', () => {
  it('reads levels from access, falls back to dashboards, and drops junk', () => {
    expect(A.levelsOf({ id: 'x', access: { social: 'view', content: 'approve', bogus: 'edit', ceo: 'god' } })).toEqual({ social: 'view', content: 'approve' });
    expect(A.levelsOf({ id: 'x', dashboards: ['control'] })).toEqual({ control: 'approve' });   // before migration 012: same power as before
    const s = A.sessionFor(member({ social: 'view' }), cfg);
    expect(s.dash).toEqual(['social']);
    expect(A.atLeast(s, 'social', 'view')).toBe(true);
    expect(A.atLeast(s, 'social', 'edit')).toBe(false);
    expect(A.atLeast(A.sessionFor({ id: 'o', email: 'leen@example.com' }, cfg), 'content', 'approve', cfg)).toBe(true);
  });

  it('view can read but not write; edit can write but not approve', async () => {
    const viewer = member({ social: 'view' });
    stub(viewer, () => []);
    expect((await ROUTES.social.posts.GET(req('/api/social/posts', await cookieFor(viewer)), E)).status).toBe(200);
    const w = await ROUTES.social.posts.POST(req('/api/social/posts', await cookieFor(viewer), 'POST', { platforms: ['facebook'], body: 'x', publish_at: '2099-01-01T00:00:00Z' }), E);
    expect(w.status).toBe(403);
    expect(((await w.json()) as { error: string }).error).toBe(A.VIEW_ONLY);

    const editor = member({ social: 'edit' });
    stub(editor, () => [{ id: 1 }]);
    const a = await ROUTES.social.posts.PATCH(req('/api/social/posts', await cookieFor(editor), 'PATCH', { id: 1, action: 'approve' }), E);
    expect(a.status).toBe(403);
    expect(((await a.json()) as { error: string }).error).toBe(A.NO_APPROVE);
    expect((await ROUTES.social.posts.PATCH(req('/api/social/posts', await cookieFor(editor), 'PATCH', { id: 1, action: 'cancel' }), E)).status).toBe(200);

    const approver = member({ social: 'approve' });
    stub(approver, () => [{ id: 1 }]);
    expect((await ROUTES.social.posts.PATCH(req('/api/social/posts', await cookieFor(approver), 'PATCH', { id: 1, action: 'approve' }), E)).status).toBe(200);
  });

  it('the owner saves a level per tab and dashboards follow it', async () => {
    const owner: A.Profile = { id: '11111111-1111-1111-1111-111111111111', email: 'leen@example.com', active: true };
    const target = '33333333-3333-3333-3333-333333333333';
    const calls = stub(owner, url => (url.includes(`profiles?id=eq.${target}`) ? [{ id: target, email: 't@example.com' }] : []));
    const r = await users.PATCH!(req('/api/admin/users', await cookieFor(owner), 'PATCH', { id: target, access: { social: 'approve', content: 'view', nope: 'edit', ceo: 'admin' } }), E);
    expect(r.status).toBe(200);
    const saved = calls.find(c => c.body && (c.body as { access?: unknown }).access)?.body;
    expect(saved).toEqual({ access: { social: 'approve', content: 'view' }, dashboards: ['social', 'content'] });
  });
});
