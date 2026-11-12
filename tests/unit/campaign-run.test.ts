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
let ENV = E as typeof E & { OPENAI_API_KEY?: string; GEMINI_API_KEY?: string; FILES?: R2Bucket };
let stateful = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let motion: { table: string; body: any }[] = [], images: Record<string, unknown>[] = [], speech: Record<string, unknown>[] = [], imageStatus = 200, imageCode = '', ttsStatus = 200, campaignSeen = true;
const store = new Map<string, Uint8Array>();
const R2 = { put: async (k: string, v: ArrayBuffer | Uint8Array) => { store.set(k, new Uint8Array(v as ArrayBuffer)); }, get: async (k: string) => (store.has(k) ? { body: new Response(store.get(k) as unknown as BodyInit).body, arrayBuffer: async () => store.get(k)!.slice().buffer } : null), delete: async (k: string | string[]) => { for (const x of [k].flat()) store.delete(x); } };
let calls: Call[], tasks: Record<string, unknown>[], outputs: Record<string, unknown>[], campaign: Record<string, unknown>, access: Record<string, string>, llm: (n: number) => string, llmN: number, claimable: boolean;
const profile = (): A.Profile => ({ id: UID, email: 'm@example.com', role: 'member', active: true, access, company_id: WELL_COMPANY });
const task = (position: number, agent: string, status: string, depends_on: number[] = [], extra: Record<string, unknown> = {}) => ({ id: position + 1, position, agent, title: 'مهمة ' + agent, spec: { detail: 'د' }, depends_on, status, blocked_reason: null, updated_at: new Date().toISOString(), ...extra });
beforeEach(() => {
  ENV = E; stateful = false; motion = []; images = []; speech = []; imageStatus = 200; imageCode = ''; ttsStatus = 200; campaignSeen = true; store.clear(); calls = []; llmN = 0; claimable = true; access = { maestro: 'approve' }; clearRoutes(); clearSnaps();
  campaign = { id: CID, title: 'حملة', status: 'approved', wishes: { goal: 'حملة للقدم', platforms: ['meta', 'x'] }, brief: { summary: 'ملخص' } };
  tasks = [task(0, 'knowledge', 'waiting'), task(1, 'content', 'waiting', [0]), task(2, 'social', 'waiting', [1]), task(3, 'compliance', 'waiting', [2]), task(4, 'optimize', 'waiting', [3])];
  outputs = []; llm = () => 'نص آمن عن الزيارة المنزلية.';
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined, method = init.method || 'GET';
    calls.push({ url, method, body });
    if (url.includes('api.openai.com/v1/images')) { images.push(body); return imageStatus === 200 ? new Response(JSON.stringify({ data: [{ b64_json: btoa('JPEGDATA') }] })) : new Response(JSON.stringify({ error: { code: imageCode } }), { status: imageStatus }); }
    if (url.includes('generativelanguage.googleapis.com')) { speech.push(body); return ttsStatus === 200 ? new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: btoa('\u0001'.repeat(48000)) } }] } }], usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 50 } })) : new Response('{}', { status: ttsStatus }); }
    if (url === OR_URL) return new Response(JSON.stringify({ choices: [{ message: { content: llm(++llmN) } }], usage: { prompt_tokens: 100, completion_tokens: 100, cost: 0.001 } }));
    if (url.includes('/profiles?id=eq.')) return new Response(JSON.stringify([profile()]));
    if (url.endsWith('/rest/v1/campaign_tasks') && method === 'POST') { tasks = (body as Record<string, unknown>[]).map((b, i) => ({ id: i + 1, status: 'waiting', blocked_reason: null, updated_at: new Date().toISOString(), ...b })); return new Response('[]'); }
    if (url.endsWith('/rest/v1/motion_projects') && method === 'POST') { motion.push({ table: 'projects', body }); return new Response(JSON.stringify([{ id: 7 }])); }
    if (url.endsWith('/rest/v1/motion_versions') && method === 'POST') { motion.push({ table: 'versions', body }); return new Response('[]'); }
    if (url.includes('/rest/v1/campaign_tasks') && method === 'PATCH') {
      if (!stateful) return new Response(JSON.stringify(claimable ? [{ id: 1 }] : []));
      const tid = Number(/[?&]id=eq\.(\d+)/.exec(url)?.[1]), want = /status=eq\.(\w+)/.exec(url)?.[1], row = tasks.find(x => x['id'] === tid);
      if (!row || (want && row['status'] !== want)) return new Response('[]');
      Object.assign(row, body); return new Response(JSON.stringify([row]));
    }
    if (url.includes('/rest/v1/campaign_tasks')) return new Response(JSON.stringify(tasks));
    if (stateful && url.endsWith('/rest/v1/campaign_outputs') && method === 'POST') { outputs.push(...(body as Record<string, unknown>[])); return new Response('[]'); }
    if (url.includes('/rest/v1/campaign_outputs') && method === 'GET') return new Response(JSON.stringify(outputs));
    if (url.includes('/rest/v1/campaigns') && method === 'GET') return new Response(JSON.stringify(campaignSeen ? [campaign] : []));
    return new Response('[]');
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const post = async (path: string, body: unknown, p: A.Profile | null = profile()) => {
  const cookie = p ? `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(p, cfg), cfg.secret))}` : '';
  const jobs: Promise<unknown>[] = [];
  const res = await withWaiter(j => jobs.push(j), () => api.request('https://well.example' + path, { method: 'POST', headers: { origin: 'https://well.example', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }, ENV));
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
    outputs = [{ task_id: 1, kind: 'copy', platform: null, body: { text: 'نتائج مضمونة ومن غير أضرار' }, compliance: [{ rule: 'guarantee', level: 'critical' }] }];
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
    expect(made.map(x => x['agent'])).toEqual(['knowledge', 'content', 'design', 'voice', 'design', 'social', 'compliance', 'optimize']);
    expect(made[4]!['spec']).toMatchObject({ kind: 'motion' }); expect(made[4]!['depends_on']).toEqual([2, 3]);   // the motion comes after the picture and the recording
    expect(made.every(x => x['company_id'] === WELL_COMPANY && x['campaign_id'] === CID && Number(x['estimate_usd']) > 0)).toBe(true);
    expect(made.find(x => x['agent'] === 'compliance')!['depends_on']).toEqual([1, 2, 3, 4, 5]);
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

describe('what the rules may stop: only what can reach an audience, and only a critical finding', () => {
  const QUOTE = 'ملخص فجوات المعلومات. القواعد: تجنّب «الأفضل» و«الوحيد» وأي وعد بنتيجة مضمونة، ولا تستخدم «قبل وبعد» ولا تجارب المرضى.';
  it('a knowledge summary that quotes forbidden words is NOT refused and gets no repair loop', async () => {
    tasks = [task(0, 'knowledge', 'waiting')]; llm = () => QUOTE;
    const j = await step();
    expect(j.ran).toMatchObject({ agent: 'knowledge', status: 'review' }); expect(j.ran).not.toHaveProperty('fixing');
    const out = (calls.find(x => x.url.endsWith('/campaign_outputs') && x.method === 'POST')!.body as { compliance: unknown[] }[])[0]!;
    expect(out.compliance).toEqual([]);
  });
  it('so is the budget and measurement document', async () => {
    tasks = [task(0, 'optimize', 'waiting')]; llm = () => QUOTE;
    expect((await step()).ran!.status).toBe('review');
  });
  it('the compliance gate does not scan internal references either', async () => {
    tasks = [task(0, 'knowledge', 'review'), task(1, 'compliance', 'waiting', [0])];
    outputs = [{ task_id: 1, kind: 'insight', platform: null, body: { text: QUOTE }, compliance: [] }];
    expect((await step()).ran!.status).toBe('review');
  });
  it('a warning (price without the total) or a note never stops anything: only a critical finding does', async () => {
    tasks = [task(0, 'content', 'waiting')]; llm = () => 'السعر 299 ريال فقط، احجز زيارة منزلية.';
    const j = await step();
    expect(j.ran!.status).toBe('review'); expect(j.ran).not.toHaveProperty('fixing');
  });
  it('a knowledge task an older version had stopped is released and the campaign goes on to the next task', async () => {
    tasks = [task(0, 'knowledge', 'blocked', [], { blocked_reason: 'قديم' }), task(1, 'content', 'waiting', [0])];
    const j = await step();
    expect(j.ran!.agent).toBe('content');
    expect(calls.filter(x => x.url.includes('/audit_log') && x.method === 'POST').map(x => x.body.action)).toContain('campaign_unblock_internal');
  });
  it('a whole campaign, run only by repeating the step: a violation is repaired by itself (twice at most) and every task finishes with no one pressing anything', async () => {
    stateful = true;
    campaign['wishes'] = { goal: 'حملة', platforms: ['x'] };
    tasks = [
      task(0, 'knowledge', 'waiting'), task(1, 'content', 'waiting', [0]), task(2, 'design', 'waiting', [0, 1]), task(3, 'voice', 'waiting', [1]),
      task(4, 'social', 'waiting', [1]), task(5, 'compliance', 'waiting', [1, 2, 3, 4]), task(6, 'optimize', 'waiting', [5])];
    let contentTries = 0;
    llm = () => {
      const sys = String(JSON.parse(String(calls.filter(x => x.url === OR_URL).pop()!.body && JSON.stringify(calls.filter(x => x.url === OR_URL).pop()!.body)))?.messages?.[0]?.content ?? '');
      if (sys.includes('إيجنت «المحتوى')) return ++contentTries <= 2 ? 'نحن الأفضل وبنتيجة مضمونة 100%' : 'رعاية موثوقة في بيتك مع ممرضة مرخّصة.';
      if (sys.includes('إيجنت «السوشال')) return JSON.stringify({ posts: [{ platform: 'x', body: 'احجز زيارتك المنزلية.', day: 1 }] });
      return sys.includes('إيجنت «المعرفة') || sys.includes('إيجنت «التحسين') ? QUOTE : 'بريف هادئ بألوان Well.';
    };
    const log: string[] = [];
    for (let i = 0; i < 20; i++) {
      const j = await step();
      if (j.done) { log.push('done:' + j.status); break; }
      log.push(`${j.ran!.agent}:${j.ran!.status}`);
    }
    expect(log.filter(x => x.startsWith('content'))).toEqual(['content:waiting', 'content:waiting', 'content:review']);
    expect(log.at(-1)).toBe('done:review');
    expect(tasks.map(x => x['status'])).toEqual(Array(7).fill('review'));
    expect(calls.filter(x => x.url.endsWith('/social_posts'))).toHaveLength(1);
    expect(calls.filter(x => x.url.includes('/audit_log') && x.method === 'POST').map(x => x.body.action).filter(a => a === 'campaign_task_autofix')).toHaveLength(2);
  });
});

// ---- pictures and speech: the campaign's design and voice tasks call the real makers (Design's image maker, Voiceover's speech maker)
describe('real files: pictures and speech (Design and Voiceover makers), checked before they are paid for', () => {
  const LAYOUT = { ...E, OPENAI_API_KEY: 'sk-test', GEMINI_API_KEY: 'g-test', FILES: R2 as unknown as R2Bucket };
  const voiceJson = JSON.stringify({ versions: [{ label: '30', text: 'رعاية موثوقة تبدأ من بيتك مع ممرضة مرخّصة، نمشي معك خطوة خطوة لصحة أطول.' }, { label: '10', text: 'رعاية موثوقة في بيتك.' }], notes: 'نبرة دافئة' });
  beforeEach(() => { ENV = LAYOUT; campaign['wishes'] = { goal: 'حملة', platforms: ['meta', 'x'], offer: 'زيارة منزلية', audience: 'عائلات' }; });
  const ofKind = (k: string) => (calls.find(x => x.url.endsWith('/campaign_outputs') && x.method === 'POST')?.body as { kind: string; platform?: string; body: Record<string, unknown> }[] ?? []).filter(o => o.kind === k);

  it('the design task writes the brief (told the real Well palette and fonts) and draws one picture per size the platforms need, kept in R2', async () => {
    tasks = [task(0, 'design', 'waiting')]; llm = () => 'فكرة بصرية هادئة بألوان Pulse Purple وWell Indigo.';
    const j = await step();
    expect(j.ran).toMatchObject({ agent: 'design', status: 'review' });
    const sys = calls.find(x => x.url === OR_URL)!.body.messages[1].content as string + calls.find(x => x.url === OR_URL)!.body.messages[0].content;
    for (const w of ['Pulse Purple', 'Purple Deep', 'Well Indigo', 'Pulse Pink', 'Noto Naskh Arabic', 'Playfair Display', 'Inter', '3%', 'ولا تقل «أخضر Well»']) expect(sys).toContain(w);
    expect(images.map(x => x['size'])).toEqual(['1024x1536', '1024x1024', '1536x1024']);   // story + square (Meta), landscape (X)
    const pics = ofKind('design_image');
    expect(pics.map(x => x.platform)).toEqual(['story', 'square', 'landscape']);
    for (const p of pics) { expect(p.body['key']).toMatch(new RegExp(`^campaign/${WELL_COMPANY}/${CID}/[0-9a-f]{32}\\.jpg$`)); expect(store.has(String(p.body['key']))).toBe(true); expect(p.body['mime']).toBe('image/jpeg'); }
    expect(ofKind('design_brief')).toHaveLength(1);
    expect(calls.filter(x => x.url.includes('/audit_log') && x.method === 'POST')[0]!.body.target).toMatchObject({ files: 3 });
  });
  it('the images are asked for with no text inside them (their words are checked, so is the brief that feeds them)', async () => {
    tasks = [task(0, 'design', 'waiting')]; llm = () => 'فكرة هادئة.';
    await step();
    expect(String(images[0]!['prompt'])).toContain('No text, letters, numbers, logos or watermarks');
    expect(String(images[0]!['prompt'])).toContain('#7E57FD');   // the Well palette, not an invented one
  });
  it('a refused brief costs no picture: it goes to the repair loop first', async () => {
    tasks = [task(0, 'design', 'waiting')]; llm = () => 'صورة قبل وبعد توضّح النتيجة المضمونة';
    expect((await step()).ran).toMatchObject({ status: 'waiting', fixing: 1 });
    expect(images).toHaveLength(0); expect(store.size).toBe(0);
  });
  it('when the picture maker fails or is not set up, the written brief stays, the reason is shown, and only that picture is missing (a retry makes it)', async () => {
    tasks = [task(0, 'design', 'waiting')]; llm = () => 'فكرة هادئة.'; imageStatus = 500;
    const j = await step();
    expect(j.ran!.status).toBe('review');
    expect(ofKind('design_brief')).toHaveLength(1); expect(ofKind('design_image')).toHaveLength(0);
    const miss = ofKind('asset_missing');
    expect(miss).toHaveLength(1); expect(miss[0]!.body).toMatchObject({ what: 'image', code: 'failed', retry: true }); expect(String(miss[0]!.body['text'])).toContain('جرّب');
    expect(images).toHaveLength(1);   // it stopped at the first failure: no more paid calls
    const done = calls.filter(x => x.method === 'PATCH' && x.url.includes('campaign_tasks')).pop()!.body;
    expect(done.spec.missing).toEqual(['image:story']);
  });
  it('no image key: says so plainly (not a code), and no call is made', async () => {
    ENV = { ...LAYOUT, OPENAI_API_KEY: undefined } as unknown as typeof ENV;
    tasks = [task(0, 'design', 'waiting')]; llm = () => 'فكرة هادئة.';
    await step();
    expect(images).toHaveLength(0);
    expect(ofKind('asset_missing')[0]!.body).toMatchObject({ what: 'image', code: 'no_key', retry: false });
  });
  it('no file storage: the picture is not pretended to be saved', async () => {
    ENV = { ...LAYOUT, FILES: undefined } as unknown as typeof ENV;
    tasks = [task(0, 'design', 'waiting')]; llm = () => 'فكرة هادئة.';
    await step();
    expect(ofKind('asset_missing')[0]!.body).toMatchObject({ what: 'image', code: 'no_storage' });
  });
  it('the voice task writes the 30 and 10 second scripts, checks them, then speaks each: a WAV in R2, its subtitles, and the script', async () => {
    tasks = [task(0, 'voice', 'waiting')]; llm = () => voiceJson;
    const j = await step();
    expect(j.ran).toMatchObject({ agent: 'voice', status: 'review' });
    expect(speech).toHaveLength(2);
    expect(ofKind('voice_script').map(x => x.body['label'])).toEqual(['30', '10']);
    const au = ofKind('voice_audio');
    expect(au.map(x => [x.body['label'], x.body['seconds'], x.body['mime']])).toEqual([['30', 1, 'audio/wav'], ['10', 1, 'audio/wav']]);
    const wav = store.get(String(au[0]!.body['key']))!;
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF'); expect(String.fromCharCode(...wav.slice(8, 12))).toBe('WAVE'); expect(wav.length).toBe(44 + 48000);
    expect(ofKind('voice_srt')).toHaveLength(2); expect(String(ofKind('voice_srt')[1]!.body['text'])).toContain('-->');
    expect(calls.filter(x => x.url.includes('/ai_usage')).map(x => x.body.module)).toContain('voiceover');
  });
  it('a refused script is never spoken (no audio cost)', async () => {
    tasks = [task(0, 'voice', 'waiting')]; llm = () => JSON.stringify({ versions: [{ label: '30', text: 'نحن الأفضل ونضمن نتيجة مضمونة 100%' }] });
    expect((await step()).ran).toMatchObject({ status: 'waiting', fixing: 1 });
    expect(speech).toHaveLength(0); expect(store.size).toBe(0);
  });
  it('a speech failure keeps the scripts and shows why; the same for a missing key', async () => {
    tasks = [task(0, 'voice', 'waiting')]; llm = () => voiceJson; ttsStatus = 429;
    expect((await step()).ran!.status).toBe('review');
    expect(ofKind('voice_script')).toHaveLength(2); expect(ofKind('voice_audio')).toHaveLength(0);
    expect(ofKind('asset_missing')[0]!.body).toMatchObject({ what: 'audio', code: 'rate_limited', retry: true });
    ENV = { ...LAYOUT, GEMINI_API_KEY: undefined } as unknown as typeof ENV; calls = []; speech = [];
    tasks = [task(0, 'voice', 'waiting')];
    await step();
    expect(speech).toHaveLength(0); expect(ofKind('asset_missing')[0]!.body).toMatchObject({ code: 'no_key' });
  });
  it('«generate the files again»: only an approver, only for a task with missing files; it asks for the files only, from the draft already written', async () => {
    tasks = [task(0, 'design', 'review', [], { spec: { missing: ['image:story'] } })];
    access = {};
    expect((await post('/api/campaigns/assets', { id: CID, task: 1 })).status).toBe(403);
    access = { maestro: 'approve' };
    expect((await post('/api/campaigns/assets', { id: CID, task: 1 })).status).toBe(200);
    expect(calls.find(x => x.method === 'PATCH' && x.url.includes('campaign_tasks'))!.body).toMatchObject({ status: 'waiting', spec: { stage: 'assets' } });
    expect(calls.some(x => x.method === 'DELETE' && x.url.includes('kind=eq.asset_missing'))).toBe(true);
    tasks = [task(0, 'design', 'review')];
    expect((await post('/api/campaigns/assets', { id: CID, task: 1 })).status).toBe(409);
  });
  it('the retry writes nothing again: it draws only the pictures that are missing from the stored brief, then the task is complete', async () => {
    stateful = true; campaign['status'] = 'review'; campaign['approved_at'] = '2026-11-05T10:00:00Z';
    tasks = [task(0, 'design', 'waiting', [], { spec: { stage: 'assets', missing: ['image:square'] } })];
    outputs = [{ task_id: 1, kind: 'design_brief', platform: null, body: { text: 'الفكرة المكتوبة من قبل' }, compliance: [] }, { task_id: 1, kind: 'design_image', platform: 'story', body: { key: 'k1', mime: 'image/jpeg' }, compliance: [] }];
    const j = await step();
    expect(j.ran).toMatchObject({ agent: 'design', status: 'review' });
    expect(calls.some(x => x.url === OR_URL)).toBe(false);                    // no new writing
    expect(images.map(x => x['size'])).toEqual(['1024x1024', '1536x1024']);   // story already exists: square and landscape only
    expect(String(images[0]!['prompt'])).toContain('الفكرة المكتوبة من قبل'.slice(0, 5) === '' ? '' : 'Visual idea');
    expect(tasks[0]!['spec']).not.toHaveProperty('stage'); expect(tasks[0]!['spec']).not.toHaveProperty('missing');
  });
  it('a picture or recording is served only to who may see the campaign, from this campaign\'s own folder, with a locked-down policy', async () => {
    const key = `campaign/${WELL_COMPANY}/${CID}/${'a'.repeat(32)}.jpg`; store.set(key, new Uint8Array([1, 2, 3]));
    const row = { campaign_id: CID, kind: 'design_image', platform: 'story', body: { key, mime: 'image/jpeg' } };
    const get = async (id = 5, q = '') => api.request('https://well.example/api/campaigns/file?id=' + id + q, { headers: { cookie: `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(profile(), cfg), cfg.secret))}` } }, ENV);
    const origFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/rest/v1/campaign_outputs')) return new Response(JSON.stringify([row]));
      return (origFetch as typeof fetch)(url, init);
    }));
    const ok = await get();
    expect(ok.status).toBe(200); expect(ok.headers.get('content-type')).toBe('image/jpeg'); expect(ok.headers.get('content-security-policy')).toContain("default-src 'none'"); expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
    expect(ok.headers.get('content-disposition')).toContain('inline'); expect((await get(5, '&dl=1')).headers.get('content-disposition')).toContain('attachment');
    campaignSeen = false;
    expect((await get()).status).toBe(404);                                   // not their campaign
    campaignSeen = true; row.body.key = `campaign/${WELL_COMPANY}/66666666-6666-6666-6666-666666666666/${'a'.repeat(32)}.jpg`;
    expect((await get()).status).toBe(404);                                   // a key outside this campaign's folder
    row.body.key = '../../etc/passwd';
    expect((await get()).status).toBe(404);
    expect((await get(0)).status).toBe(400);
    expect((await api.request('https://well.example/api/campaigns/file?id=5', {}, ENV)).status).toBe(401);
  });
  it('a rewrite or a new answer also deletes the files of the outputs it drops (nothing is left in R2)', async () => {
    const key = `campaign/${WELL_COMPANY}/${CID}/${'b'.repeat(32)}.jpg`; store.set(key, new Uint8Array([1]));
    tasks = [task(0, 'design', 'blocked', [], { spec: { retries: 0 } })];
    const origFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => (String(url).includes('/rest/v1/campaign_outputs') && (init?.method || 'GET') === 'GET' ? new Response(JSON.stringify([{ body: { key } }])) : (origFetch as typeof fetch)(url, init))));
    expect((await post('/api/campaigns/retry', { id: CID, task: 1 })).status).toBe(200);
    expect(store.has(key)).toBe(false);
  });
});

