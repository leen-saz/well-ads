// «حملة جديدة» in احلم, the running half (src/lib/campaign-run.ts, /api/campaigns/step|review|retry): fake OpenRouter, fake Supabase, synthetic data.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { api } from '../../src/api/index';
import { OR_URL } from '../../src/lib/llm';
import { clearRoutes } from '../../src/lib/ai-routes';
import { clearSnaps, withWaiter } from '../../src/lib/usage';
import { WELL_COMPANY } from '../../src/lib/tenant';
import { companyRules } from '../../src/modules/compliance/compliance';
import { affectedTasks, kpis, packMarkdown, parsePosts, readyTask, rollup, socialTargets, verdict, type TaskRow } from '../../src/lib/campaign-run';

const E = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'boss@example.com', OPENROUTER_API_KEY: 'or-test-key' };
const cfg = A.env(E);
const UID = '33333333-3333-3333-3333-333333333333', CID = '44444444-4444-4444-4444-444444444444';
const t = (position: number, agent: TaskRow['agent'], status: string, depends_on: number[] = [], id = position + 1): TaskRow => ({ id, position, agent, title: 'x', depends_on, status });

describe('which task runs next', () => {
  it('the first waiting task whose dependencies are finished (review or approved)', () => {
    expect(readyTask([t(0, 'knowledge', 'waiting'), t(1, 'content', 'waiting', [0])])!.position).toBe(0);
    expect(readyTask([t(0, 'knowledge', 'review'), t(1, 'content', 'waiting', [0])])!.position).toBe(1);
    expect(readyTask([t(0, 'knowledge', 'approved'), t(1, 'content', 'running', [0]), t(2, 'social', 'waiting', [1])])).toBeNull();
  });
  it('a blocked or failed dependency keeps its dependents waiting (the run stalls there)', () => {
    const ts = [t(0, 'content', 'blocked'), t(1, 'compliance', 'waiting', [0])];
    expect(readyTask(ts)).toBeNull(); expect(rollup(ts)).toEqual({ status: 'review', stalled: true });
  });
  it('the campaign is running while something can run, review when it waits for people, done when all approved', () => {
    expect(rollup([t(0, 'knowledge', 'review'), t(1, 'content', 'waiting', [0])]).status).toBe('running');
    expect(rollup([t(0, 'knowledge', 'review'), t(1, 'content', 'approved')]).status).toBe('review');
    expect(rollup([t(0, 'knowledge', 'approved'), t(1, 'content', 'approved')]).status).toBe('done');
  });
});

describe('compliance stops a draft', () => {
  it('a promise to cure is a critical hit: blocked with a reason', () => {
    const v = verdict([{ label: 'المحتوى', text: 'علاج مضمون 100% وبدون أي أضرار' }]);
    expect(v.blocked).toBe(true); expect(v.reason).toContain('المحتوى');
  });
  it('a plain, safe text is not blocked', () => { expect(verdict([{ label: 'x', text: 'احجز زيارة منزلية مع ممرضة مرخّصة.' }]).blocked).toBe(false); });
  it('the company\'s forbidden words stop it too', () => {
    expect(verdict([{ label: 'x', text: 'عرض لفترة محدودة' }], companyRules(['لفترة محدودة'])).blocked).toBe(true);
  });
});

describe('the social agent\'s posts', () => {
  it('keeps platforms Social can carry (and the wishes\' ones), caps length and count', () => {
    const p = parsePosts(JSON.stringify({ posts: [{ platform: 'x', body: 'ا'.repeat(500), day: 2 }, { platform: 'myspace', body: 'a' }, { platform: 'tiktok', body: 'b' }, { platform: 'facebook', body: '' }] }), ['x', 'facebook']);
    expect(p).toHaveLength(1); expect(p[0]!.body.length).toBe(280); expect(p[0]!.day).toBe(2);
    expect(parsePosts('مرحبا', [])).toEqual([]);
  });
  it('Meta in the wishes means the Facebook page and Instagram', () => { expect(socialTargets(['meta', 'x', 'bogus'])).toEqual(['facebook', 'instagram', 'x']); });
});

