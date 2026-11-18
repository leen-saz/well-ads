// Review fixes: actions that change ad-platform keys, approve posts or re-run paid AI need the APPROVE level, not just edit.
// Synthetic data, no network: the fake database answers only the profile, so anything that reached a table would show as a call.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { api } from '../../src/api/index';
import { WELL_COMPANY } from '../../src/lib/tenant';

const E: A.AuthEnv = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'service', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'boss@example.com' };
const cfg = A.env(E);
const member = (key: string, level: string): A.Profile => ({ id: '33333333-3333-4333-8333-333333333333', email: `${level}@example.com`, role: 'member', active: true, company_id: WELL_COMPANY, access: { [key]: level } });
afterEach(() => { vi.unstubAllGlobals(); });

async function call(p: A.Profile, path: string, method: string, body: unknown) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (u: string) => { calls.push(String(u)); return new Response(JSON.stringify(String(u).includes('/profiles?id=eq.') ? [p] : [])); }));
  const cookie = `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(p, cfg), cfg.secret))}`;
  const res = await api.request(`https://well.example${path}`, { method, headers: { cookie, origin: 'https://well.example', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body: JSON.stringify(body) }, E);
  return { status: res.status, calls, body: await res.json().catch(() => ({})) as Record<string, unknown> };
}
const touchedData = (calls: string[]) => calls.filter(u => !u.includes('/profiles?id=eq.'));

describe('ad platform keys: saving or disconnecting is an approval', () => {
  it('an editor cannot replace or wipe keys; the database is never touched', async () => {
    for (const [path, body] of [['/api/connectors/save', { platform: 'meta', values: { META_AD_ACCOUNT_ID: '1' } }], ['/api/connectors/disconnect', { platform: 'meta' }]] as const) {
      const r = await call(member('connectors', 'edit'), path, 'POST', body);
      expect(r.status, path).toBe(403);
      expect(touchedData(r.calls), path).toEqual([]);
    }
  });
  it('an approver passes the permission check', async () => {
    const r = await call(member('connectors', 'approve'), '/api/connectors/save', 'POST', { platform: 'nope', values: {} });
    expect(r.status).toBe(400);   // past the permission check, refused for the unknown platform
  });
});

describe('social: being named as an approver is not enough without the approve level', () => {
  it('an editor cannot approve or retry a post, even when the approvers list names them', async () => {
    const p = member('social', 'edit');
    for (const action of ['approve', 'retry']) {
      const r = await call(p, '/api/social/posts', 'PATCH', { id: 1, action });
      expect(r.status, action).toBe(403);
      expect(touchedData(r.calls).some(u => u.includes('social_posts')), action).toBe(false);
    }
  });
  it('cancelling stays an edit action', async () => {
    const r = await call(member('social', 'edit'), '/api/social/posts', 'PATCH', { id: 1, action: 'cancel' });
    expect(r.status).not.toBe(403);
  });
});

describe('campaigns: answering a question re-runs paid tasks, so it is for who may approve', () => {
  it('an editor who can see the campaign cannot answer; nothing is read or written', async () => {
    const r = await call(member('maestro', 'edit'), '/api/campaigns/answer', 'POST', { id: '44444444-4444-4444-8444-444444444444', index: 0, answer: 'نعم' });
    expect(r.status).toBe(403);
    expect(touchedData(r.calls)).toEqual([]);
  });
});
