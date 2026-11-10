// OpenRouter provider (src/lib/llm.ts) and per-task routing (src/lib/ai-routes.ts, /api/maestro/models). Fake fetch, synthetic data only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { generate, llmMessage, orBody, orHeaders, orText, pick, stream, viaOpenRouter, OR_URL, type LlmEnv, type StreamEvent } from '../../src/lib/llm';
import { clearRoutes } from '../../src/lib/ai-routes';
import { clearSnaps, withWaiter, type UsageCtx } from '../../src/lib/usage';
import { explainViaOpenRouter } from '../../src/modules/debugger/explain';
import { ROUTES } from '../../src/modules/routes';

const CO = '11111111-1111-1111-1111-111111111111', OTHER = '22222222-2222-2222-2222-222222222222';
const SB: A.AuthEnv = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'boss@example.com' };
const cfg = A.env(SB);
const ctx = (co = CO, tab?: string): UsageCtx => ({ cfg, co, uid: 'u-1', ...(tab ? { tab } : {}) });
const IN = { messages: [{ role: 'user', content: 'اكتب' }], max_tokens: 40 };
const KEY = 'or-test-key';
const OR: LlmEnv = { OPENROUTER_API_KEY: KEY, OPENAI_API_KEY: 'o', XAI_API_KEY: 'x' };
const MODEL = 'anthropic/claude-sonnet-4.5';

type Call = { url: string; method: string; body: unknown; headers: Record<string, string> };
let calls: Call[], routes: Record<string, { task: string; provider: string; model: string | null }[]>, caps: { module: string; monthly_cap_usd: number | null; alert_at_pct: number }[], spend: { module: string; cost_usd: number }[], orReply: () => Response, profile: A.Profile | null;
const usageRows = () => calls.filter(c => c.url.includes('/ai_usage') && c.method === 'POST').map(c => c.body as Record<string, unknown>);
const orCalls = () => calls.filter(c => c.url === OR_URL);
const settle = async <T>(run: () => Promise<T>): Promise<T> => { const jobs: Promise<unknown>[] = []; const out = await withWaiter(p => jobs.push(p), run); await Promise.all(jobs); return out; };
const okJson = (content: string, usage: unknown = { prompt_tokens: 100, completion_tokens: 50, cost: 0.00123 }) => new Response(JSON.stringify({ choices: [{ message: { content } }], usage }));
const body = (parts: string[]) => { const q = [...parts], enc = new TextEncoder(); return new ReadableStream<Uint8Array>({ pull(c) { const p = q.shift(); if (p === undefined) c.close(); else c.enqueue(enc.encode(p)); } }); };
const chunk = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
const drain = async (g: AsyncGenerator<StreamEvent>) => { const out: StreamEvent[] = []; for await (const x of g) out.push(x); return out; };
const workersAi = () => ({ run: vi.fn(async () => ({ response: 'من المجاني' })) }) as unknown as NonNullable<LlmEnv['AI']>;

beforeEach(() => {
  calls = []; routes = {}; caps = []; spend = []; profile = null; orReply = () => okJson('نص من OpenRouter'); clearRoutes(); clearSnaps();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined, headers: (init.headers || {}) as Record<string, string> });
    if (url === OR_URL) return orReply();
    if (url.includes('/profiles?id=eq.')) return new Response(JSON.stringify(profile ? [profile] : []));
    if (url.includes('/ai_routes') && (init.method || 'GET') === 'GET') { const co = /company_id=eq\.([0-9a-f-]+)/.exec(url)?.[1] || ''; return new Response(JSON.stringify(routes[co] || [])); }
    if (url.includes('/rpc/ai_spend')) return new Response(JSON.stringify(spend.map(s => ({ month: '2026-11', calls: 1, tokens_in: 1, tokens_out: 1, cost_sar: 0, unpriced: 0, ...s }))));
    if (url.includes('/ai_budgets') && (init.method || 'GET') === 'GET') return new Response(JSON.stringify(caps));
    return new Response('[]');
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const route = (task: string, provider = 'openrouter', model: string | null = MODEL, co = CO) => { routes[co] = [...(routes[co] || []), { task, provider, model }]; };