describe('the measurement plan and the pack', () => {
  it('uses the judge\'s funnel targets when given, the file\'s defaults otherwise, ignores nonsense', () => {
    expect(kpis(undefined).find(k => k.key === 'cpl')!.target).toBe(60);
    expect(kpis({ cpl: 45, roas: 'x', ctr: -1 }).filter(k => ['cpl', 'roas', 'ctr'].includes(k.key)).map(k => [k.key, k.target])).toEqual([['ctr', 1], ['cpl', 45], ['roas', 3]]);
  });
  it('the pack exports as Markdown with every task\'s output', () => {
    const md = packMarkdown({ title: 'حملة', brief: { summary: 'ملخص' }, status: 'review' }, [t(0, 'content', 'review')], [{ task_id: 1, kind: 'copy', body: { text: 'نص الحملة' } }]);
    expect(md).toContain('# حملة'); expect(md).toContain('نص الحملة');
  });
});

type Call = { url: string; method: string; body: any };   // eslint-disable-line @typescript-eslint/no-explicit-any
let calls: Call[], tasks: Record<string, unknown>[], outputs: Record<string, unknown>[], campaign: Record<string, unknown>, access: Record<string, string>, llm: (n: number) => string, llmN: number, claimable: boolean;
const profile = (): A.Profile => ({ id: UID, email: 'm@example.com', role: 'member', active: true, access, company_id: WELL_COMPANY });
const task = (position: number, agent: string, status: string, depends_on: number[] = [], extra: Record<string, unknown> = {}) => ({ id: position + 1, position, agent, title: 'مهمة ' + agent, spec: { detail: 'د' }, depends_on, status, blocked_reason: null, updated_at: new Date().toISOString(), ...extra });
beforeEach(() => {
  calls = []; llmN = 0; claimable = true; access = { maestro: 'approve' }; clearRoutes(); clearSnaps();
  campaign = { id: CID, title: 'حملة', status: 'approved', wishes: { goal: 'حملة للقدم', platforms: ['meta', 'x'] }, brief: { summary: 'ملخص' } };
  tasks = [task(0, 'knowledge', 'waiting'), task(1, 'content', 'waiting', [0]), task(2, 'social', 'waiting', [1]), task(3, 'compliance', 'waiting', [2]), task(4, 'optimize', 'waiting', [3])];
  outputs = []; llm = () => 'نص آمن عن الزيارة المنزلية.';
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined, method = init.method || 'GET';
    calls.push({ url, method, body });
    if (url === OR_URL) return new Response(JSON.stringify({ choices: [{ message: { content: llm(++llmN) } }], usage: { prompt_tokens: 100, completion_tokens: 100, cost: 0.001 } }));
    if (url.includes('/profiles?id=eq.')) return new Response(JSON.stringify([profile()]));
    if (url.endsWith('/rest/v1/campaign_tasks') && method === 'POST') { tasks = (body as Record<string, unknown>[]).map((b, i) => ({ id: i + 1, status: 'waiting', blocked_reason: null, updated_at: new Date().toISOString(), ...b })); return new Response('[]'); }
    if (url.includes('/rest/v1/campaign_tasks') && method === 'PATCH') return new Response(JSON.stringify(claimable ? [{ id: 1 }] : []));
    if (url.includes('/rest/v1/campaign_tasks')) return new Response(JSON.stringify(tasks));
    if (url.includes('/rest/v1/campaign_outputs') && method === 'GET') return new Response(JSON.stringify(outputs));
    if (url.includes('/rest/v1/campaigns') && method === 'GET') return new Response(JSON.stringify([campaign]));
    return new Response('[]');
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const post = async (path: string, body: unknown, p: A.Profile | null = profile()) => {
  const cookie = p ? `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(p, cfg), cfg.secret))}` : '';
  const jobs: Promise<unknown>[] = [];
  const res = await withWaiter(j => jobs.push(j), () => api.request('https://well.example' + path, { method: 'POST', headers: { origin: 'https://well.example', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }, E));
  await Promise.all(jobs); return res;
};
const step = async () => await (await post('/api/campaigns/step', { id: CID })).json() as { ran?: { agent: string; status: string; reason: string }; done?: boolean; stalled?: boolean; status?: string; busy?: boolean; more?: boolean };
const writes = () => calls.filter(x => x.method !== 'GET' && x.url !== OR_URL).map(x => x.url.replace(/\?.*/, '').replace('https://sb.example/rest/v1/', ''));

describe('POST /api/campaigns/step', () => {
  it('needs sign-in and a valid id; a campaign that is not approved does not run', async () => {
    expect((await post('/api/campaigns/step', { id: CID }, null)).status).toBe(401);
    expect((await post('/api/campaigns/step', { id: 'x' })).status).toBe(400);
    campaign['status'] = 'planned';
    expect((await post('/api/campaigns/step', { id: CID })).status).toBe(409);
    campaign['status'] = 'cancelled';
    expect((await post('/api/campaigns/step', { id: CID })).status).toBe(409);
    expect(calls.some(x => x.url === OR_URL)).toBe(false);
  });
  it('runs ONE task: claims it, one AI call under the campaign task key, saves the output and audit-logs without text', async () => {
    const j = await step();
    expect(j.ran).toMatchObject({ agent: 'knowledge', status: 'review' });
    expect(calls.filter(x => x.url === OR_URL)).toHaveLength(1);
    const claim = calls.find(x => x.method === 'PATCH' && x.url.includes('campaign_tasks') && x.body.status === 'running')!;
    expect(claim.url).toContain('status=eq.waiting');
    const out = calls.find(x => x.url.endsWith('/campaign_outputs') && x.method === 'POST')!.body as Record<string, unknown>[];
    expect(out[0]).toMatchObject({ kind: 'insight', campaign_id: CID, company_id: WELL_COMPANY });
    expect(calls.filter(x => x.url.includes('/ai_usage')).map(x => x.body.module)).toEqual(['ahlam_campaign']);
    const aud = calls.filter(x => x.url.includes('/audit_log') && x.method === 'POST').map(x => x.body);
    expect(aud.map(a => a.action)).toEqual(['campaign_task_run']);
    expect(JSON.stringify(aud)).not.toContain('نص آمن');
  });
  it('the first step moves the campaign from approved to running', async () => {
    await step();
    expect(calls.some(x => x.method === 'PATCH' && x.url.includes('/campaigns?') && x.body.status === 'running')).toBe(true);
  });
  it('a task already claimed by another run is not run twice', async () => {
    claimable = false;
    expect(await step()).toEqual({ busy: true }); expect(calls.some(x => x.url === OR_URL)).toBe(false);
  });
  it('a task whose dependency is not finished does not run; with nothing left the campaign goes to review', async () => {
    tasks = [task(0, 'content', 'blocked', [], { blocked_reason: 'سبب' }), task(1, 'compliance', 'waiting', [0])];
    expect(await step()).toEqual({ done: true, status: 'review', stalled: true });
    expect(calls.some(x => x.url === OR_URL)).toBe(false);
  });
  it('compliance STOPS a draft once the automatic rewrites are used: blocked with the reason, nothing goes to Social', async () => {
    tasks = [task(0, 'social', 'waiting', [], { spec: { auto: 2, feedback: 'ف' } })];
    llm = () => JSON.stringify({ posts: [{ platform: 'x', body: 'علاج مضمون 100% بدون أي أضرار', day: 1 }] });
    const j = await step();
    expect(j.ran!.status).toBe('blocked'); expect(j.ran!.reason.length).toBeGreaterThan(5);
    expect(calls.some(x => x.url.endsWith('/social_posts'))).toBe(false);
    const done = calls.filter(x => x.method === 'PATCH' && x.url.includes('campaign_tasks')).pop()!.body;
    expect(done.status).toBe('blocked'); expect(done.blocked_reason).toBeTruthy(); expect(done.spec.feedback).toBeTruthy(); expect(done.spec.auto).toBe(2);
    expect(calls.some(x => x.url.endsWith('/campaign_outputs') && x.method === 'POST')).toBe(true);   // the refused draft stays visible for the person
  });
  it('a clean social task saves its posts as DRAFT, manual, for Social\'s approvers: never scheduled, never approved', async () => {
    tasks = [task(0, 'social', 'waiting')];
    llm = () => JSON.stringify({ posts: [{ platform: 'x', body: 'احجز زيارة منزلية مع ممرضة مرخّصة.', day: 2 }, { platform: 'facebook', body: 'رعاية في بيتك.', day: 3 }] });
    expect((await step()).ran!.status).toBe('review');
    const s = calls.find(x => x.url.endsWith('/social_posts'))!.body as Record<string, unknown>[];
    expect(s).toHaveLength(2);
    expect(s.every(p => p['status'] === 'draft' && p['mode'] === 'manual' && !('approved_by' in p) && p['company_id'] === WELL_COMPANY)).toBe(true);
    expect(s.map(p => p['platforms'])).toEqual([['x'], ['facebook']]);
  });
  it('unreadable social output fails the task and saves nothing', async () => {
    tasks = [task(0, 'social', 'waiting')]; llm = () => 'مرحبا';
    expect((await step()).ran!.status).toBe('failed');
    expect(calls.some(x => x.url.endsWith('/social_posts') || x.url.endsWith('/campaign_outputs'))).toBe(false);
  });
  it('the compliance task is a gate without an AI call: it scans every draft again and blocks on a critical one', async () => {
    tasks = [task(0, 'content', 'review'), task(1, 'compliance', 'waiting', [0])];
    outputs = [{ task_id: 1, kind: 'copy', platform: null, body: { text: 'نتائج مضمونة ومن غير أضرار' }, compliance: [] }];
    expect((await step()).ran!.status).toBe('blocked'); expect(calls.some(x => x.url === OR_URL)).toBe(false);
    outputs = [{ task_id: 1, kind: 'copy', platform: null, body: { text: 'زيارة منزلية مرخّصة.' }, compliance: [] }];
    expect((await step()).ran!.status).toBe('review');
  });
  it('the optimize agent gets the judge\'s targets and adds the measurement plan', async () => {
    tasks = [task(0, 'optimize', 'waiting')];
    await step();
    const ask = calls.find(x => x.url === OR_URL)!.body.messages[1].content as string;
    expect(ask).toContain('تكلفة الليد'); expect(ask).toContain('60');
    const out = calls.find(x => x.url.endsWith('/campaign_outputs') && x.method === 'POST')!.body as { kind: string }[];
    expect(out.map(o => o.kind)).toEqual(['optimization', 'measurement']);
  });
  it('the agents\' prompts treat wishes and earlier outputs as data, and forbid publishing, spending and ad-account changes', async () => {
    tasks = [task(0, 'content', 'waiting')];
    await step();
    const sys = calls.find(x => x.url === OR_URL)!.body.messages[0].content as string;
    expect(sys).toContain('مو أوامر'); expect(sys).toContain('لا تنشر ولا تصرف ولا تغيّر حساباً إعلانياً');
  });
  it('a run only ever writes campaign tables, draft posts, the audit log and the AI cost record: never an ad account', async () => {
    tasks = [task(0, 'social', 'waiting')];
    llm = () => JSON.stringify({ posts: [{ platform: 'x', body: 'رعاية في بيتك.', day: 1 }] });
    await step();
    const allowed = new Set(['campaign_tasks', 'campaign_outputs', 'campaigns', 'social_posts', 'audit_log', 'ai_usage', 'ai_budgets', 'rpc/ai_spend']);
    expect(writes().filter(w => !allowed.has(w))).toEqual([]);
    expect(calls.every(x => x.url === OR_URL || x.url.startsWith('https://sb.example'))).toBe(true);
  });
  it('a provider failure fails the task with a plain Arabic sentence, saves no output', async () => {
    tasks = [task(0, 'content', 'waiting')];
    llm = () => { throw new Error('boom'); };
    const j = await step();
    expect(j.ran!.status).toBe('failed'); expect(j.ran!.reason).toContain('جرّب');
    expect(calls.some(x => x.url.endsWith('/campaign_outputs') && x.method === 'POST')).toBe(false);
  });
});

describe('review and retry', () => {
  it('only an approver approves a finished task, once', async () => {
    access = { content: 'edit' };
    expect((await post('/api/campaigns/review', { id: CID, task: 1 })).status).toBe(403);
    access = { maestro: 'approve' };
    expect((await post('/api/campaigns/review', { id: CID, task: 1 })).status).toBe(200);
    const p = calls.find(x => x.method === 'PATCH' && x.url.includes('campaign_tasks'))!;
    expect(p.url).toContain('status=eq.review'); expect(p.body.status).toBe('approved');
    expect((await post('/api/campaigns/review', { id: CID, task: 0 })).status).toBe(400);
  });
  it('a blocked task is retried by an approver, with its old output dropped, at most twice', async () => {
    tasks = [task(0, 'content', 'blocked', [], { spec: { retries: 0, feedback: 'ف' } })];
    expect((await post('/api/campaigns/retry', { id: CID, task: 1 })).status).toBe(200);
    expect(calls.some(x => x.method === 'DELETE' && x.url.includes('campaign_outputs'))).toBe(true);
    const p = calls.find(x => x.method === 'PATCH' && x.url.includes('campaign_tasks'))!.body;
    expect(p.status).toBe('waiting'); expect(p.spec.retries).toBe(1); expect(p.spec.feedback).toBe('ف');
    tasks = [task(0, 'content', 'blocked', [], { spec: { retries: 2 } })];
    expect((await post('/api/campaigns/retry', { id: CID, task: 1 })).status).toBe(409);
    tasks = [task(0, 'content', 'review')];
    expect((await post('/api/campaigns/retry', { id: CID, task: 1 })).status).toBe(409);
    access = {};
    expect((await post('/api/campaigns/retry', { id: CID, task: 1 })).status).toBe(403);
  });
});

describe('POST /api/campaigns/override (a person lets a compliance-stopped task through)', () => {
  const blocked = (agent = 'content') => [task(0, agent, 'blocked', [], { blocked_reason: 'وعد بنتيجة', spec: { feedback: 'ف' } }), task(1, 'compliance', 'waiting', [0])];
  const REASON = 'النص معتمد قانونياً من المستشار';
  beforeEach(() => { tasks = blocked(); outputs = [{ task_id: 1, kind: 'copy', platform: null, body: { text: 'نص ممنوع سري' }, compliance: [{ rule: 'cure_claim', level: 'critical' }] }]; });
  it('is for the owner or an approver only', async () => {
    access = { content: 'edit' };
    expect((await post('/api/campaigns/override', { id: CID, task: 1, reason: REASON })).status).toBe(403);
    expect(calls.some(x => x.method === 'PATCH')).toBe(false);
  });
  it('needs a short written reason, a valid task, and a task that compliance actually stopped', async () => {
    expect((await post('/api/campaigns/override', { id: CID, task: 1 })).status).toBe(400);
    expect((await post('/api/campaigns/override', { id: CID, task: 1, reason: 'ok' })).status).toBe(400);
    expect((await post('/api/campaigns/override', { id: CID, task: 0, reason: REASON })).status).toBe(400);
    tasks = [task(0, 'content', 'review')];
    expect((await post('/api/campaigns/override', { id: CID, task: 1, reason: REASON })).status).toBe(409);
    tasks = [task(0, 'content', 'failed')];
    expect((await post('/api/campaigns/override', { id: CID, task: 1, reason: REASON })).status).toBe(409);
  });
  it('marks the task «overridden» with who and why, moves it to review, and audit-logs who, why and the rules, never the text', async () => {
    const r = await post('/api/campaigns/override', { id: CID, task: 1, reason: REASON });
    expect(r.status).toBe(200);
    const p = calls.find(x => x.method === 'PATCH' && x.url.includes('campaign_tasks'))!;
    expect(p.url).toContain('status=eq.blocked');
    expect(p.body).toMatchObject({ status: 'review', blocked_reason: null, spec: { override: { by: 'm@example.com', reason: REASON } } });
    expect(p.body.spec.feedback).toBeUndefined();
    const aud = calls.filter(x => x.url.includes('/audit_log') && x.method === 'POST').map(x => x.body);
    expect(aud.map(a => a.action)).toEqual(['campaign_compliance_override']);
    expect(JSON.stringify(aud)).toContain(REASON); expect(JSON.stringify(aud)).toContain('cure_claim'); expect(JSON.stringify(aud)).not.toContain('نص ممنوع سري');
  });
  it('the next task can now run (the campaign goes on), and the compliance gate does not stop the overridden task again', async () => {
    tasks = [task(0, 'content', 'review', [], { spec: { override: { by: 'm@example.com', reason: REASON, at: 'x' } } }), task(1, 'compliance', 'waiting', [0])];
    outputs = [{ task_id: 1, kind: 'copy', platform: null, body: { text: 'نتائج مضمونة ومن غير أضرار' }, compliance: [] }];
    const j = await step();
    expect(j.ran!.agent).toBe('compliance'); expect(j.ran!.status).toBe('review');
    const rep = (calls.find(x => x.url.endsWith('/campaign_outputs') && x.method === 'POST')!.body as { body: { text: string } }[])[0]!.body.text;
    expect(rep).toContain('متجاوزة بموافقة');
  });
  it('an overridden social task makes Social DRAFTS only: manual, never scheduled, approved or published', async () => {
    tasks = blocked('social');
    outputs = [{ task_id: 1, kind: 'post', platform: 'x', body: { text: 'مسودة', day: 2 }, compliance: [] }];
    expect((await post('/api/campaigns/override', { id: CID, task: 1, reason: REASON })).status).toBe(200);
    const s = calls.find(x => x.url.endsWith('/social_posts'))!.body as Record<string, unknown>[];
    expect(s.every(p => p['status'] === 'draft' && p['mode'] === 'manual' && !('approved_by' in p))).toBe(true);
    expect(writes().filter(w => !['campaign_tasks', 'campaigns', 'social_posts', 'audit_log'].includes(w))).toEqual([]);
  });
  it('the pack file says the task was overridden, by whom and why', () => {
    const md = packMarkdown({ title: 'ح', status: 'review' }, [{ ...t(0, 'content', 'review'), spec: { override: { by: 'a@x.co', reason: 'سبب', at: 'x' } } }], []);
    expect(md).toContain('تجاوز بموافقة a@x.co: سبب');
  });
});

describe('GET /api/campaigns/agents (the sidebar dots)', () => {
  const get = async () => await (await api.request('https://well.example/api/campaigns/agents', { headers: { cookie: `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(profile(), cfg), cfg.secret))}` } }, E)).json() as { active: boolean; agents: Record<string, string> };
  it('needs sign-in', async () => { expect((await api.request('https://well.example/api/campaigns/agents', {}, E)).status).toBe(401); });
  it('says which agents are working or failed, with no text and no ids; inactive when there is no live campaign', async () => {
    tasks = [task(0, 'content', 'running'), task(1, 'social', 'failed'), task(2, 'social', 'running')];
    expect(await get()).toEqual({ active: true, agents: { content: 'running', social: 'running' } });
    tasks = [task(0, 'design', 'failed')];
    expect((await get()).agents).toEqual({ design: 'failed' });
  });
  it('between two steps of a live run the next agent still pulses (no flicker to idle); a campaign nobody is running goes quiet', async () => {
    campaign['status'] = 'running';
    tasks = [task(0, 'knowledge', 'review', [], { campaign_id: CID }), task(1, 'content', 'waiting', [0], { campaign_id: CID }), task(2, 'social', 'waiting', [1], { campaign_id: CID })];
    expect((await get()).agents).toEqual({ content: 'running' });
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    tasks = tasks.map(x => ({ ...x, updated_at: old }));
    expect((await get()).agents).toEqual({});
    campaign['status'] = 'review';   // a stopped campaign does not pulse either
    tasks = [task(0, 'knowledge', 'review', [], { campaign_id: CID }), task(1, 'content', 'waiting', [0], { campaign_id: CID })];
    expect((await get()).agents).toEqual({});
  });
  it('an old campaign (tasks backfilled on its first run) lights the dot as soon as its first task runs', async () => {
    campaign['status'] = 'running'; tasks = [task(0, 'knowledge', 'running', [], { campaign_id: CID })];
    expect(await get()).toEqual({ active: true, agents: { knowledge: 'running' } });
  });
  it('a member only counts their own campaigns', async () => {
    access = {};
    await get();
    expect(calls.find(x => x.url.includes('/rest/v1/campaigns?'))!.url).toContain('created_by=eq.m%40example.com');
  });
});

describe('the automatic repair loop (compliance refuses -> the agent rewrites by its instructions -> checked again)', () => {
  const BAD = 'نحن الأفضل ونضمن نتيجة مضمونة 100%';
  it('the first refusal is NOT a stop: the task goes back to waiting with compliance\'s instructions, nothing is saved, the run goes on', async () => {
    tasks = [task(0, 'content', 'waiting')];
    llm = () => BAD;
    const j = await step();
    expect(j.ran).toMatchObject({ agent: 'content', status: 'waiting', fixing: 1 }); expect(j.more).toBe(true);
    const p = calls.filter(x => x.method === 'PATCH' && x.url.includes('campaign_tasks')).pop()!.body;
    expect(p.status).toBe('waiting'); expect(p.blocked_reason).toBeNull(); expect(p.spec.auto).toBe(1);
    expect(p.spec.feedback).toContain('الأفضل'); expect(p.spec.feedback).toContain('الصياغة المعتمدة');   // what to cut and the approved wording
    expect(calls.some(x => x.url.endsWith('/campaign_outputs') && x.method === 'POST')).toBe(false);
    expect(calls.filter(x => x.url.includes('/audit_log') && x.method === 'POST').map(x => x.body.action)).toEqual(['campaign_task_autofix']);
  });
  it('the rewrite is asked with those instructions, the clean result is checked again and the campaign goes on to the next task', async () => {
    tasks = [task(0, 'content', 'waiting', [], { spec: { auto: 1, feedback: 'احذف «الأفضل». الصياغة المعتمدة: رعاية موثوقة' } })];
    llm = () => 'رعاية موثوقة في بيتك.';
    const j = await step();
    expect(calls.find(x => x.url === OR_URL)!.body.messages[1].content).toContain('احذف «الأفضل»');
    expect(j.ran!.status).toBe('review');
    expect(calls.some(x => x.url.endsWith('/campaign_outputs') && x.method === 'POST')).toBe(true);
  });
  it('at most two automatic rewrites: the third refusal stops the task (blocked) with the reason, ready for «approve despite the refusal»', async () => {
    tasks = [task(0, 'content', 'waiting', [], { spec: { auto: 2, feedback: 'ف' } })];
    llm = () => BAD;
    const j = await step();
    expect(j.ran!.status).toBe('blocked'); expect(j.ran!.reason).toContain('الأفضل');
  });
  it('the whole loop in a row: two refusals, then a clean text, in three steps, no person needed', async () => {
    tasks = [task(0, 'content', 'waiting')];
    const texts = [BAD, BAD, 'رعاية موثوقة في بيتك.'];
    llm = n => texts[n - 1]!;
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      llmN = 0;
      llm = () => texts[i]!;
      const j = await step(); seen.push(j.ran!.status);
      // what the page would see on the next call: the task as saved
      const last = calls.filter(x => x.method === 'PATCH' && x.url.includes('campaign_tasks')).pop()!.body;
      tasks = [task(0, 'content', last.status, [], { spec: last.spec })];
    }
    expect(seen).toEqual(['waiting', 'waiting', 'review']);
  });
  it('every kind of finding in the screenshots is a critical one that the loop repairs: a superlative, a patient story, a guarantee, before and after', async () => {
    for (const text of ['نحن الأفضل في المنطقة', 'قصة نجاح مريضة شفيت بعد العلاج', 'نتيجة مضمونة 100%', 'صور قبل وبعد']) {
      expect(verdict([{ label: 'x', text }]).blocked).toBe(true);
    }
  });
  it('a manual retry starts the automatic attempts again', async () => {
    tasks = [task(0, 'content', 'blocked', [], { spec: { retries: 0, auto: 2 } })];
    await post('/api/campaigns/retry', { id: CID, task: 1 });
    expect(calls.find(x => x.method === 'PATCH' && x.url.includes('campaign_tasks'))!.body.spec).toMatchObject({ retries: 1, auto: 0 });
  });
});

describe('open questions: the agents go on with assumptions, an answer rewrites only what it affects', () => {
  const brief = { summary: 'ملخص', questions: [{ q: 'كم الميزانية؟', assumption: 'متوسطة', affects: ['optimize'] }, { q: 'أي نبرة؟', assumption: 'دافئة', affects: [] }] };
  it('the agents get every question with its assumption (or the user\'s answer) and are told not to stop', async () => {
    campaign['brief'] = { ...brief, questions: [brief.questions[0]!, { ...brief.questions[1]!, answer: 'رسمية' }] };
    tasks = [task(0, 'content', 'waiting')];
    await step();
    const ask = calls.find(x => x.url === OR_URL)!.body.messages[1].content as string;
    expect(ask).toContain('افتراض (كمّل عليه، لا توقف): متوسطة'); expect(ask).toContain('إجابة المستخدم: رسمية'); expect(ask).toContain('ولا تسأل ولا تتوقف');
  });
  it('the campaign is never held for a question: the run does not wait for any answer', async () => {
    campaign['brief'] = brief;
    expect((await step()).ran!.status).toBe('review');
  });
  it('an answer is saved in the brief, and only the tasks it affects, and what depends on them, are written again', async () => {
    campaign['brief'] = brief; campaign['status'] = 'review';
    tasks = [task(0, 'knowledge', 'review'), task(1, 'content', 'review', [0]), task(2, 'optimize', 'review', [1]), task(3, 'design', 'review', [0])];
    // question 0 affects only «optimize»: that task is written again, the others stay
    const r = await post('/api/campaigns/answer', { id: CID, index: 0, answer: 'خمسون ألف' });
    expect(r.status).toBe(200); expect(await r.json()).toEqual({ ok: true, regenerate: 1 });
    const brf = calls.find(x => x.method === 'PATCH' && x.url.includes('/campaigns?'))!.body.brief;
    expect(brf.questions[0].answer).toBe('خمسون ألف');
    const redo = calls.filter(x => x.method === 'PATCH' && x.url.includes('campaign_tasks')).map(x => [x.url.match(/id=eq\.(\d+)/)![1], x.body.status, x.body.spec.regen]);
    expect(redo).toEqual([['3', 'waiting', 1]]);   // task ids are position + 1: «optimize» is id 3
    expect(calls.some(x => x.method === 'DELETE' && x.url.includes('task_id=eq.3'))).toBe(true);
    const aud = calls.filter(x => x.url.includes('/audit_log') && x.method === 'POST').map(x => x.body);
    expect(aud.map(a => a.action)).toEqual(['campaign_answer']); expect(JSON.stringify(aud)).not.toContain('خمسون');
  });
  it('a question that names no agent affects all the writing agents and their followers, not the knowledge task', () => {
    const ts = [t(0, 'knowledge', 'review'), t(1, 'content', 'review', [0]), t(2, 'social', 'review', [1]), t(3, 'compliance', 'review', [2]), t(4, 'optimize', 'review', [3])];
    expect(affectedTasks(ts, [])).toEqual([2, 3, 4, 5]);
    expect(affectedTasks(ts, ['social'])).toEqual([3, 4, 5]);
  });
  it('before the campaign is approved an answer is only saved; a running task, an exhausted task, a stranger, a cancelled campaign are refused', async () => {
    campaign['brief'] = brief; campaign['status'] = 'planned'; tasks = [task(0, 'optimize', 'waiting')];
    expect(((await (await post('/api/campaigns/answer', { id: CID, index: 0, answer: 'س' })).json()) as { regenerate: number }).regenerate).toBe(0);
    campaign['status'] = 'running'; tasks = [task(0, 'optimize', 'running')];
    expect((await post('/api/campaigns/answer', { id: CID, index: 0, answer: 'س' })).status).toBe(409);
    tasks = [task(0, 'optimize', 'review', [], { spec: { regen: 3 } })];
    expect((await post('/api/campaigns/answer', { id: CID, index: 0, answer: 'س' })).status).toBe(409);
    campaign['status'] = 'cancelled';
    expect((await post('/api/campaigns/answer', { id: CID, index: 0, answer: 'س' })).status).toBe(409);
    expect((await post('/api/campaigns/answer', { id: CID, index: 9, answer: 'س' })).status).toBe(400);
    expect((await post('/api/campaigns/answer', { id: CID, index: 0, answer: '' })).status).toBe(400);
    expect((await post('/api/campaigns/answer', { id: CID, index: 0, answer: 'س' }, null)).status).toBe(401);
  });
});

describe('a campaign approved before the tasks existed (no campaign_tasks) can be run, without a new approval', () => {
  beforeEach(() => { tasks = []; campaign['approved_at'] = '2026-11-05T10:00:00Z'; campaign['approved_by'] = 'boss@example.com'; });
  it('gets the standard plan saved (no AI call for it), is audit-logged, and the first task then runs', async () => {
    const j = await step();
    const made = calls.find(x => x.url.endsWith('/campaign_tasks') && x.method === 'POST')!.body as Record<string, unknown>[];
    expect(made.map(x => x['agent'])).toEqual(['knowledge', 'content', 'design', 'voice', 'social', 'compliance', 'optimize']);
    expect(made.every(x => x['company_id'] === WELL_COMPANY && x['campaign_id'] === CID && Number(x['estimate_usd']) > 0)).toBe(true);
    expect(made.find(x => x['agent'] === 'compliance')!['depends_on']).toEqual([1, 2, 3, 4]);
    expect(j.ran).toMatchObject({ agent: 'knowledge', status: 'review' });
    expect(calls.filter(x => x.url === OR_URL)).toHaveLength(1);   // only the knowledge task's own call
    expect(calls.filter(x => x.url.includes('/audit_log') && x.method === 'POST').map(x => x.body.action)).toEqual(['campaign_backfill', 'campaign_task_run']);
  });
  it('a campaign that has its tasks is never backfilled again', async () => {
    tasks = [task(0, 'knowledge', 'waiting')];
    await step();
    expect(calls.some(x => x.url.endsWith('/campaign_tasks') && x.method === 'POST')).toBe(false);
  });
  it('a planned campaign (not approved) never runs and gets nothing created; neither does a done or cancelled one', async () => {
    for (const st of ['planned', 'done', 'cancelled']) {
      calls = []; campaign['status'] = st; campaign['approved_at'] = null;
      expect((await post('/api/campaigns/step', { id: CID })).status).toBe(409);
      expect(calls.some(x => x.method === 'POST' && x.url.includes('campaign_tasks')) || calls.some(x => x.url === OR_URL)).toBe(false);
    }
  });
  it('a stopped campaign (review) that was approved and has tasks waiting continues; one that was never approved does not', async () => {
    campaign['status'] = 'review'; tasks = [task(0, 'knowledge', 'waiting')];
    expect((await step()).ran!.agent).toBe('knowledge');
    expect(calls.some(x => x.method === 'PATCH' && x.url.includes('/campaigns?') && x.body.status === 'running')).toBe(true);
    campaign['approved_at'] = null;
    expect((await post('/api/campaigns/step', { id: CID })).status).toBe(409);
  });
});
