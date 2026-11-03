// Social: validation, due rule, publishing to Facebook/Instagram with a stubbed Graph API, and company scoping.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validate, due, publishPost, canApprove, cleanApprovers } from './social';
import { runSocial } from './cron';
import { WELL_COMPANY } from '../../lib/tenant';

const NOW = Date.parse('2026-11-01T12:00:00Z');
const later = '2026-11-02T09:00:00Z';
afterEach(() => { vi.unstubAllGlobals(); });

describe('validate', () => {
  it('accepts a good post, keeps the Riyadh time as ISO, and never takes auto mode', () => {
    const v = validate({ platforms: ['facebook', 'facebook', 'nope'], body: 'جلسة تغذية وريدية', publish_at: later, mode: 'auto' }, NOW);
    expect(v.draft).toEqual({ platforms: ['facebook'], body: 'جلسة تغذية وريدية', media: [], publish_at: '2026-11-02T09:00:00.000Z', mode: 'manual' });
  });
  it('refuses past times, empty posts, over-long text and Instagram without media', () => {
    expect(validate({ platforms: ['facebook'], body: 'x', publish_at: '2026-10-01T00:00:00Z' }, NOW).error).toBe('وقت النشر راح');
    expect(validate({ platforms: ['facebook'], publish_at: later }, NOW).error).toBeTruthy();
    expect(validate({ platforms: ['x'], body: 'ا'.repeat(281), publish_at: later }, NOW).error).toContain('X');
    expect(validate({ platforms: ['instagram'], body: 'x', publish_at: later }, NOW).error).toContain('انستقرام');
  });
  it('warns on MOH claims precisely without blocking, and defaults to manual', () => {
    const v = validate({ platforms: ['facebook'], body: 'علاج نهائي ومضمون', publish_at: later }, NOW);
    expect(v.draft?.mode).toBe('manual');
    expect(v.notices.length).toBe(2);
    expect(v.notices.join(' ')).toContain('«علاج نهائي»');
    expect(v.notices.join(' ')).toContain('«مضمون»');
    // a notice, not a block: the post is still saved (it waits for its approver, #79)
    expect(validate({ platforms: ['facebook'], body: 'الأفضل في الرياض', publish_at: later }, NOW).draft).toBeDefined();
  });
});

describe('due', () => {
  it('every post waits for approval, and goes at its time', () => {
    const base = { status: 'scheduled', publish_at: '2026-11-01T11:59:00Z' };
    expect(due(base, [], NOW)).toBe(false);
    expect(due({ ...base, approved_at: '2026-11-01T10:00:00Z', approved_by: 'leen@x.co' }, [], NOW)).toBe(true);
    expect(due({ ...base, approved_at: '2026-11-01T10:00:00Z', publish_at: later }, [], NOW)).toBe(false);
  });
  it('with named approvers, only their approval publishes (a removed approver does not)', () => {
    const ok = { status: 'scheduled', publish_at: '2026-11-01T11:59:00Z', approved_at: '2026-11-01T10:00:00Z' };
    expect(due({ ...ok, approved_by: 'Sara@x.co' }, ['sara@x.co'], NOW)).toBe(true);
    expect(due({ ...ok, approved_by: 'fahad@x.co' }, ['sara@x.co'], NOW)).toBe(false);
  });
});

describe('approvers', () => {
  it('named approvers only; none named = the owner only', () => {
    expect(canApprove('Sara@x.co', ['sara@x.co'], false)).toBe(true);
    expect(canApprove('leen@x.co', ['sara@x.co'], true)).toBe(false);
    expect(canApprove('leen@x.co', [], true)).toBe(true);
    expect(canApprove('sara@x.co', [], false)).toBe(false);
  });
  it('cleans the list: emails only, lower case, no repeats', () => {
    expect(cleanApprovers([' Sara@X.co ', 'sara@x.co', 'nope', 3])).toEqual(['sara@x.co']);
    expect(cleanApprovers('x')).toEqual([]);
  });
});

describe('publish', () => {
  it('posts to the page feed and runs Instagram container + publish', async () => {
    const calls: string[] = [];
    const f = vi.fn(async (url: string) => { calls.push(url); return new Response(JSON.stringify({ id: String(calls.length) })); }) as unknown as typeof fetch;
    const t = { META_PAGE_ACCESS_TOKEN: 'tok', META_PAGE_ID: 'p1', IG_USER_ID: 'ig1' };
    const out = await publishPost({ platforms: ['facebook', 'instagram'], body: 'hi', media: [{ url: 'https://x/a.jpg', type: 'image' }], publish_at: later, mode: 'manual' }, t, f);
    expect(out.status).toBe('published');
    expect(calls).toEqual(['https://graph.facebook.com/v23.0/p1/photos', 'https://graph.facebook.com/v23.0/ig1/media', 'https://graph.facebook.com/v23.0/ig1/media_publish']);
  });
  it('partial when one platform is not connected or not live yet', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ id: '1' }))) as unknown as typeof fetch;
    const out = await publishPost({ platforms: ['facebook', 'x'], body: 'hi', media: [], publish_at: later, mode: 'manual' }, { META_PAGE_ACCESS_TOKEN: 't', META_PAGE_ID: 'p' }, f);
    expect(out.status).toBe('partial');
    expect(out.results.x?.ok).toBe(false);
  });
});

