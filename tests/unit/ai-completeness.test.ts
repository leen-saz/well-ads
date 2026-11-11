// One source for each tab's default provider, the Debugger's Claude calls recorded and capped, and the recorded-vs-expected table (synthetic data).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { pick, PROVIDER as FROM_LLM, type LlmEnv } from '../../src/lib/llm';
import { PROVIDER, TASKS, defaultOf } from '../../src/lib/ai-routes';
import { clearSnaps, withWaiter } from '../../src/lib/usage';
import { compareModels } from '../../src/modules/maestro/usage';
import { CLAUDE_MODEL } from '../../src/modules/debugger/explain';
import { ROUTES } from '../../src/modules/routes';

const ALL: LlmEnv = { OPENAI_API_KEY: 'k', XAI_API_KEY: 'k', OPENROUTER_API_KEY: 'k', AI: { run: vi.fn() } as unknown as NonNullable<LlmEnv['AI']> };

describe('routing defaults have one source', () => {
  it('llm.ts reads the table in ai-routes.ts, and every task default is what pick() really chooses', () => {
    expect(FROM_LLM).toBe(PROVIDER);
    for (const t of TASKS) {
      if (t.def === 'anthropic') { expect(['debugger', 'overview']).toContain(t.key); continue; }
      const module = t.key === 'compliance' || t.key === 'knowledge' ? 'content' : t.key;
      // OpenRouter tasks need a model id to be picked: the default one from OR_DEFAULT stands in for the owner's
      expect(pick(ALL, module)?.provider, t.key).toBe(t.def);
      expect(defaultOf(t.key)).toBe(t.def);
    }
  });
});

describe('recorded against expected', () => {
  const row = (o: Record<string, unknown>) => ({ month: '2026-11', provider: 'openai', model: 'gpt-6.1-sol', calls: 2, tokens_in: 1_000_000, tokens_out: 100_000, cost_usd: 3.5, unpriced: 0, estimated: 0, ...o }) as Parameters<typeof compareModels>[0][number];
  it('prices the tokens from our table, shows the gap, and sorts by what was recorded', () => {
    const [a, b] = compareModels([row({ provider: 'xai', model: 'grok-4.7', cost_usd: 1, tokens_in: 100_000, tokens_out: 10_000 }), row({})]);
    expect(a).toMatchObject({ provider: 'openai', recorded_usd: 3.5, expected_usd: 3.5, diff_usd: 0, diff_pct: 0, in_table: true, verified: false });
    expect(b!.expected_usd).toBeCloseTo(0.45, 6);
    expect(b!.diff_pct).toBeCloseTo(122.22, 1);
  });
  it('a model with no price has no expected cost, and the counts of unpriced and estimated rows come through', () => {
    const [r] = compareModels([row({ provider: 'openrouter', model: 'a/b', cost_usd: 0.2, unpriced: 1, estimated: 2 })]);
    expect(r).toMatchObject({ expected_usd: null, diff_usd: null, diff_pct: null, in_table: false, unpriced: 1, estimated: 2 });
  });
});

describe('Debugger on Claude is recorded and capped', () => {
  const CO = '11111111-1111-1111-1111-111111111111';
  const SB = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'boss@example.com' } as A.AuthEnv;
  const cfg = A.env(SB);
  const owner = { id: '33333333-3333-3333-3333-333333333333', email: 'boss@example.com', role: 'owner', active: true, company_id: CO } as A.Profile;
  let calls: { url: string; method: string; body: unknown }[], spend: { module: string; cost_usd: number }[], caps: unknown[];
  beforeEach(() => {
    calls = []; spend = []; caps = []; clearSnaps();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      const body = init.body && typeof init.body === 'string' && init.body.startsWith('{') || String(init.body ?? '').startsWith('[') ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method: init.method || 'GET', body });
      if (url.includes('/profiles?id=eq.')) return new Response(JSON.stringify([owner]));
      if (url.includes('anthropic')) return new Response(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: CLAUDE_MODEL, stop_reason: 'end_turn', content: [{ type: 'text', text: '1. خطوة' }], usage: { input_tokens: 400, output_tokens: 100 } }), { headers: { 'content-type': 'application/json' } });
      if (url.includes('/rpc/ai_spend')) return new Response(JSON.stringify(spend.map(s => ({ month: '2026-11', calls: 1, tokens_in: 1, tokens_out: 1, cost_sar: 0, unpriced: 0, ...s }))));
      if (url.includes('/ai_budgets')) return new Response(JSON.stringify(caps));
      return new Response('[]');
    }));
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  const ask = async () => {
    const jobs: Promise<unknown>[] = [];
    const res = await withWaiter(p => jobs.push(p), async () => ROUTES.debugger.explain.POST!(new Request('https://well.example/api/debugger/explain', { method: 'POST', body: '{}',
      headers: { cookie: `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(owner, cfg), cfg.secret))}`, origin: 'https://well.example', 'sec-fetch-site': 'same-origin' } }), { ...SB, ANTHROPIC_API_KEY: 'sk-ant-test' } as A.AuthEnv));
    await Promise.all(jobs);
    return res;
  };
  it('an answer writes one ai_usage row for the Debugger tab with provider anthropic', async () => {
    const res = await ask();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: '1. خطوة', model: CLAUDE_MODEL });
    const rows = calls.filter(c => c.url.includes('/ai_usage') && c.method === 'POST').map(c => c.body);
    expect(rows).toEqual([expect.objectContaining({ module: 'debugger', provider: 'anthropic', model: CLAUDE_MODEL, tokens_in: 400, tokens_out: 100, priced: true })]);
  });
  it('a tab at its monthly cap stops with a plain sentence and never calls Claude', async () => {
    caps = [{ module: 'debugger', monthly_cap_usd: 1, alert_at_pct: 80 }]; spend = [{ module: 'debugger', cost_usd: 2 }];
    const res = await ask();
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toContain('سقفه');
    expect(calls.some(c => c.url.includes('anthropic'))).toBe(false);
  });
});
