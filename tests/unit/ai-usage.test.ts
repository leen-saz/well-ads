// AI cost tracking: the price maths, recording, the monthly cap (alert at 80%, Workers AI at 100%), company isolation,
// the owner-only routes and the invoice check. Synthetic data only: fake companies, fake users, made-up token counts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { generate, stream, type LlmEnv, type StreamEvent } from '../../src/lib/llm';
import { DEFAULT_CAP_USD, cost, monthStart, record, clearSnaps, levelOf, reconcile, withWaiter, USD_SAR, type UsageCtx } from '../../src/lib/usage';
import { priceOf } from '../../src/lib/prices';
import { ROUTES } from '../../src/modules/routes';
import { WELL_COMPANY } from '../../src/lib/tenant';

const CO_A = '11111111-1111-1111-1111-111111111111', CO_B = '22222222-2222-2222-2222-222222222222';
const E: A.AuthEnv = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'boss@example.com' };
const cfg = A.env(E);
const ctx = (co = CO_A, uid: string | null = 'u-1', tab?: string): UsageCtx => ({ cfg, co, uid, ...(tab ? { tab } : {}) });

type Call = { url: string; method: string; body: unknown };
let only: string | null, calls: Call[], caps: { module: string; monthly_cap_usd: number | null; alert_at_pct: number }[], spend: { module: string; cost_usd: number }[], profile: A.Profile | null;
const insertedUsage = () => calls.filter(c => c.url.includes('/ai_usage') && c.method === 'POST').map(c => c.body as Record<string, unknown>);
const audits = () => calls.filter(c => c.url.includes('/audit_log')).map(c => (c.body as { action: string }).action);

beforeEach(() => {
  only = null; calls = []; caps = []; spend = []; profile = null; clearSnaps();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: init.method || 'GET', body });
    if (url.includes('/profiles?id=eq.')) return new Response(JSON.stringify(profile ? [profile] : []));
    if (url.includes('/rpc/ai_spend_provider')) return new Response(JSON.stringify([{ calls: 4, cost_usd: 100, unpriced: 0 }]));
    if (url.includes('/rpc/ai_spend')) return new Response(JSON.stringify((only && body?.p_company !== only ? [] : spend).map(s => ({ month: '2026-11', calls: 1, tokens_in: 1, tokens_out: 1, cost_sar: s.cost_usd * 3.75, unpriced: 0, ...s }))));
    if (url.includes('/ai_budgets') && (init.method || 'GET') === 'GET') return new Response(JSON.stringify(only && !url.includes(`company_id=eq.${only}`) ? [] : caps));
    if (url.includes('api.openai.com')) return new Response(JSON.stringify({ output_text: 'نص تجريبي', usage: { input_tokens: 1000, output_tokens: 500 } }));
    return new Response('[]');
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const settle = async (run: () => Promise<unknown>) => { const jobs: Promise<unknown>[] = []; const out = await withWaiter(p => jobs.push(p), run); await Promise.all(jobs); return out; };
const IN = { messages: [{ role: 'user', content: 'PROMPT-SECRET نص الطلب' }], max_tokens: 50 };
const withKey: LlmEnv = { OPENAI_API_KEY: 'k' };
const workersAi = () => ({ run: vi.fn(async () => ({ response: 'من المجاني', usage: { prompt_tokens: 7, completion_tokens: 3 } })) }) as unknown as NonNullable<LlmEnv['AI']>;

describe('price maths', () => {
  it('cost is tokens × price per million, in USD, then SAR at the peg', () => {
    expect(cost('openai', 'gpt-6.1-sol', 1_000_000, 1_000_000)).toEqual({ usd: 12.5, sar: 46.875, priced: true });
    expect(cost('xai', 'grok-4.7', 2000, 1000).usd).toBeCloseTo(0.021, 6);
    expect(cost('openai', 'gpt-6.1-sol', 0, 0)).toEqual({ usd: 0, sar: 0, priced: true });
    expect(USD_SAR).toBe(3.75);
  });
  it('Workers AI is free; a model with no price row is flagged, not silently free', () => {
    expect(cost('workers', '@cf/meta/llama', 5000, 5000)).toEqual({ usd: 0, sar: 0, priced: true });
    expect(cost('openai', 'mystery-model', 1000, 1000)).toEqual({ usd: 0, sar: 0, priced: false });
  });
  it('the longest matching prefix wins, and every price says where it came from and that it is unverified', () => {
    const p = priceOf('openai', 'gpt-6.1-sol-2026-11-01')!;
    expect(p.match).toBe('gpt-6.1');
    expect(p.source).toMatch(/\./); expect(p.date).toMatch(/^\d{4}-\d\d-\d\d$/); expect(p.verified).toBe(false);
  });
  it('the month starts at midnight Riyadh time (UTC+3)', () => {
    expect(monthStart(Date.parse('2026-10-31T22:30:00Z'))).toBe('2026-10-31T21:00:00.000Z');   // already 1 Nov in Riyadh
    expect(monthStart(Date.parse('2026-11-15T10:00:00Z'))).toBe('2026-10-31T21:00:00.000Z');
    expect(monthStart(Date.parse('2026-11-15T10:00:00Z'), 1)).toBe('2026-09-30T21:00:00.000Z');
  });
});