describe('runSocial', () => {
  it('claims each due post once and never uses Well tokens for another company', async () => {
    const OTHER = '22222222-2222-2222-2222-222222222222';
    const posts = [
      { id: 1, company_id: WELL_COMPANY, platforms: ['facebook'], body: 'a', media: [], publish_at: '2026-11-01T11:00:00Z', mode: 'manual', status: 'scheduled', approved_at: '2026-11-01T10:00:00Z', approved_by: 'sara@x.co', company: { social_approvers: ['sara@x.co'] } },
      { id: 2, company_id: OTHER, platforms: ['facebook'], body: 'b', media: [], publish_at: '2026-11-01T11:00:00Z', mode: 'manual', status: 'scheduled', approved_at: '2026-11-01T10:00:00Z', approved_by: 'boss@other.co', company: { social_approvers: [] } },
      { id: 3, company_id: WELL_COMPANY, platforms: ['facebook'], body: 'c', media: [], publish_at: '2026-11-01T11:00:00Z', mode: 'manual', status: 'scheduled' },
      { id: 4, company_id: WELL_COMPANY, platforms: ['facebook'], body: 'd', media: [], publish_at: '2026-11-01T11:00:00Z', mode: 'manual', status: 'scheduled', approved_at: '2026-11-01T10:00:00Z', approved_by: 'fahad@x.co', company: { social_approvers: ['sara@x.co'] } },
    ];
    const saved: Record<number, { status: string }> = {};
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url.includes('/rpc/connector_env')) return new Response(JSON.stringify([{ name: 'META_PAGE_ACCESS_TOKEN', value: 't' }, { name: 'META_PAGE_ID', value: 'p' }]));
      if (url.includes('social_posts?select=')) return new Response(JSON.stringify(posts));
      const id = Number(url.match(/id=eq\.(\d+)/)?.[1]);
      if (url.includes('status=eq.scheduled')) return new Response(JSON.stringify([{ id }])); // claim
      if (init.method === 'PATCH') { saved[id] = JSON.parse(String(init.body)); return new Response('[]'); }
      return new Response('{}');
    }));
    const graph = vi.fn(async () => new Response(JSON.stringify({ id: 'g' }))) as unknown as typeof fetch;
    const n = await runSocial({ SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'l@x' }, NOW, graph);
    expect(n).toBe(2);                         // 3 is not approved, 4 was approved by someone who is not the approver
    expect(saved[1]?.status).toBe('published');
    expect(saved[2]?.status).toBe('failed');   // other company: no Well tokens
    expect(graph).toHaveBeenCalledTimes(1);
  });
});

describe('PATCH /api/social/posts approve', () => {
  const SECRET = 's'.repeat(32);
  const ENV = { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x', SESSION_SECRET: SECRET, OWNER_EMAIL: 'leen@x.co' };
  async function approve(email: string, role: string, approvers: string[]) {
    const { api } = await import('../../api/index');
    const { sign, SESSION } = await import('../../lib/auth');
    const p = { id: 'u1', email, role, dashboards: ['social'], access: { social: 'approve' }, departments: [], company_id: WELL_COMPANY, active: true };
    const patched: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url.includes('/rest/v1/profiles')) return new Response(JSON.stringify([p]));
      if (url.includes('/rest/v1/companies')) return new Response(JSON.stringify([{ social_approvers: approvers }]));
      if (url.includes('/rest/v1/social_posts') && init.method === 'PATCH') { patched.push(url); return new Response(JSON.stringify([{ id: 7 }])); }
      return new Response('null');
    }));
    const now = Date.now();
    const token = await sign({ uid: p.id, email, name: '', role, dash: ['social'], lvl: { social: 'approve' }, depts: [], co: WELL_COMPANY, exp: now + 3600e3, chk: now }, SECRET);
    const res = await api.request('https://well.test/api/social/posts', { method: 'PATCH', headers: { cookie: `${SESSION}=${token}`, origin: 'https://well.test', 'content-type': 'application/json' }, body: JSON.stringify({ id: 7, action: 'approve' }) }, ENV);
    return { status: res.status, patched };
  }
  it('approve level is not enough: only the named approver', async () => {
    expect((await approve('fahad@x.co', 'member', ['sara@x.co'])).status).toBe(403);
    const ok = await approve('sara@x.co', 'member', ['sara@x.co']);
    expect(ok.status).toBe(200);
    expect(ok.patched.length).toBe(1);
  });
  it('nobody named: the owner approves, a member with approve level does not', async () => {
    expect((await approve('fahad@x.co', 'member', [])).status).toBe(403);
    expect((await approve('leen@x.co', 'owner', [])).status).toBe(200);
  });
});

describe('readiness before scheduling', () => {
  it('says which live platform has no connected account', async () => {
    const { readiness } = await import('./social');
    expect(readiness('instagram', { META_PAGE_ACCESS_TOKEN: 't', META_PAGE_ID: '1' })).toContain('انستقرام مو مربوط');
    expect(readiness('instagram', { META_PAGE_ACCESS_TOKEN: 't', IG_USER_ID: '2' })).toBe('');
    expect(readiness('facebook', {})).toContain('فيسبوك مو مربوطة');
    expect(readiness('tiktok', {})).toContain('قريباً');
  });
});