describe('which provider', () => {
  it('nothing switches by itself: the key alone changes no task', () => {
    for (const m of ['content', 'design', 'copy', 'social', 'maestro', 'listening', 'journeys']) expect(pick({ ...OR, AI: workersAi() }, m)?.provider).not.toBe('openrouter');
  });
  it('a route to OpenRouter wins when the key and a model id are there, and is ignored otherwise', () => {
    expect(pick(OR, 'copy', false, { provider: 'openrouter', model: MODEL })).toEqual({ provider: 'openrouter', model: MODEL });
    expect(pick({ OPENAI_API_KEY: 'o' }, 'copy', false, { provider: 'openrouter', model: MODEL })?.provider).toBe('openai');   // no key: the current provider
    expect(pick(OR, 'copy', false, { provider: 'openrouter' })?.provider).toBe('openai');                                     // no model id
    expect(pick(OR, 'copy', false, { provider: 'openrouter', model: 'not a model' })?.provider).toBe('openai');
    expect(pick({ ...OR, AI: workersAi() }, 'copy', true, { provider: 'openrouter', model: MODEL })?.provider).toBe('workers');   // cap spent
  });
  it('the other providers can be chosen per task too, with their own default model', () => {
    expect(pick(OR, 'journeys', false, { provider: 'xai' })).toMatchObject({ provider: 'xai' });
    expect(pick({ ...OR, AI: workersAi() }, 'copy', false, { provider: 'workers' })?.provider).toBe('workers');
  });
});

describe('request', () => {
  it('posts Chat Completions with the key, site headers, usage on and the JSON schema in OpenAI form', () => {
    const schema = { type: 'object' };
    expect(orBody(MODEL, { ...IN, response_format: { type: 'json_schema', json_schema: schema } }, true))
      .toEqual({ model: MODEL, messages: IN.messages, max_tokens: 40, usage: { include: true }, stream: true, response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: false, schema } } });
    expect(orBody(MODEL, IN)).not.toHaveProperty('stream');
    expect(orHeaders({ OPENROUTER_SITE_URL: 'https://site.example' }, KEY)).toMatchObject({ authorization: `Bearer ${KEY}`, 'x-title': 'Well Ads', 'http-referer': 'https://site.example' });
    expect(orHeaders({ OPENROUTER_SITE_URL: 'http://plain.example' }, KEY)).not.toHaveProperty('http-referer');
    expect(orHeaders({ OPENROUTER_SITE_URL: 'https://مثال.example' }, KEY)).not.toHaveProperty('http-referer');   // headers hold no Arabic
  });
  it('reads the text of a string or a parts reply', () => {
    expect(orText({ choices: [{ message: { content: 'أ' } }] })).toBe('أ');
    expect(orText({ choices: [{ message: { content: [{ type: 'text', text: 'ب' }, { type: 'text', text: 'ج' }] } }] })).toBe('بج');
    expect(orText(null)).toBe('');
  });
});

