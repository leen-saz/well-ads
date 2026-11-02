// Learning loop per tab (L1): a tab's lessons are read with its view level, decided with its approve level,
// and always scoped to the user's company.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { list } from '../../src/api/routes/lessons';
import { needOf, decision } from '../../src/lib/lessons';
import { need } from '../../src/lib/gate';
import { WELL_COMPANY } from '../../src/lib/tenant';

const E: A.AuthEnv = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'leen@example.com' };
const cfg = A.env(E);
const member = (access: Record<string, string>): A.Profile => ({ id: '22222222-2222-2222-2222-222222222222', email: 'm@example.com', role: 'member', active: true, access });
const cookieFor = async (p: A.Profile) => `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(p, cfg), cfg.secret))}`;
const req = (path: string, cookie: string, method = 'GET', body?: unknown) => new Request('https://well.example' + path,
  { method, headers: { cookie, origin: 'https://well.example', 'sec-fetch-site': 'same-origin' }, ...(body ? { body: JSON.stringify(body) } : {}) });
const stub = (p: A.Profile, rest: (url: string, init: RequestInit) => unknown = () => []) => {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(url.includes('/profiles?id=eq.' + p.id) ? [p] : rest(url, init)));
  }));
  return calls;
};
afterEach(() => { vi.unstubAllGlobals(); });

describe('lessons helpers', () => {
  it('ads lessons belong to the decision board; unknown tabs are refused', () => {
    expect(needOf('ads')).toBe('control');
    expect(needOf('social')).toBe('social');
    expect(needOf('nope')).toBeNull();
    expect(decision('approve')).toBe('approved');
    expect(decision('ignore')).toBe('ignored');
    expect(decision('delete')).toBeNull();
    expect(need('/api/lessons/list', '')).toBe('any');
  });
});

describe('/api/lessons/list', () => {
  it('reads one tab of the user\'s company, with whether they may decide', async () => {
    const viewer = member({ social: 'view' });
    const calls = stub(viewer, () => [{ id: 1, lesson: 'الساعة 9 مساء تفاعلها أعلى', status: 'new' }]);
    const r = await list.GET(req('/api/lessons/list?module=social', await cookieFor(viewer)), E);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ lessons: [{ id: 1, lesson: 'الساعة 9 مساء تفاعلها أعلى', status: 'new' }], canDecide: false });
    const q = calls.find(c => c.url.includes('/rest/v1/lessons'))!.url;
    expect(q).toContain('module=eq.social');
    expect(q).toContain(`company_id=eq.${WELL_COMPANY}`);
  });

  it('no access to the tab, or an unknown tab: refused before the table is read', async () => {
    const viewer = member({ social: 'view' });
    const calls = stub(viewer);
    expect((await list.GET(req('/api/lessons/list?module=design', await cookieFor(viewer)), E)).status).toBe(403);
    expect((await list.GET(req('/api/lessons/list?module=x;drop', await cookieFor(viewer)), E)).status).toBe(400);
    expect(calls.some(c => c.url.includes('/rest/v1/lessons'))).toBe(false);
  });

  it('deciding needs the tab\'s approve level, and only touches an undecided lesson of this company', async () => {
    const editor = member({ social: 'edit' });
    stub(editor, () => [{ id: 4 }]);
    expect((await list.PATCH(req('/api/lessons/list', await cookieFor(editor), 'PATCH', { module: 'social', id: 4, action: 'approve' }), E)).status).toBe(403);

    const approver = member({ social: 'approve' });
    const calls = stub(approver, () => [{ id: 4, status: 'approved' }]);
    const r = await list.PATCH(req('/api/lessons/list', await cookieFor(approver), 'PATCH', { module: 'social', id: 4, action: 'approve' }), E);
    expect(r.status).toBe(200);
    const p = calls.find(c => c.method === 'PATCH' && c.url.includes('/rest/v1/lessons'))!;
    expect(p.url).toContain('status=in.(new,reviewed)');
    expect(p.url).toContain(`company_id=eq.${WELL_COMPANY}`);
    expect(p.body).toMatchObject({ status: 'approved', decided_by: 'm@example.com' });
  });

  it('a lesson already decided is a 409', async () => {
    const approver = member({ social: 'approve' });
    stub(approver, () => []);
    expect((await list.PATCH(req('/api/lessons/list', await cookieFor(approver), 'PATCH', { module: 'social', id: 4, action: 'ignore' }), E)).status).toBe(409);
  });
});