describe('recording', () => {
  it('writes one row with counts, cost, tab, provider, model and the user id: no prompt, no answer, no email', async () => {
    const out = await settle(() => generate(withKey, 'copy', IN, undefined, ctx()));
    expect((out as { response: string }).response).toBe('نص تجريبي');
    const rows = insertedUsage();
    expect(rows).toEqual([{ company_id: CO_A, user_id: 'u-1', module: 'copy', provider: 'openai', model: 'gpt-6.1-sol', tokens_in: 1000, tokens_out: 500, cost_usd: 0.0075, cost_sar: 0.028125, usd_sar: 3.75, priced: true, estimated: false }]);
    const all = JSON.stringify(calls.filter(c => !c.url.includes('api.openai.com')).map(c => c.body));
    expect(all).not.toContain('PROMPT-SECRET'); expect(all).not.toContain('نص تجريبي'); expect(all).not.toContain('@');
  });
  it('a tab override and the motion plan are billed to the right tab', async () => {
    await settle(() => generate(withKey, 'content', IN, undefined, ctx(CO_A, 'u-1', 'compliance')));
    await settle(() => generate(withKey, 'design', IN, undefined, ctx()));
    expect(insertedUsage().map(r => r.module)).toEqual(['compliance', 'design']);
    clearSnaps();
    await settle(() => generate({ AI: workersAi() }, 'motion', IN, undefined, ctx()));
    expect(insertedUsage().at(-1)).toMatchObject({ module: 'design', provider: 'workers', cost_usd: 0, tokens_in: 7, tokens_out: 3 });
  });
  it('streaming records the same row from the final usage event', async () => {
    const enc = new TextEncoder();
    const ev = (o: unknown) => enc.encode(`data: ${JSON.stringify(o)}\n\n`);
    const f = (async () => new Response(new ReadableStream({ start(c) { c.enqueue(ev({ type: 'response.output_text.delta', delta: 'مرحبا' })); c.enqueue(ev({ type: 'response.completed', response: { usage: { input_tokens: 200, output_tokens: 100 } } })); c.close(); } }))) as unknown as typeof fetch;
    await settle(async () => { const got: StreamEvent[] = []; for await (const x of stream(withKey, 'copy', IN, f, undefined, ctx())) got.push(x); return got; });
    expect(insertedUsage()).toMatchObject([{ company_id: CO_A, module: 'copy', tokens_in: 200, tokens_out: 100 }]);
  });
  describe('a stream that is cut still costs what it wrote', () => {
    const enc = new TextEncoder();
    const ev = (o: unknown) => enc.encode(`data: ${JSON.stringify(o)}\n\n`);
    const provider = (parts: unknown[], then: 'open' | 'fail' | 'close') => (async () => {
      const q = [...parts];
      return new Response(new ReadableStream<Uint8Array>({ pull(c) { const x = q.shift(); if (x !== undefined) c.enqueue(ev(x)); else if (then === 'fail') c.error(new Error('cut')); else if (then === 'close') c.close(); } }));
    }) as unknown as typeof fetch;
    const D = { type: 'response.output_text.delta', delta: 'abcdefghi' };   // 9 characters → 3 tokens
    const drain = async (g: AsyncGenerator<StreamEvent>) => { for await (const x of g) void x; };

    it('a connection cut after some text records an estimated row from what arrived', async () => {
      await settle(() => drain(stream(withKey, 'copy', IN, provider([D], 'fail'), undefined, ctx())));
      expect(insertedUsage()).toMatchObject([{ company_id: CO_A, module: 'copy', provider: 'openai', estimated: true, tokens_out: 3 }]);
      expect((insertedUsage()[0]!.tokens_in as number)).toBeGreaterThan(0);
    });
    it('a reader that leaves after the first words (stop button, closed tab) records the same, once', async () => {
      await settle(async () => { const g = stream(withKey, 'copy', IN, provider([D], 'open'), undefined, ctx()); await g.next(); await g.return(undefined); });
      expect(insertedUsage()).toMatchObject([{ estimated: true, tokens_out: 3 }]);
    });
    it('real usage from the provider is used as is, and is not marked estimated', async () => {
      await settle(() => drain(stream(withKey, 'copy', IN, provider([D, { type: 'response.completed', response: { usage: { input_tokens: 50, output_tokens: 20 } } }], 'close'), undefined, ctx())));
      expect(insertedUsage()).toMatchObject([{ estimated: false, tokens_in: 50, tokens_out: 20 }]);
    });
    it('a request the provider refused costs nothing and records nothing for it', async () => {
      const f = (async () => new Response('x', { status: 500 })) as unknown as typeof fetch;
      await settle(() => drain(stream({ ...withKey, AI: workersAi() }, 'copy', IN, f, undefined, ctx())));
      expect(insertedUsage().map(r => r.provider)).toEqual(['workers']);
    });
  });
  it('never breaks the call: a failing insert or a thrown error is swallowed, and nothing is recorded without a context', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { if (url.includes('api.openai.com')) return new Response(JSON.stringify({ output_text: 'ok' })); if (url.includes('/ai_usage')) throw new Error('db down'); return new Response('[]'); }));
    expect((await settle(() => generate(withKey, 'copy', IN, undefined, ctx()))) as { response: string }).toMatchObject({ response: 'ok' });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { calls.push({ url, method: 'x', body: null }); return new Response(JSON.stringify({ output_text: 'ok' })); }));
    calls = []; await generate(withKey, 'copy', IN);
    expect(calls.filter(c => !c.url.includes('openai'))).toEqual([]);
  });
  it('logs no cost or total anywhere', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(k => vi.spyOn(console, k).mockImplementation(() => {}));
    caps = [{ module: 'copy', monthly_cap_usd: 0.01, alert_at_pct: 80 }];
    await settle(() => generate(withKey, 'copy', IN, undefined, ctx()));
    expect(spies.flatMap(s => s.mock.calls)).toEqual([]);
  });
});

