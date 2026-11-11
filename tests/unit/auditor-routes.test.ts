// «تدقيق القرارات» on the API: owner only, reads dash.json itself, logs disagreements as ids (no figures), the critique is a paid
// draft that needs a key and is recorded in ai_usage. Synthetic data in Leen's proportions, fetch stubbed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { api } from '../../src/api/index';
import { synth } from '../../src/modules/auditor/synth';
import { criticPrompt, CRITIC_MODEL } from '../../src/modules/auditor/critic';
import { claimFromJudge } from '../../src/modules/auditor/adapter';
import { audit } from '../../src/modules/auditor/audit';

// 48 closings, ~4K results, few tied to ads; targets lenient enough that the judge says «no problem», while the auditor's own
// floor (2%) still finds the best case (~1.2%) under it: a real disagreement to audit and log
const dash = { ...synth({ tied: 0.12, paidTied: 4 }), funnel_targets: { ctr: 0.1, clickToLead: 0.5, leadToClose: 0.5, cpl: 100000, costShare: 100, roas: 0.01 } };
const EV: Record<string, unknown> = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 'service', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'owner@example.test',
  FILES: { get: async (k: string) => (k === 'site/dash.json' ? { json: async () => dash } : null) } };
const cfg = A.env(EV as unknown as A.AuthEnv);
const owner: A.Profile = { id: '11111111-1111-4111-8111-111111111111', email: 'owner@example.test', role: 'owner', active: true };
const member: A.Profile = { id: '22222222-2222-4222-8222-222222222222', email: 'm@example.test', role: 'member', dashboards: ['ceo', 'overview'], active: true };
const cookie = async (p: A.Profile) => `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(p, cfg), cfg.secret))}`;
const call = async (path: string, who: A.Profile, init: RequestInit = {}, env = EV) =>
  api.request('https://well.example' + path, { ...init, headers: { cookie: await cookie(who), origin: 'https://well.example', 'content-type': 'application/json' } }, env as unknown as A.AuthEnv);
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function world(who: A.Profile, extra?: (url: string, init?: RequestInit) => Response | null) {
  const seen: { url: string; method: string; body?: string }[] = [];
  vi.stubGlobal('fetch', async (u: string, init?: RequestInit) => {
    const url = String(u);
    seen.push({ url, method: init?.method ?? 'GET', ...(typeof init?.body === 'string' ? { body: init.body } : {}) });
    const x = extra?.(url, init);
    if (x) return x;
    if (url.includes('/profiles')) return new Response(JSON.stringify([who]), { status: 200 });
    return new Response('[]', { status: 200 });
  });
  return seen;
}

describe('GET /api/maestro/audit', () => {
  it('the owner gets the audit of the verdict in both languages, with the back-test; a «no problem» the data does not carry is flagged', async () => {
    world(owner);
    const r = await call('/api/maestro/audit', owner);
    expect(r.status).toBe(200);
    const j = await r.json() as { status: string; headline: { ar: { title: string }; en: { title: string } }; verdict: { findings: { id: string; text: { ar: string; en: string } }[] }; backtest: { windows: number }; critic: boolean };
    expect(j.headline.ar.title).toBe('لا توجد مشكلة');
    expect(j.headline.en.title).toBe('No problem');
    expect(j.status).not.toBe('confirmed');
    expect(j.verdict.findings.length).toBeGreaterThan(0);
    expect(j.verdict.findings[0]!.text.ar).toBeTruthy(); expect(j.verdict.findings[0]!.text.en).toBeTruthy();
    expect(j.backtest.windows).toBeGreaterThan(0);
    expect(j.critic).toBe(false);
  });
  it('a disagreement is logged once, as ids and a step: no figure, no email in the target', async () => {
    const seen = world(owner);
    await call('/api/maestro/audit', owner);
    const post = seen.find(s => s.url.includes('/audit_log') && s.method === 'POST');
    expect(post).toBeTruthy();
    const row = JSON.parse(post!.body!) as { action: string; target: Record<string, unknown> };
    expect(row.action).toBe('verdict_audit');
    expect(row.target).toMatchObject({ step: null, status: expect.stringMatching(/^(weakened|contradicted)$/) });
    expect(Object.keys(row.target).sort()).toEqual(['checks', 'key', 'level', 'plat', 'status', 'step', 'to']);
    expect(JSON.stringify(row.target)).not.toMatch(/spend|impr|\d{3,}\.\d|@/);
    // The same disagreement again: the log already has it, so nothing more is written
    const again = world(owner, (u, i) => (u.includes('/audit_log') && (i?.method ?? 'GET') === 'GET' && u.includes('target->>key') ? new Response('[{"id":1}]') : null));
    await call('/api/maestro/audit', owner);
    expect(again.filter(s => s.url.includes('/audit_log') && s.method === 'POST')).toHaveLength(0);
  });
  it('only the owner', async () => {
    world(member);
    expect((await call('/api/maestro/audit', member)).status).toBe(403);
    expect((await call('/api/maestro/critique', member, { method: 'POST', body: '{}' })).status).toBe(403);
  });
  it('a platform that does not exist is refused; no dash.json is a clear 404', async () => {
    world(owner);
    expect((await call('/api/maestro/audit?plat=nope', owner)).status).toBe(400);
    expect((await call('/api/maestro/audit', owner, {}, { ...EV, FILES: { get: async () => null } })).status).toBe(404);
  });
});