describe('what the agents are told and may say', () => {
  it('the budget is only the user\'s: with none given, a riyal amount in the plan is refused (repair loop) and a «not set» plan passes; with one given it may be used', async () => {
    tasks = [task(0, 'optimize', 'waiting')]; campaign['wishes'] = { goal: 'حملة', platforms: ['meta'] };
    llm = () => 'الميزانية الإجمالية 15,000 ريال سعودي، 35% للاختبار.';
    expect((await step()).ran).toMatchObject({ status: 'waiting', fixing: 1 });
    expect(calls.filter(x => x.method === 'PATCH' && x.url.includes('campaign_tasks')).pop()!.body.spec.feedback).toContain('لم تُحدَّد');
    calls = []; tasks = [task(0, 'optimize', 'waiting')]; llm = () => 'الميزانية: لم تُحدَّد. التقسيم: 40% للاختبار و60% للتوسّع.';
    expect((await step()).ran!.status).toBe('review');
    calls = []; tasks = [task(0, 'optimize', 'waiting')]; campaign['wishes'] = { goal: 'حملة', platforms: ['meta'], budget: '20000 ريال' }; llm = () => 'ننفق 7,000 ريال في الاختبار.';
    expect((await step()).ran!.status).toBe('review');
  });
  it('the optimization agent is told the budget is not set (or what it is), and that TikTok is judged by CTR and engagement, not leads', async () => {
    tasks = [task(0, 'optimize', 'waiting')]; campaign['wishes'] = { goal: 'حملة', platforms: ['tiktok'] };
    await step();
    const all = JSON.stringify(calls.find(x => x.url === OR_URL)!.body.messages);
    expect(all).toContain('الميزانية: لم تُحدَّد'); expect(all).toContain('تيك توك يُحكم عليه بنسبة النقر'); expect(all).toContain('لا تقارن به بالليدز');
  });
  it('the knowledge agent keeps three headed sections apart: the concept, the past numbers, the gaps', async () => {
    tasks = [task(0, 'knowledge', 'waiting')];
    await step();
    const sys = calls.find(x => x.url === OR_URL)!.body.messages[0].content as string;
    for (const h of ['## مفهوم الحملة والجمهور', '## أرقام الإعلانات السابقة', '## فجوات المعلومات']) expect(sys).toContain(h);
  });
  it('the compliance report mentions an override only when a task really let a refused piece through', async () => {
    outputs = [{ task_id: 1, kind: 'copy', platform: null, body: { text: 'زيارة منزلية مرخّصة.' }, compliance: [] }];
    tasks = [task(0, 'content', 'review'), task(1, 'compliance', 'waiting', [0])];
    await step();
    expect((calls.find(x => x.url.endsWith('/campaign_outputs') && x.method === 'POST')!.body as { body: { text: string } }[])[0]!.body.text).not.toContain('متجاوزة');
    calls = []; tasks = [task(0, 'knowledge', 'review', [], { spec: { override: { by: 'a', reason: 'سبب', at: 'x' } } }), task(1, 'compliance', 'waiting', [0])];   // an override on an internal reference changes nothing
    outputs = [{ task_id: 1, kind: 'insight', platform: null, body: { text: 'ملخص' }, compliance: [] }];
    await step();
    expect((calls.find(x => x.url.endsWith('/campaign_outputs') && x.method === 'POST')!.body as { body: { text: string } }[])[0]!.body.text).not.toContain('متجاوزة');
  });
});