describe('monthly cap', () => {
  it('under the cap the tab keeps its own provider; at the cap it moves to Workers AI and says so in the record', async () => {
    caps = [{ module: 'copy', monthly_cap_usd: 10, alert_at_pct: 80 }];
    spend = [{ module: 'copy', cost_usd: 9.99 }];
    const ai = workersAi();
    expect(((await settle(() => generate({ ...withKey, AI: ai }, 'copy', IN, undefined, ctx()))) as { engine: string }).engine).toBe('openai');
    clearSnaps(); spend = [{ module: 'copy', cost_usd: 10 }];
    calls = [];
    const out = await settle(() => generate({ ...withKey, AI: ai }, 'copy', IN, undefined, ctx())) as { engine: string };
    expect(out.engine).toBe('workers');
    expect(calls.some(c => c.url.includes('api.openai.com'))).toBe(false);
    expect(insertedUsage().at(-1)).toMatchObject({ provider: 'workers', cost_usd: 0 });
  });
  it('another tab with its own spend, or a cap on another tab, does not switch this one', async () => {
    caps = [{ module: 'social', monthly_cap_usd: 1, alert_at_pct: 80 }];
    spend = [{ module: 'social', cost_usd: 5 }, { module: 'copy', cost_usd: 4 }];   // 4 is under the default cap
    const out = await settle(() => generate({ ...withKey, AI: workersAi() }, 'copy', IN, undefined, ctx())) as { engine: string };
    expect(out.engine).toBe('openai');
  });
  it('empty means no limit only when the owner saved it: a row with a null cap never switches', async () => {
    caps = [{ module: 'copy', monthly_cap_usd: null, alert_at_pct: 80 }];
    spend = [{ module: 'copy', cost_usd: 1e6 }];
    expect(((await settle(() => generate({ ...withKey, AI: workersAi() }, 'copy', IN, undefined, ctx()))) as { engine: string }).engine).toBe('openai');
    expect(levelOf(1e6, undefined)).toBe('ok');
  });
  it('no row at all is NOT unlimited: the default cap applies until the owner sets one', async () => {
    spend = [{ module: 'copy', cost_usd: DEFAULT_CAP_USD - 0.01 }];
    expect(((await settle(() => generate({ ...withKey, AI: workersAi() }, 'copy', IN, undefined, ctx()))) as { engine: string }).engine).toBe('openai');
    clearSnaps(); spend = [{ module: 'copy', cost_usd: DEFAULT_CAP_USD }];
    expect(((await settle(() => generate({ ...withKey, AI: workersAi() }, 'copy', IN, undefined, ctx()))) as { engine: string }).engine).toBe('workers');
    // and the owner raises it with a row
    clearSnaps(); caps = [{ module: 'copy', monthly_cap_usd: DEFAULT_CAP_USD * 10, alert_at_pct: 80 }];
    expect(((await settle(() => generate({ ...withKey, AI: workersAi() }, 'copy', IN, undefined, ctx()))) as { engine: string }).engine).toBe('openai');
  });
  it('without Workers AI a spent tab stops (cap_reached) instead of spending more; streaming says the same', async () => {
    caps = [{ module: 'copy', monthly_cap_usd: 1, alert_at_pct: 80 }]; spend = [{ module: 'copy', cost_usd: 2 }];
    await expect(generate(withKey, 'copy', IN, undefined, ctx())).rejects.toThrow('cap_reached');
    const got: StreamEvent[] = []; for await (const x of stream(withKey, 'copy', IN, fetch, undefined, ctx())) got.push(x);
    expect(got).toEqual([{ type: 'error', message: 'cap_reached' }]);
  });
  it('reads the caps and the month once a minute per company, not once per model call', async () => {
    caps = [{ module: 'copy', monthly_cap_usd: 100, alert_at_pct: 80 }];
    for (let i = 0; i < 6; i++) await settle(() => generate(withKey, 'copy', IN, undefined, ctx()));
    expect(calls.filter(c => c.url.includes('/rpc/ai_spend')).length).toBe(1);
    expect(calls.filter(c => c.url.includes('/ai_budgets')).length).toBe(1);
    await settle(() => generate(withKey, 'copy', IN, undefined, ctx(CO_B)));   // another company reads its own
    expect(calls.filter(c => c.url.includes('/rpc/ai_spend')).length).toBe(2);
  });
  it('a missing table or a failed read fails closed: the paid provider is not called (Workers AI answers, or it stops)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('api.openai.com') ? new Response(JSON.stringify({ output_text: 'ok' })) : new Response(JSON.stringify({ code: '42P01' }), { status: 404 })));
    expect(((await settle(() => generate({ ...withKey, AI: workersAi() }, 'copy', IN, undefined, ctx()))) as { engine: string }).engine).toBe('workers');
    clearSnaps();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { if (url.includes('api.openai.com')) return new Response(JSON.stringify({ output_text: 'ok' })); throw new Error('db down'); }));
    await expect(generate(withKey, 'copy', IN, undefined, ctx())).rejects.toThrow('cap_reached');
  });
  it('alert level: ok below the alert, alert from 80%, capped from 100%', () => {
    const cap = { usd: 10, pct: 80 };
    expect([7.99, 8, 9.99, 10, 12].map(s => levelOf(s, cap))).toEqual(['ok', 'alert', 'alert', 'capped', 'capped']);
  });
  it('records the alert once at 80% and once at 100% in the audit log, with no amounts', async () => {
    caps = [{ module: 'copy', monthly_cap_usd: 0.01, alert_at_pct: 50 }];
    spend = [{ module: 'copy', cost_usd: 0.004 }];
    await settle(() => generate({ ...withKey, AI: workersAi() }, 'copy', IN, undefined, ctx()));   // +0.0075 → 0.0115 ≥ 100%
    await settle(() => generate({ ...withKey, AI: workersAi() }, 'copy', IN, undefined, ctx()));   // now on Workers AI: no second alert
    expect(audits()).toEqual(['ai_budget_alert', 'ai_budget_capped']);
    expect(JSON.stringify(calls.filter(c => c.url.includes('/audit_log')).map(c => c.body))).not.toMatch(/0\.0/);
  });
});

