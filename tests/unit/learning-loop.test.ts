// The learning loop switched on (src/modules/buyer/measure.ts, docs/PRD.md §3.7, milestone M8)
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { WELL_COMPANY } from '../../src/lib/tenant';
import { proposeLessons, ruleHistory, runLearning } from '../../src/modules/buyer/measure';
import type { Tuning } from '../../src/modules/buyer/learn';

const E: A.AuthEnv = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'owner@example.com' };
const cfg = A.env(E);
afterEach(() => vi.unstubAllGlobals());

type Call = { url: string; method: string; body: unknown };
function fake(answers: Record<string, unknown>) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url), m = init?.method || 'GET';
    calls.push({ url: u, method: m, body: init?.body ? JSON.parse(String(init.body)) : null });
    const k = Object.keys(answers).find(x => u.includes(x) && (m === 'GET' || x.startsWith(m + ' ')) ) ?? Object.keys(answers).find(x => x.startsWith(m + ' ') && u.includes(x.slice(m.length + 1)));
    const v = k ? answers[k] : [];
    return new Response(JSON.stringify(v), { status: 200 });
  }));
  return calls;
}
const T = (rule: string, proposal: string | null, n = 9): Tuning => ({ rule: rule as Tuning['rule'], n, worked: 2, worse: 3, share: 2 / n, knob: 'x', proposal });

describe('proposeLessons', () => {
  it('one lesson per rule with a proposal, scoped to the company, numbers only', async () => {
    const calls = fake({ '/lessons?select=evidence': [] });
    expect(await proposeLessons(cfg, WELL_COMPANY, [T('scale_up', 'شدّد'), T('fatigue', null)])).toBe(1);
    const post = calls.find(c => c.method === 'POST' && c.url.includes('/lessons'))!;
    expect(post.body).toEqual([expect.objectContaining({ company_id: WELL_COMPANY, module: 'ads', kind: 'rule_tuning', status: 'new', lesson: 'شدّد', evidence: expect.objectContaining({ rule: 'scale_up', n: 9 }) })]);
    expect(calls.find(c => c.url.includes('/lessons?select=evidence'))!.url).toContain(`company_id=eq.${WELL_COMPANY}`);
  });
  it('no second lesson while one for the same rule is still open', async () => {
    const calls = fake({ '/lessons?select=evidence': [{ evidence: { rule: 'scale_up' } }] });
    expect(await proposeLessons(cfg, WELL_COMPANY, [T('scale_up', 'شدّد')])).toBe(0);
    expect(calls.some(c => c.method === 'POST')).toBe(false);
  });
});

describe('ruleHistory', () => {
  it('7-day results only, per rule', async () => {
    const w = { cpl: 10, leads: 20, spend: 200, ctr: 1, impr: 5000 }, worse = { cpl: 20, leads: 20, spend: 400, ctr: 1, impr: 5000 };
    const calls = fake({ '/buyer_outcomes?select=action_id,day,platform': [
      { action_id: 'a', day: 7, platform: 'meta', rec_rule: 'stop_cpl', kind: 'budget_down', before: worse, after: w },
      { action_id: 'b', day: 7, platform: 'meta', rec_rule: 'stop_cpl', kind: 'budget_down', before: w, after: worse },
    ] });
    const h = await ruleHistory(cfg, WELL_COMPANY);
    expect(h).toEqual([expect.objectContaining({ rule: 'stop_cpl', n: 2, worked: 1, worse: 1 })]);
    expect(calls[0]!.url).toContain('day=eq.7');
  });
});

describe('runLearning', () => {
  it('the tables not there: nothing measured, nothing proposed, nothing written', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: '42P01' }), { status: 404 })));
    expect(await runLearning(cfg, WELL_COMPANY)).toEqual({ measured: null, lessons: 0 });
  });
  it('no actions taken yet: 0, and no audit row', async () => {
    const calls = fake({ '/buyer_actions?': [], '/buyer_outcomes?select=action_id,day,platform': [] });
    expect(await runLearning(cfg, WELL_COMPANY)).toEqual({ measured: 0, lessons: 0 });
    expect(calls.some(c => c.url.includes('/audit_log'))).toBe(false);
  });
});