describe('POST /api/maestro/critique (draft, paid)', () => {
  const reply = { id: 'm', type: 'message', role: 'assistant', model: CRITIC_MODEL, stop_reason: 'end_turn', usage: { input_tokens: 900, output_tokens: 200 },
    content: [{ type: 'text', text: JSON.stringify({ scores: [
      { criterion: 'evidence', reason: 'Closings are far under the floor even in the best case.', score: 4 }, { criterion: 'alternatives', reason: 'Timing is not ruled out.', score: 2 },
      { criterion: 'attribution', reason: 'Gap is large.', score: 9 }, { criterion: 'actionable', reason: 'Owner is clear.', score: 3 }], summary: 'Verdict is wrong.' }) }] };
  it('is off without a key', async () => {
    world(owner);
    expect((await call('/api/maestro/critique', owner, { method: 'POST', body: '{}' })).status).toBe(503);
  });
  it('with a key: Sonnet, a reason before every score, clamped scores, labelled draft, and the cost is recorded', async () => {
    const seen = world(owner, u => (u.includes('api.anthropic.com') ? new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } }) : null));
    const r = await call('/api/maestro/critique', owner, { method: 'POST', body: '{}' }, { ...EV, ANTHROPIC_API_KEY: 'sk-ant-test' });
    expect(r.status).toBe(200);
    const j = await r.json() as { draft: boolean; scores: { criterion: string; reason: string; score: number }[]; overall: number };
    expect(j.draft).toBe(true);
    expect(j.scores.map(s => s.criterion)).toEqual(['evidence', 'alternatives', 'attribution', 'actionable']);
    expect(j.scores.every(s => s.reason.length > 0 && s.score >= 1 && s.score <= 5)).toBe(true);
    expect(j.scores[2]!.score).toBe(5);
    await new Promise(r2 => setTimeout(r2, 10));
    const sent = JSON.parse(seen.find(s => s.url.includes('api.anthropic.com'))!.body!) as { model: string };
    expect(sent.model).toBe(CRITIC_MODEL);
    const usage = seen.find(s => s.url.includes('/ai_usage') && s.method === 'POST');
    expect(JSON.parse(usage!.body!)).toMatchObject({ provider: 'anthropic', model: expect.stringContaining('claude-sonnet-5'), tokens_in: 900, tokens_out: 200, priced: true });
  });
  it('the prompt is a structured list with the rubric and bias guards, and carries no email or name', () => {
    const c = claimFromJudge(dash, '2026-10-02', '2026-10-31');
    const p = criticPrompt(c, audit(dash, c).findings);
    expect(p).toContain('VERDICT UNDER REVIEW'); expect(p).toContain('AUDITOR FINDINGS');
    expect(p).not.toMatch(/@|owner@/);
    expect(criticPrompt(c, audit(dash, c).findings)).toBe(p);   // same content, same order: no randomness
  });
});
