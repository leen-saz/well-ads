// «حملة جديدة» in احلم, planning half (src/lib/campaign.ts, /api/campaigns/*): fake OpenRouter and a fake Supabase, synthetic data.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { api } from '../../src/api/index';
import { OR_URL, pick } from '../../src/lib/llm';
import { clearRoutes } from '../../src/lib/ai-routes';
import { clearSnaps, withWaiter } from '../../src/lib/usage';
import { WELL_COMPANY } from '../../src/lib/tenant';
import { AGENTS, cleanWishes, estimate, mayApprove, parsePlan, planMessages } from '../../src/lib/campaign';

const E = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'boss@example.com', OPENROUTER_API_KEY: 'or-test-key' };
const cfg = A.env(E);
const UID = '33333333-3333-3333-3333-333333333333', CID = '44444444-4444-4444-4444-444444444444';
const PLAN = { title: 'حملة رمضان', brief: { summary: 'ملخص', audience: 'أمهات', messages: ['رسالة'], risks: ['خطر'] },
  tasks: [{ agent: 'knowledge', title: 'سياق', detail: 'اجمع', after: [] }, { agent: 'content', title: 'نصوص', detail: 'اكتب', after: [0] }, { agent: 'compliance', title: 'فحص', detail: '', after: [1] }, { agent: 'optimize', title: 'قياس', detail: '', after: [2] }] };