describe('generate on OpenRouter', () => {
  it('a routed task calls OpenRouter, says so, and records tokens and the cost OpenRouter returned', async () => {
    route('copy');
    const out = await settle(() => generate(OR, 'copy', IN, undefined, ctx()));
    expect(out).toEqual({ response: 'نص من OpenRouter', engine: 'openrouter', model: MODEL });
    const c = orCalls()[0]!;
    expect(c.headers['authorization']).toBe(`Bearer ${KEY}`);
    expect(c.body).toMatchObject({ model: MODEL, messages: IN.messages, usage: { include: true } });
    expect(usageRows()).toEqual([expect.objectContaining({ company_id: CO, module: 'copy', provider: 'openrouter', model: MODEL, tokens_in: 100, tokens_out: 50, cost_usd: 0.00123, cost_sar: 0.004613, priced: true, estimated: false })]);
    expect(JSON.stringify(calls.filter(x => x.url.includes('/ai_usage')))).not.toContain('اكتب');   // never the prompt
  });
  it('a reply without a cost is recorded as unpriced, never as free', async () => {
    route('copy'); orReply = () => okJson('x', { prompt_tokens: 10, completion_tokens: 5 });
    await settle(() => generate(OR, 'copy', IN, undefined, ctx()));
    expect(usageRows()[0]).toMatchObject({ provider: 'openrouter', cost_usd: 0, priced: false });
  });
  it('the route is per company and per task: another company, or another task, stays on its own provider', async () => {
    route('copy'); route('social', 'openrouter', 'meta-llama/llama-4:free', OTHER);
    expect((await settle(() => generate(OR, 'social', IN, async () => okJson2(), ctx()))).engine).toBe('xai');
    expect((await settle(() => generate(OR, 'copy', IN, async () => okJson2(), ctx(OTHER)))).engine).toBe('openai');
    expect(orCalls()).toHaveLength(0);
  });
  it('a call without a user (cron) is not routed: the default provider answers', async () => {
    route('copy');
    expect((await generate(OR, 'copy', IN, async () => okJson2())).engine).toBe('openai');
  });
  it('the task key is the tab it is billed to: the compliance rewrite follows «compliance», not «content»', async () => {
    route('compliance');
    expect((await settle(() => generate(OR, 'content', IN, undefined, ctx(CO, 'compliance')))).engine).toBe('openrouter');
    expect((await settle(() => generate(OR, 'content', IN, async () => okJson2(), ctx()))).engine).toBe('openai');
  });
  it('the monthly cap applies: a spent tab goes to Workers AI, not to OpenRouter', async () => {
    route('copy'); caps = [{ module: 'copy', monthly_cap_usd: 1, alert_at_pct: 80 }]; spend = [{ module: 'copy', cost_usd: 2 }];
    const AI = workersAi();
    expect((await settle(() => generate({ ...OR, AI }, 'copy', IN, undefined, ctx()))).engine).toBe('workers');
    expect(orCalls()).toHaveLength(0);
    await expect(generate(OR, 'copy', IN, undefined, ctx())).rejects.toThrow('cap_reached');
  });
  it('with the key missing the task keeps its current provider, quietly', async () => {
    route('copy');
    expect((await settle(() => generate({ OPENAI_API_KEY: 'o' }, 'copy', IN, async () => okJson2(), ctx()))).engine).toBe('openai');
  });
  it('an error or a timeout falls back to Workers AI; the status goes to the log and the body never does', async () => {
    route('copy');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    orReply = () => new Response(JSON.stringify({ error: { message: 'SECRET-ECHO اكتب' } }), { status: 402 });
    expect((await settle(() => generate({ ...OR, AI: workersAi() }, 'copy', IN, undefined, ctx()))).engine).toBe('workers');
    expect(warn).toHaveBeenCalledWith('llm_failed', 'openrouter', 402);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET-ECHO');
    const slow = (() => { const e = new Error('timed out'); e.name = 'TimeoutError'; throw e; }) as unknown as typeof fetch;
    expect((await generate({ ...OR, AI: workersAi() }, 'copy', IN, slow, ctx())).engine).toBe('workers');
  });
  it('without Workers AI the failure is a code the user gets as a plain Arabic sentence', async () => {
    route('copy'); vi.spyOn(console, 'warn').mockImplementation(() => {});
    orReply = () => new Response('x', { status: 429 });
    const err = (await generate(OR, 'copy', IN, undefined, ctx()).catch(x => x)) as Error;
    expect(err.message).toBe('llm_busy');
    expect(llmMessage(err)).toBe('الخدمة مشغولة الحين، جرّب بعد دقيقة.');
    expect(llmMessage(new Error('llm_failed'))).toMatch(/^[؀-ۿ\s،.]+$/);
    expect(llmMessage(new Error('cap_reached'))).toContain('سقفه');
  });
  it('an empty answer falls back too', async () => {
    route('copy'); orReply = () => okJson('   ');
    expect((await settle(() => generate({ ...OR, AI: workersAi() }, 'copy', IN, undefined, ctx()))).engine).toBe('workers');
  });
});
const okJson2 = () => new Response(JSON.stringify({ output_text: 'من المزوّد الافتراضي' }));