describe('company isolation', () => {
  it('rows and reads carry the caller\'s company only', async () => {
    caps = [{ module: 'copy', monthly_cap_usd: 1, alert_at_pct: 80 }];
    await settle(() => generate(withKey, 'copy', IN, undefined, ctx(CO_B, 'u-b')));
    expect(insertedUsage()).toMatchObject([{ company_id: CO_B, user_id: 'u-b' }]);
    expect(calls.find(c => c.url.includes('/ai_budgets'))!.url).toContain(`company_id=eq.${CO_B}`);
    expect(calls.find(c => c.url.includes('/rpc/ai_spend'))!.body).toMatchObject({ p_company: CO_B });
    expect(JSON.stringify(calls)).not.toContain(CO_A);
  });
  it('company A\'s cap and spend do not switch company B (the fake database answers per company, like the real one)', async () => {
    only = CO_A;
    caps = [{ module: 'copy', monthly_cap_usd: 1, alert_at_pct: 80 }]; spend = [{ module: 'copy', cost_usd: 5 }];
    expect(await overFor(CO_A)).toBe('workers');
    expect(await overFor(CO_B)).toBe('openai');
  });
  async function overFor(co: string) { return ((await settle(() => generate({ ...withKey, AI: workersAi() }, 'copy', IN, undefined, ctx(co)))) as { engine: string }).engine; }
});