// ---- the motion task: the Design module's motion planner over the campaign's own picture and recording
describe('«موشن جرافيك» in the campaign: a real motion project from the campaign\'s picture and recording', () => {
  const LAYOUT = { ...E, OPENAI_API_KEY: undefined, GEMINI_API_KEY: 'g', FILES: R2 as unknown as R2Bucket };
  const IMG = `campaign/${WELL_COMPANY}/${CID}/${'a'.repeat(32)}.jpg`, WAV = `campaign/${WELL_COMPANY}/${CID}/${'b'.repeat(32)}.wav`;
  const ready = () => [
    { id: 41, task_id: 3, kind: 'design_image', platform: 'story', body: { key: IMG, mime: 'image/jpeg', w: 1080, h: 1920 }, compliance: [] },
    { id: 42, task_id: 4, kind: 'voice_audio', platform: null, body: { key: WAV, mime: 'audio/wav', seconds: 28.4, label: '30', text: 'رعاية موثوقة تبدأ من بيتك. نمشي معك خطوة خطوة.' }, compliance: [] }];
  beforeEach(() => { ENV = LAYOUT as unknown as typeof ENV; store.set(IMG, new Uint8Array([9, 9, 9])); store.set(WAV, new Uint8Array([7, 7])); campaign['title'] = 'حملة العافية'; tasks = [task(0, 'design', 'waiting', [], { id: 5, spec: { kind: 'motion', detail: 'x' } })]; outputs = ready(); });
  const ofKind = (k: string) => (calls.find(x => x.url.endsWith('/campaign_outputs') && x.method === 'POST')?.body as { kind: string; body: Record<string, unknown> }[] ?? []).filter(o => o.kind === k);

  it('makes a motion PROJECT (the Design tab\'s own tables and file folder) from the story picture and the 30-second recording, with a scene plan', async () => {
    const j = await step();
    expect(j.ran).toMatchObject({ agent: 'design', status: 'review' });
    const proj = motion.find(m => m.table === 'projects')!.body;
    expect(proj).toMatchObject({ company_id: WELL_COMPANY, ratio: '9:16', title: 'حملة العافية', voice_seconds: 28.4, voice_mime: 'audio/wav', design_mime: 'image/jpeg', created_by: 'm@example.com' });
    expect(proj.design_key).toMatch(new RegExp(`^motion/${WELL_COMPANY}/[0-9a-f]{32}\\.jpg$`)); expect(proj.voice_key).toMatch(new RegExp(`^motion/${WELL_COMPANY}/[0-9a-f]{32}\\.wav$`));
    expect([...store.get(proj.design_key)!]).toEqual([9, 9, 9]); expect([...store.get(proj.voice_key)!]).toEqual([7, 7]);   // copied, not moved: the pack keeps its own files
    expect(store.has(IMG) && store.has(WAV)).toBe(true);
    const ver = motion.find(m => m.table === 'versions')!.body;
    expect(ver).toMatchObject({ project_id: 7, version: 1, engine: 'templates' }); expect(ver.spec.scenes.length).toBeGreaterThan(1); expect(ver.spec.ratio).toBe('9:16');
    const board = ofKind('motion_storyboard')[0]!.body;
    expect(board).toMatchObject({ project: 7, version: 1, ratio: '9:16', image_id: 41, audio_id: 42 });
    expect(calls.filter(x => x.url.includes('/audit_log') && x.method === 'POST').map(x => x.body.action)).toEqual(['motion_create', 'campaign_task_run']);
  });
  it('without a picture or a recording it says exactly which is missing and why; no project is made', async () => {
    outputs = [ready()[1]!];
    const j = await step();
    expect(j.ran!.status).toBe('review');
    expect(motion).toHaveLength(0);
    const m = ofKind('asset_missing')[0]!.body;
    expect(m).toMatchObject({ what: 'motion', code: 'needs_inputs' }); expect(String(m['text'])).toContain('صورة التصميم');
    expect(calls.filter(x => x.method === 'PATCH' && x.url.includes('campaign_tasks')).pop()!.body.spec.missing).toEqual(['motion:needs_inputs']);
  });
  it('no file storage: says so, nothing is pretended', async () => {
    ENV = { ...LAYOUT, FILES: undefined } as unknown as typeof ENV;
    await step();
    expect(ofKind('asset_missing')[0]!.body).toMatchObject({ code: 'no_storage' }); expect(motion).toHaveLength(0);
  });
  it('the words on the video are checked first: a refused one stops it before any project exists (repair loop)', async () => {
    campaign['title'] = 'علاج مضمون 100% بدون أي أضرار';
    const j = await step();
    expect(j.ran).toMatchObject({ status: 'waiting', fixing: 1 }); expect(motion).toHaveLength(0); expect(store.size).toBe(2);
  });
  it('the retry of a missing motion builds it once the picture and recording exist', async () => {
    outputs = [];
    await step();
    expect(motion).toHaveLength(0);
    calls = []; outputs = ready(); tasks = [task(0, 'design', 'waiting', [], { id: 5, spec: { kind: 'motion', stage: 'assets', missing: ['motion:needs_inputs'] } })];
    expect((await step()).ran!.status).toBe('review');
    expect(motion.map(m => m.table)).toEqual(['projects', 'versions']);
    expect(calls.filter(x => x.method === 'PATCH' && x.url.includes('campaign_tasks')).pop()!.body.spec).not.toHaveProperty('missing');
  });
  it('the plan may hold ONE motion task, only as a design task; the standard plan puts it after the design and the voice, before compliance', async () => {
    const { parsePlan } = await import('../../src/lib/campaign');
    const p = parsePlan(JSON.stringify({ title: 't', brief: {}, tasks: [{ agent: 'design', title: 'a' }, { agent: 'voice', title: 'b' }, { agent: 'design', title: 'موشن', kind: 'motion', after: [0, 1] }, { agent: 'design', title: 'ثاني', kind: 'motion' }, { agent: 'content', title: 'c', kind: 'motion' }] }))!;
    expect(p.tasks.map(t => t.kind)).toEqual([undefined, undefined, 'motion', undefined, undefined]);
    const { defaultTasks } = await import('../../src/lib/campaign-run');
    const d = defaultTasks(), mi = d.findIndex(x => x.kind === 'motion');
    expect(d[mi]!.agent).toBe('design'); expect(d[mi]!.after).toEqual([2, 3]); expect(d.findIndex(x => x.agent === 'compliance')).toBeGreaterThan(mi);
  });
});