describe('stream on OpenRouter', () => {
  const sseReply = (parts: string[]) => { orReply = () => new Response(body(parts)); };
  it('streams deltas, ignores keep-alive comments, and records the cost from the usage chunk', async () => {
    route('copy');
    sseReply([': OPENROUTER PROCESSING\n\n', chunk({ choices: [{ delta: { content: 'مر' } }] }), chunk({ choices: [{ delta: { content: 'حبا' } }] }), chunk({ choices: [{ delta: { content: '' }, finish_reason: 'stop' }] }),
      chunk({ choices: [], usage: { prompt_tokens: 20, completion_tokens: 8, cost: 0.0005 } }), 'data: [DONE]\n\n']);
    const got = await settle(() => drain(stream(OR, 'copy', IN, undefined, undefined, ctx())));
    expect(got).toEqual([{ type: 'delta', text: 'مر' }, { type: 'delta', text: 'حبا' }, { type: 'done', response: 'مرحبا', engine: 'openrouter', model: MODEL, usage: { in: 20, out: 8 } }]);
    expect(orCalls()[0]!.body).toMatchObject({ stream: true, usage: { include: true } });
    expect(usageRows()[0]).toMatchObject({ provider: 'openrouter', tokens_in: 20, tokens_out: 8, cost_usd: 0.0005, priced: true, estimated: false });
  });
  it('an error chunk mid-stream resets and Workers AI starts over; the partial cost is still recorded as an estimate', async () => {
    route('copy'); vi.spyOn(console, 'warn').mockImplementation(() => {});
    sseReply([chunk({ choices: [{ delta: { content: 'نص ناقص' } }] }), chunk({ error: { message: 'upstream' }, choices: [{ delta: { content: '' }, finish_reason: 'error' }] })]);
    const AI = { run: vi.fn(async () => body([`data: ${JSON.stringify({ response: 'كامل' })}\n\n`])) } as unknown as NonNullable<LlmEnv['AI']>;
    const got = await settle(() => drain(stream({ ...OR, AI }, 'copy', IN, undefined, undefined, ctx())));
    expect(got.map(x => x.type)).toEqual(['delta', 'reset', 'delta', 'done']);
    expect(usageRows().map(r => [r['provider'], r['estimated']])).toEqual([['openrouter', true], ['workers', false]]);
  });
  it('a stream cut before it finished is an error without a fallback', async () => {
    route('copy'); vi.spyOn(console, 'warn').mockImplementation(() => {});
    sseReply([chunk({ choices: [{ delta: { content: 'نص' } }] })]);
    expect(await settle(() => drain(stream(OR, 'copy', IN, undefined, undefined, ctx())))).toEqual([{ type: 'delta', text: 'نص' }, { type: 'error', message: 'llm_failed' }]);
  });
  it('a failed start (HTTP error) goes straight to Workers AI', async () => {
    route('copy'); vi.spyOn(console, 'warn').mockImplementation(() => {});
    orReply = () => new Response('x', { status: 503 });
    const AI = { run: vi.fn(async () => body([`data: ${JSON.stringify({ response: 'من المجاني' })}\n\n`])) } as unknown as NonNullable<LlmEnv['AI']>;
    const got = await drain(stream({ ...OR, AI }, 'copy', IN, undefined, undefined, ctx()));
    expect(got.at(-1)).toMatchObject({ type: 'done', engine: 'workers' });
  });
});

describe('Debugger on OpenRouter', () => {
  it('viaOpenRouter is true only for a routed task with its key, and the plan comes from OpenRouter without the free fallback', async () => {
    expect(await viaOpenRouter(OR, 'debugger', ctx())).toBe(false);
    route('debugger'); clearRoutes();   // the routes are cached for a minute
    expect(await viaOpenRouter(OR, 'debugger', ctx())).toBe(true);
    expect(await viaOpenRouter({ OPENAI_API_KEY: 'o' }, 'debugger', ctx())).toBe(false);
    orReply = () => okJson('1. افتح الشاشة');
    const r = await settle(() => explainViaOpenRouter({ ...OR, AI: workersAi() }, [], {}, ctx(CO, 'debugger'), undefined));
    expect(r).toEqual({ text: '1. افتح الشاشة', model: MODEL });
    orReply = () => new Response('x', { status: 500 }); vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(explainViaOpenRouter({ ...OR, AI: workersAi() }, [], {}, ctx(CO, 'debugger'))).rejects.toThrow();   // caller goes back to Claude
  });
});