describe('owner-only routes', () => {
  const owner: A.Profile = { id: '33333333-3333-3333-3333-333333333333', email: 'boss@example.com', role: 'owner', active: true, company_id: CO_B } as A.Profile;
  const member: A.Profile = { id: '44444444-4444-4444-4444-444444444444', email: 'm@example.com', role: 'member', active: true, access: { maestro: 'approve' }, company_id: CO_B } as A.Profile;
  const call = async (h: (r: Request, e: A.AuthEnv) => Response | Promise<Response>, who: A.Profile, body?: unknown, path = '/api/maestro/usage') => {
    profile = who;
    const s = A.sessionFor(who, cfg);
    return h(new Request('https://well.example' + path, { method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: { cookie: `${A.SESSION}=${encodeURIComponent(await A.sign(s, cfg.secret))}`, origin: 'https://well.example', 'sec-fetch-site': 'same-origin' } }), E);
  };
  const M = ROUTES.maestro;

  it('a member, even with approve on the Manager tab, cannot see the spend, set a cap or run the check', async () => {
    expect((await call(M.usage.GET, member)).status).toBe(403);
    expect((await call(M.budgets.POST, member, { tab: 'copy', cap_sar: 100 })).status).toBe(403);
    expect((await call(M.reconcile.POST, member, { provider: 'openai', month: '2026-11', invoice_usd: 5 })).status).toBe(403);
    expect(calls.some(c => c.url.includes('/ai_budgets') && c.method === 'POST')).toBe(false);
  });
  it('the owner sees spend per tab and month in riyals and dollars, scoped to the owner\'s company', async () => {
    spend = [{ module: 'copy', cost_usd: 2 }, { module: 'social', cost_usd: 1 }];
    caps = [{ module: 'copy', monthly_cap_usd: 2.5, alert_at_pct: 80 }];
    const r = await call(M.usage.GET, owner);
    expect(r.status).toBe(200);
    const j = await r.json() as { tabs: { tab: string; usd: number; sar: number; cap_sar: number | null; level: string }[]; total: { usd: number; sar: number }; rate: number };
    expect(j.rate).toBe(3.75);
    expect(j.total).toEqual({ usd: 3, sar: 11.25 });
    expect(j.tabs.find(t => t.tab === 'copy')).toMatchObject({ usd: 2, sar: 7.5, cap_sar: 9.38, level: 'alert' });
    expect(j.tabs.find(t => t.tab === 'social')).toMatchObject({ usd: 1, cap_sar: 18.75, level: 'ok' });   // no row: the default cap, shown so the owner can raise it
    expect(calls.find(c => c.url.includes('/rpc/ai_spend'))!.body).toMatchObject({ p_company: CO_B });
    expect(calls.find(c => c.url.includes('/ai_budgets'))!.url).toContain(`company_id=eq.${CO_B}`);
  });
  it('a cap is typed in riyals, stored in dollars for the owner\'s company, audited; empty clears it', async () => {
    expect((await call(M.budgets.POST, owner, { tab: 'copy', cap_sar: 75 })).status).toBe(200);
    const w = calls.find(c => c.url.includes('/ai_budgets') && c.method === 'POST')!;
    expect(w.body).toMatchObject({ company_id: CO_B, module: 'copy', monthly_cap_usd: 20, alert_at_pct: 80 });
    expect(audits()).toContain('ai_budget_set');
  });
  it('another company\'s owner cannot clear the cap or raise it past the ceiling; Well\'s owner can do both (the model keys are Well\'s)', async () => {
    calls = [];
    expect((await call(M.budgets.POST, owner, { tab: 'copy', cap_sar: '' })).status).toBe(403);
    expect((await call(M.budgets.POST, owner, { tab: 'copy', cap_sar: 375 })).status).toBe(403);
    expect((await call(M.budgets.POST, owner, { tab: 'copy', cap_sar: 200 })).status).toBe(200);   // the ceiling itself is allowed
    expect(calls.filter(c => c.url.includes('/ai_budgets') && c.method === 'POST')).toHaveLength(1);
    const well = { ...owner, company_id: WELL_COMPANY } as A.Profile;
    calls = [];
    expect((await call(M.budgets.POST, well, { tab: 'copy', cap_sar: 375 })).status).toBe(200);
    expect((await call(M.budgets.POST, well, { tab: 'copy', cap_sar: '' })).status).toBe(200);
    expect(calls.filter(c => c.url.includes('/ai_budgets') && c.method === 'POST').pop()!.body).toMatchObject({ company_id: WELL_COMPANY, monthly_cap_usd: null });
    expect(audits()).toContain('ai_budget_cleared');
  });
  it('rejects a tab that does not exist, a cap of zero or below, and an alert outside 1–99', async () => {
    expect((await call(M.budgets.POST, owner, { tab: 'nope', cap_sar: 5 })).status).toBe(400);
    expect((await call(M.budgets.POST, owner, { tab: 'copy', cap_sar: 0 })).status).toBe(400);
    expect((await call(M.budgets.POST, owner, { tab: 'copy', cap_sar: -3 })).status).toBe(400);
    expect((await call(M.budgets.POST, owner, { tab: 'copy', cap_sar: 'abc' })).status).toBe(400);
    expect((await call(M.budgets.POST, owner, { tab: 'copy', cap_sar: 5, alert_pct: 100 })).status).toBe(400);
  });
  it('the invoice check compares the recorded USD with the typed figure and says if it is within 5%', async () => {
    const r = await call(M.reconcile.POST, owner, { provider: 'openai', month: '2026-11', invoice_usd: 104 });
    const j = await r.json() as { ok: boolean; diff_pct: number; recorded_usd: number; calls: number; notes: string[] };
    expect(j).toMatchObject({ recorded_usd: 100, ok: true, diff_pct: -3.85, calls: 4 });
    const q = calls.find(c => c.url.includes('/rpc/ai_spend_provider'))!.body as Record<string, string>;
    expect(q).toMatchObject({ p_company: CO_B, p_provider: 'openai', p_from: '2026-10-31T21:00:00.000Z', p_to: '2026-11-30T21:00:00.000Z' });
    expect(j.notes.length).toBeGreaterThan(0);
    expect(audits()).toContain('ai_reconciled');
    expect((await call(M.reconcile.POST, owner, { provider: 'anthropic', month: '2026-11', invoice_usd: 5 })).status).toBe(400);
    expect((await call(M.reconcile.POST, owner, { provider: 'openai', month: '2026-13', invoice_usd: 5 })).status).toBe(400);
    expect((await call(M.reconcile.POST, owner, { provider: 'openai', month: '2026-11', invoice_usd: 0 })).status).toBe(400);
  });
});

describe('reconcile maths', () => {
  it('within ±5% passes, beyond fails, and a missing invoice is not judged', () => {
    expect(reconcile(104.9, 100)).toMatchObject({ diff_pct: 4.9, ok: true });
    expect(reconcile(95, 100)).toMatchObject({ diff_pct: -5, ok: true });
    expect(reconcile(105.5, 100)).toMatchObject({ diff_pct: 5.5, ok: false });
    expect(reconcile(90, 100)).toMatchObject({ diff_usd: -10, ok: false });
    expect(reconcile(10, 0)).toMatchObject({ diff_pct: null, ok: null });
  });
});

describe('record() on its own', () => {
  it('does nothing without a context and never throws', () => {
    expect(() => record(undefined, 'copy', { provider: 'openai', model: 'gpt-6.1-sol' })).not.toThrow();
    expect(calls).toEqual([]);
  });
});
