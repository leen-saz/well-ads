// The approvals center (src/lib/approvals.ts, docs/PRD.md §3.1, milestone M3): each user sees and counts only what they
// may approve; a table that is not created yet counts as nothing; another company never sees Well's ad actions.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { WELL_COMPANY } from '../../src/lib/tenant';
import { collect, rights } from '../../src/lib/approvals';

const E: A.AuthEnv = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'owner@example.com' };
const cfg = A.env(E);
const OTHER = '22222222-2222-2222-2222-222222222222';
const who = (access: Record<string, string>, extra: Partial<A.Profile> = {}) =>
  A.sessionFor({ id: '3', email: 'm@example.com', role: 'member', active: true, access, company_id: WELL_COMPANY, ...extra } as A.Profile, cfg);
const owner = A.sessionFor({ id: '1', email: 'owner@example.com', role: 'owner', active: true, company_id: WELL_COMPANY } as A.Profile, cfg);

type Seen = string[];
function fake(tables: Record<string, unknown[] | 'missing'>, approvers: string[] = [], seen: Seen = []) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url); seen.push(u);
    if (u.includes('/companies?')) return new Response(JSON.stringify([{ social_approvers: approvers }]));
    const t = Object.keys(tables).find(k => u.includes(`/rest/v1/${k}?`));
    const v = t ? tables[t] : [];
    if (v === 'missing') return new Response(JSON.stringify({ code: '42P01', message: 'relation does not exist' }), { status: 404 });
    return new Response(JSON.stringify(v));
  }));
}
afterEach(() => vi.unstubAllGlobals());

const POST = { id: 7, body: 'منشور تجريبي', platforms: ['facebook', 'x'], publish_at: '2026-11-21T10:00:00Z', created_by: 'a@example.com' };
const ACT = { id: 'u1', platform: 'meta', level: 'campaign', entity_name: 'حملة تجربة', kind: 'budget', reason: 'السبب', mode: 'auto', change: { from: 100, to: 120 }, created_at: '2026-11-20T08:00:00Z' };
const LESSON = { id: 3, module: 'ads', lesson: 'درس', confidence: 'high', created_at: '2026-11-19T08:00:00Z' };

describe('rights', () => {
  it('owner may approve everything; social only when no named approver or named', () => {
    const r = rights(owner, cfg, []);
    expect(r.social).toBe(true); expect(r.ads).toBe(true); expect(r.lessonModules).toContain('ads');
    expect(rights(owner, cfg, ['someone@example.com']).social).toBe(false);
  });
  it('view or edit only: nothing', () => {
    const r = rights(who({ social: 'edit', control: 'view' }), cfg, []);
    expect(r).toEqual({ social: false, ads: false, lessonModules: [] });
  });
  it('a named social approver with approve on social', () => {
    expect(rights(who({ social: 'approve' }), cfg, ['m@example.com']).social).toBe(true);
    expect(rights(who({ social: 'approve' }), cfg, []).social).toBe(false);   // no named approvers = the owner only
  });
  it('ad actions are Well only', () => {
    expect(rights(who({ control: 'approve' }), cfg, []).ads).toBe(true);
    expect(rights(who({ control: 'approve' }, { company_id: OTHER }), cfg, []).ads).toBe(false);
  });
});

describe('collect', () => {
  it('lists and counts each kind for the owner, scoped to the company', async () => {
    const seen: Seen = [];
    fake({ social_posts: [POST], buyer_actions: [ACT], lessons: [LESSON] }, [], seen);
    const r = await collect(cfg, owner);
    expect(r.counts).toEqual({ social: 1, ads: 1, lessons: 1, total: 3 });
    expect(r.items.map(i => i.kind)).toEqual(['social', 'ads', 'lessons']);
    expect(r.items[1]!.money).toBe(true);
    expect(r.items[0]!.detail).toBe('فيسبوك، X');
    for (const u of seen.filter(x => !x.includes('/companies?'))) expect(u).toContain(`company_id=eq.${WELL_COMPANY}`);
    expect(seen.find(u => u.includes('social_posts'))).toContain('approved_at=is.null');
    expect(seen.find(u => u.includes('buyer_actions'))).toContain('status=eq.proposed');
  });
  it('a user with no approve right makes no query and counts zero', async () => {
    const seen: Seen = [];
    fake({ social_posts: [POST], buyer_actions: [ACT], lessons: [LESSON] }, [], seen);
    const r = await collect(cfg, who({ social: 'view', control: 'edit' }));
    expect(r.counts.total).toBe(0);
    expect(seen.filter(u => !u.includes('/companies?'))).toEqual([]);
  });
  it('a table not created yet is nothing waiting, not an error', async () => {
    fake({ social_posts: [POST], buyer_actions: 'missing', lessons: [] });
    const r = await collect(cfg, owner);
    expect(r.counts).toEqual({ social: 1, ads: 0, lessons: 0, total: 1 });
  });
  it('another company sees no ad actions, even with approve on the board', async () => {
    const seen: Seen = [];
    fake({ buyer_actions: [ACT] }, [], seen);
    const r = await collect(cfg, who({ control: 'approve' }, { company_id: OTHER }));
    expect(r.counts.ads).toBe(0);
    expect(seen.some(u => u.includes('buyer_actions'))).toBe(false);
  });
});
