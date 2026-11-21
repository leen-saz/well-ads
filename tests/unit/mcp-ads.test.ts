/* eslint-disable @typescript-eslint/no-explicit-any -- recorded request bodies are read loosely in assertions */
// Ad write tools (M12) in «بموافقتي» mode: a call files a proposed action and never touches an ad account.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { callTool } from '../../src/mcp/call';
import { WELL_COMPANY } from '../../src/lib/tenant';
import type { Ctx } from '../../src/mcp/types';

const cfg = { url: 'https://sb.example', anon: 'anon', service: 'service' } as never;
const ENV = { META_WRITE_TOKEN: 'w', META_WRITE_AD_ACCOUNT_ID: '123' };
function world(campaigns: { id: string; name: string; daily_budget?: string; effective_status?: string }[] = [{ id: 'c1', name: 'رمضان', daily_budget: '10000', effective_status: 'ACTIVE' }]) {
  const calls: { url: string; method: string; body: any }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (u: string, init: RequestInit = {}) => {
    const url = String(u), method = init.method || 'GET';
    let body: any = init.body ? String(init.body) : null; try { body = JSON.parse(body); } catch { /* form */ }
    calls.push({ url, method, body });
    const j = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
    if (url.includes('graph.facebook.com')) {
      if (url.includes('/campaigns')) return j({ data: campaigns.map(c => ({ ...c, status: c.effective_status })) });
      if (url.includes('act_123?')) return j({ currency: 'SAR' });
      return j({ data: [] });
    }
    if (url.includes('/rest/v1/mcp_idempotency') && method === 'GET') return j([]);
    if (url.includes('/rest/v1/buyer_actions') && method === 'POST') return j([{ id: 'a1' }], 201);
    return j([]);
  }));
  return calls;
}
const ctx = (over: Partial<Ctx> = {}): Ctx => ({ cfg, env: ENV, company: WELL_COMPANY, actor: 'agent:buyer', scope: 'read-write', mode: 'approve', ...over });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('ads.budget.change / ads.status.change', () => {
  it('files a proposed action for the owner to approve, with only read calls to the platform', async () => {
    const calls = world();
    const r = await callTool(ctx(), 'ads.status.change', { platform: 'meta', campaign: 'رمضان', to: 'paused', reason: 'التكلفة عالية من أسبوع' }, { idempotencyKey: 'pause-0001' });
    expect(r).toMatchObject({ ok: true, data: { ok: true, id: 'a1', awaiting_approval: true } });
    const row = calls.find(c => c.url.endsWith('/rest/v1/buyer_actions') && c.method === 'POST')!.body;
    expect(row).toMatchObject({ company_id: WELL_COMPANY, created_by: 'agent:buyer', platform: 'meta', kind: 'pause', change: { op: 'status', to: 'paused' }, reason: 'التكلفة عالية من أسبوع' });
    expect(calls.filter(c => c.url.includes('graph.facebook.com')).every(c => c.method === 'GET')).toBe(true);
  });
  it('needs an idempotency key, the read-write scope, Well, and a sane change', async () => {
    world();
    const ok = { platform: 'meta', campaign: 'رمضان', pct: 20, reason: 'النتائج ممتازة من أسبوعين' };
    expect(await callTool(ctx(), 'ads.budget.change', ok)).toMatchObject({ ok: false, error: { code: 'needs_key' } });
    expect(await callTool(ctx({ scope: 'read' }), 'ads.budget.change', ok, { idempotencyKey: 'bud-00001' })).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(await callTool(ctx({ company: '11111111-2222-4333-8444-555555555555' }), 'ads.budget.change', ok, { idempotencyKey: 'bud-00002' })).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    for (const bad of [{ ...ok, pct: 80 }, { ...ok, pct: 0 }, { ...ok, platform: 'tiktok' }, { ...ok, reason: 'x' }, { ...ok, campaign: '' }, { ...ok, entity_id: '1' }])
      expect(await callTool(ctx(), 'ads.budget.change', bad, { idempotencyKey: 'bud-00003' }), JSON.stringify(bad)).toMatchObject({ ok: false, error: { code: 'invalid' } });
  });
  it('a budget proposal carries the current budget and the new one', async () => {
    const calls = world();
    const r = await callTool(ctx(), 'ads.budget.change', { platform: 'meta', campaign: 'رمضان', pct: 20, reason: 'النتائج ممتازة من أسبوعين' }, { idempotencyKey: 'bud-00004' });
    expect(r.ok).toBe(true);
    const row = calls.find(c => c.url.endsWith('/rest/v1/buyer_actions') && c.method === 'POST')!.body;
    expect(row.kind).toBe('budget_up');
    expect(row.change).toMatchObject({ op: 'budget', from: 100, to: 120 });
  });
});