describe('/api/maestro/models (owner only)', () => {
  const owner = { id: '33333333-3333-3333-3333-333333333333', email: 'boss@example.com', role: 'owner', active: true, company_id: CO } as A.Profile;
  const member = { id: '44444444-4444-4444-4444-444444444444', email: 'm@example.com', role: 'member', active: true, access: { maestro: 'approve' }, company_id: CO } as A.Profile;
  const call = async (h: (r: Request, e: A.AuthEnv) => Response | Promise<Response>, who: A.Profile, b?: unknown, env: Record<string, unknown> = {}) => {
    profile = who;
    return h(new Request('https://well.example/api/maestro/models', { method: b === undefined ? 'GET' : 'POST', ...(b === undefined ? {} : { body: JSON.stringify(b) }),
      headers: { cookie: `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(who, cfg), cfg.secret))}`, origin: 'https://well.example', 'sec-fetch-site': 'same-origin' } }), { ...SB, ...env } as A.AuthEnv);
  };
  const M = ROUTES.maestro.models;
  type State = { providers: { key: string; on: boolean }[]; tasks: { task: string; default: string; route: unknown; using: string | null; model: string }[] };

  it('a member, even with approve on the Manager tab, gets 403 and nothing is written', async () => {
    expect((await call(M.GET!, member)).status).toBe(403);
    expect((await call(M.POST!, member, { task: 'copy', provider: 'openrouter', model: MODEL }, { OPENROUTER_API_KEY: KEY })).status).toBe(403);
    expect(calls.some(c => c.url.includes('/ai_routes') && c.method !== 'GET')).toBe(false);
  });
  it('without the key OpenRouter shows as off, cannot be chosen, and no task uses it', async () => {
    const j = await (await call(M.GET!, owner, undefined, { OPENAI_API_KEY: 'o' })).json() as State;
    expect(j.providers.find(p => p.key === 'openrouter')!.on).toBe(false);
    expect(j.tasks.find(t => t.task === 'copy')).toMatchObject({ default: 'openai', route: null, using: 'openai' });
    expect(j.tasks.find(t => t.task === 'debugger')).toMatchObject({ default: 'anthropic', using: null });
    expect((await call(M.POST!, owner, { task: 'copy', provider: 'openrouter', model: MODEL }, { OPENAI_API_KEY: 'o' })).status).toBe(409);
    expect(JSON.stringify(j)).not.toContain(KEY);
  });
  it('with the key it saves one task for the owner\'s company, audited, and rejects bad input', async () => {
    const env = { OPENROUTER_API_KEY: KEY };
    expect((await call(M.POST!, owner, { task: 'copy', provider: 'openrouter', model: MODEL }, env)).status).toBe(200);
    const w = calls.find(c => c.url.includes('/ai_routes') && c.method === 'POST')!;
    expect(w.body).toMatchObject({ company_id: CO, task: 'copy', provider: 'openrouter', model: MODEL, updated_by: 'boss@example.com' });
    expect(calls.some(c => c.url.includes('/audit_log') && (c.body as { action: string }).action === 'ai_route_set')).toBe(true);
    for (const bad of [{ task: 'nope', provider: 'openrouter', model: MODEL }, { task: 'copy', provider: 'openrouter', model: '' }, { task: 'copy', provider: 'openrouter', model: 'gpt-5' },
      { task: 'copy', provider: 'openrouter', model: 'a/b c' }, { task: 'copy', provider: 'anthropic', model: 'x' }]) expect((await call(M.POST!, owner, bad, env)).status).toBe(400);
  });
  it('clearing a task deletes only that task of the owner\'s company', async () => {
    expect((await call(M.POST!, owner, { task: 'copy', provider: '' })).status).toBe(200);
    const d = calls.find(c => c.url.includes('/ai_routes') && c.method === 'DELETE')!;
    expect(d.url).toContain('task=eq.copy'); expect(d.url).toContain(`company_id=eq.${CO}`);
  });
  it('after a route is saved the owner sees what each task runs on now', async () => {
    route('social'); route('debugger');
    const j = await (await call(M.GET!, owner, undefined, { OPENROUTER_API_KEY: KEY, XAI_API_KEY: 'x', ANTHROPIC_API_KEY: 'a' })).json() as State;
    expect(j.tasks.find(t => t.task === 'social')).toMatchObject({ using: 'openrouter', model: MODEL, route: { provider: 'openrouter', model: MODEL } });
    expect(j.tasks.find(t => t.task === 'debugger')).toMatchObject({ using: 'openrouter' });
    expect(j.tasks.find(t => t.task === 'overview')).toMatchObject({ using: 'anthropic' });
  });
  it('a missing table (migration not applied) changes nothing: tasks keep their provider', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url === OR_URL ? okJson('x') : url.includes('/ai_routes') ? new Response(JSON.stringify({ code: '42P01' }), { status: 404 }) : new Response('[]')));
    expect((await generate(OR, 'copy', IN, async () => okJson2(), ctx())).engine).toBe('openai');
  });
});