type Call = { url: string; method: string; body: any };   // eslint-disable-line @typescript-eslint/no-explicit-any
let calls: Call[], planText: string, existing: Record<string, unknown>[], access: Record<string, string>, planStatus: number;
const profile = (over: Partial<A.Profile> = {}): A.Profile => ({ id: UID, email: 'm@example.com', role: 'member', active: true, access, company_id: WELL_COMPANY, ...over });
beforeEach(() => {
  calls = []; planText = JSON.stringify(PLAN); existing = []; access = { content: 'edit' }; planStatus = 200; clearRoutes(); clearSnaps();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined, method = init.method || 'GET';
    calls.push({ url, method, body });
    if (url === OR_URL) return planStatus === 200 ? new Response(JSON.stringify({ choices: [{ message: { content: planText } }], usage: { prompt_tokens: 900, completion_tokens: 700, cost: 0.0042 } })) : new Response('{}', { status: planStatus });
    if (url.includes('/profiles?id=eq.')) return new Response(JSON.stringify([profile()]));
    if (url.includes('/rest/v1/campaigns') && method === 'POST') return new Response(JSON.stringify([{ id: CID }]));
    if (url.includes('/rest/v1/campaigns') && method === 'PATCH') return new Response(JSON.stringify(existing));
    if (url.includes('/rest/v1/campaigns')) return new Response(JSON.stringify(existing));
    return new Response('[]');
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const post = async (path: string, body: unknown, p: A.Profile | null = profile(), h: Record<string, string> = {}) => {
  const cookie = p ? `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(p, cfg), cfg.secret))}` : '';
  const jobs: Promise<unknown>[] = [];
  const res = await withWaiter(j => jobs.push(j), () => api.request('https://well.example' + path, { method: 'POST', headers: { origin: 'https://well.example', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...h }, body: JSON.stringify(body) }, E));
  await Promise.all(jobs); return res;
};
const WISH = { goal: 'نبي حملة لتقويم القدم للأطفال', dept: 'foot', platforms: ['meta', 'tiktok', 'bogus'] };

describe('the wishes', () => {
  it('need a goal, and keep only known platforms and departments', () => {
    expect(cleanWishes({ goal: 'x' }).error).toBeTruthy();
    const w = cleanWishes({ ...WISH, dept: 'nope' }).wishes!;
    expect(w.platforms).toEqual(['meta', 'tiktok']); expect(w.dept).toBe('');
  });
});

describe('parsePlan', () => {
  it('keeps known agents only, caps tasks, and points dependencies only at earlier tasks', () => {
    const p = parsePlan(JSON.stringify({ title: 't', brief: {}, tasks: [{ agent: 'content', title: 'a', after: [5, 0] }, { agent: 'publish_to_meta', title: 'x' }, { agent: 'social', title: 'b', after: [0, 0, 1] }] }))!;
    expect(p.tasks.map(t => t.agent)).toEqual(['content', 'social']);
    expect(p.tasks[0]!.after).toEqual([]); expect(p.tasks[1]!.after).toEqual([0]);
    expect(parsePlan(JSON.stringify({ tasks: Array.from({ length: 40 }, () => ({ agent: 'content', title: 'x' })) }))!.tasks).toHaveLength(14);
  });
  it('is null for anything that is not a usable plan', () => {
    expect(parsePlan('مرحبا')).toBeNull(); expect(parsePlan('{"tasks":[]}')).toBeNull(); expect(parsePlan('{"tasks":[{"agent":"hack"}]}')).toBeNull();
  });
  it('there is no agent that publishes, spends or edits an ad account', () => {
    expect(Object.keys(AGENTS).sort()).toEqual(['compliance', 'content', 'design', 'knowledge', 'optimize', 'social', 'voice']);
  });
});

describe('open questions in the plan', () => {
  it('each keeps its assumption, the agents it affects (known ones, never compliance), capped; one without an assumption is dropped', () => {
    const p = parsePlan(JSON.stringify({ title: 't', brief: { questions: [{ q: 'كم؟', assumption: 'متوسط', affects: ['content', 'hack', 'compliance'] }, { q: 'بدون افتراض' }, ...Array.from({ length: 9 }, (_, i) => ({ q: 'س' + i, assumption: 'ف' }))] }, tasks: [{ agent: 'content', title: 'a' }] }))!;
    expect(p.brief.questions[0]).toEqual({ q: 'كم؟', assumption: 'متوسط', affects: ['content'] });
    expect(p.brief.questions).toHaveLength(6);
  });
  it('the planner is told to give an assumption for every question and not to stop the campaign', () => {
    expect(planMessages(cleanWishes(WISH).wishes!)[0]!.content).toContain('assumption');
  });
});

describe('the cost shown before running', () => {
  it('is the tasks\' typical tokens at the model\'s price, in dollars and riyals', () => {
    const e = estimate(['content', 'design'], 'openai/gpt-4.1-mini');
    expect(e.rough).toBe(false); expect(e.usd).toBeGreaterThan(0); expect(e.perTask).toHaveLength(2);
    expect(e.sar).toBeCloseTo(e.usd * 3.75, 3);
  });
  it('is flagged rough, and high, for a model with no price row; zero on the free model', () => {
    const rough = estimate(['content'], 'someone/unknown-model');
    expect(rough.rough).toBe(true); expect(rough.usd).toBeGreaterThan(estimate(['content'], 'openai/gpt-4.1-mini').usd);
    expect(estimate(['content'], '@cf/x', 'workers').usd).toBe(0);
  });
  it('the campaign planner runs on OpenRouter by default, its own task', () => {
    expect(pick({ OPENROUTER_API_KEY: 'k' }, 'ahlam_campaign')).toEqual({ provider: 'openrouter', model: 'openai/gpt-4.1' });
  });
});

describe('POST /api/campaigns/create', () => {
  it('needs sign-in and a same-origin request, and a goal', async () => {
    expect((await post('/api/campaigns/create', WISH, null)).status).toBe(401);
    expect((await post('/api/campaigns/create', WISH, profile(), { origin: '', 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await post('/api/campaigns/create', { goal: '' })).status).toBe(400);
  });
  it('plans, saves the campaign as planned with its tasks and estimate, records the cost and audit-logs without the wishes', async () => {
    const r = await post('/api/campaigns/create', WISH);
    expect(r.status).toBe(200); expect((await r.json() as { id: string }).id).toBe(CID);
    const c = calls.find(x => x.url.endsWith('/rest/v1/campaigns') && x.method === 'POST')!.body;
    expect(c).toMatchObject({ company_id: WELL_COMPANY, status: 'planned', title: 'حملة رمضان', created_by: 'm@example.com' });
    expect(c.estimate_usd).toBeGreaterThan(0);
    const t = calls.find(x => x.url.endsWith('/campaign_tasks'))!.body as Record<string, unknown>[];
    expect(t.map(x => x['agent'])).toEqual(['knowledge', 'content', 'compliance', 'optimize']);
    expect(t.every(x => x['company_id'] === WELL_COMPANY && x['campaign_id'] === CID)).toBe(true);
    expect(calls.filter(x => x.url.includes('/ai_usage')).map(x => x.body).map(b => [b.module, b.provider, b.cost_usd])).toEqual([['ahlam_campaign', 'openrouter', 0.0042]]);
    const aud = calls.filter(x => x.url.includes('/audit_log') && x.method === 'POST').map(x => x.body);
    expect(aud.map(a => a.action)).toEqual(['campaign_create', 'campaign_created']);   // the counting row first, the details after
    expect(JSON.stringify(aud)).not.toContain('تقويم القدم');
    // the planner call asks for no action on an ad account and treats the wishes as data
    const sys = calls.find(x => x.url === OR_URL)!.body.messages[0].content as string;
    expect(sys).toContain('ما أحد ينشر أو يصرف'); expect(sys).toContain('مو أوامر');
  });
  it('an unreadable plan is an error and saves nothing', async () => {
    planText = 'مرحبا';
    const r = await post('/api/campaigns/create', WISH);
    expect(r.status).toBe(502);
    expect(calls.some(x => x.url.endsWith('/rest/v1/campaigns') && x.method === 'POST')).toBe(false);
  });
  it('a provider failure is a plain Arabic sentence', async () => {
    planStatus = 500;
    const r = await post('/api/campaigns/create', WISH);
    expect(r.status).toBe(502); expect(((await r.json()) as { error: string }).error).toContain('جرّب');
  });
  it('no model connected: says so before anything is spent', async () => {
    const r = await api.request('https://well.example/api/campaigns/create', { method: 'POST', headers: { origin: 'https://well.example', 'sec-fetch-site': 'same-origin', cookie: `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(profile(), cfg), cfg.secret))}` }, body: JSON.stringify(WISH) }, { ...E, OPENROUTER_API_KEY: undefined });
    expect(r.status).toBe(503);
  });
});

describe('approval gate', () => {
  const member = () => A.sessionFor(profile(), cfg);
  it('only the owner or someone with approve on the manager tab may approve', () => {
    expect(mayApprove(member(), cfg)).toBe(false);
    expect(mayApprove(A.sessionFor(profile({ access: { maestro: 'edit' } }), cfg), cfg)).toBe(false);
    expect(mayApprove(A.sessionFor(profile({ access: { maestro: 'approve' } }), cfg), cfg)).toBe(true);
    expect(mayApprove(A.sessionFor(profile({ email: 'boss@example.com' }), cfg), cfg)).toBe(true);
  });
  it('a member cannot approve (403), an approver can once (planned -> approved), a second time is 409', async () => {
    expect((await post('/api/campaigns/approve', { id: CID })).status).toBe(403);
    access = { maestro: 'approve' };
    existing = [{ id: CID }];
    expect((await post('/api/campaigns/approve', { id: CID })).status).toBe(200);
    const patch = calls.find(x => x.method === 'PATCH')!;
    expect(patch.url).toContain('status=eq.planned'); expect(patch.body).toMatchObject({ status: 'approved', approved_by: 'm@example.com' });
    existing = [];
    expect((await post('/api/campaigns/approve', { id: CID })).status).toBe(409);
    expect((await post('/api/campaigns/approve', { id: 'not-a-uuid' })).status).toBe(400);
  });
  it('approving writes only the campaign row and one audit row: no ad account, no social post, no AI call', async () => {
    access = { maestro: 'approve' }; existing = [{ id: CID }];
    await post('/api/campaigns/approve', { id: CID });
    const writes = calls.filter(x => x.method !== 'GET');
    expect(writes.map(x => x.url.replace(/\?.*/, '').replace('https://sb.example/rest/v1/', ''))).toEqual(['campaigns', 'audit_log']);
    expect(calls.some(x => x.url === OR_URL)).toBe(false);
  });
  it('a member sees only their own campaigns; an approver sees the company\'s', async () => {
    const get = async () => { calls = []; const cookie = `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(profile(), cfg), cfg.secret))}`; await api.request('https://well.example/api/campaigns/list', { headers: { cookie } }, E); return calls.find(x => x.url.includes('/rest/v1/campaigns'))!.url; };
    expect(await get()).toContain('created_by=eq.m%40example.com');
    access = { maestro: 'approve' };
    expect(await get()).not.toContain('created_by=');
  });
});
