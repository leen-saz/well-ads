/* eslint-disable @typescript-eslint/no-explicit-any -- recorded request bodies are read loosely in assertions */
// «تلقائي» (M13): off by default; acts only on a managed entity, within 20% and the 2,500 SAR day, and through every normal guard.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTO_MAX_PCT, SPEND_CAP_SAR, autoApply, autoWatch, cleanAuto, expectedSpend } from '../../src/lib/automation';

const cfg = { url: 'https://sb.example', anon: 'anon', service: 'service' } as never;
const ENV = { META_WRITE_TOKEN: 'w', META_WRITE_AD_ACCOUNT_ID: '123' };
const ACTION = (over: any = {}) => ({ id: '11111111-1111-4111-8111-111111111111', status: 'proposed', mode: 'auto', platform: 'meta', level: 'campaign', entity_id: 'c1',
  change: { op: 'budget', from: 1000, to: 1200, pct: 20 }, ...over });

type World = { action?: any; auto?: any; kill?: boolean; live?: boolean; dailyCap?: number; managed?: any[] | 'missing'; budgets?: Record<string, number>; statuses?: Record<string, string>; outcomes?: any[] };
function world(w: World) {
  const calls: { url: string; method: string; body: any }[] = [];
  const state: Record<string, number> = { ...(w.budgets ?? { c1: 1000 }) };
  const status: Record<string, string> = { ...(w.statuses ?? {}) };
  let saved: any = null;
  vi.stubGlobal('fetch', vi.fn(async (u: string, init: RequestInit = {}) => {
    const url = String(u), method = init.method || 'GET';
    let body: any = init.body ? String(init.body) : null; try { body = JSON.parse(body); } catch { /* form */ }
    calls.push({ url, method, body });
    const j = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
    if (url.includes('/rest/v1/control_settings')) {
      if (method === 'PATCH' || method === 'POST') { saved = body; return j([{ guardrails: body?.guardrails ?? body }], 200); }
      const g = { platform: 'global', guardrails: { kill: !!w.kill, auto: saved?.guardrails?.auto ?? w.auto ?? {}, exec: { maxPct: 20, ...(w.dailyCap ? { dailyCap: w.dailyCap } : {}) } }, updated_at: '2026-11-21T00:00:00Z' };
      return j(url.includes('platform=eq.global') ? [g] : [g, { platform: 'meta', guardrails: { exec: { live: w.live !== false } } }]);
    }
    if (url.includes('/rest/v1/managed_campaigns')) return w.managed === 'missing' ? j({ code: '42P01', message: 'relation does not exist' }, 404) : j(w.managed ?? [{ platform: 'meta', level: 'campaign', entity_id: 'c1', name: 'A' }]);
    if (url.includes('/rest/v1/buyer_actions')) {
      if (method === 'PATCH') return j([{ ...(w.action ?? ACTION()), ...body }]);
      return j(url.includes('id=eq.') ? [w.action ?? ACTION()] : []);
    }
    if (url.includes('/rest/v1/buyer_outcomes')) return j(w.outcomes ?? []);
    if (url.includes('graph.facebook.com')) {
      const id = url.split('/v23.0/')[1]!.split('?')[0]!;
      if (id === 'act_123') return j({ currency: 'SAR' });
      if (method === 'POST') { const p = new URLSearchParams(String(init.body)); if (p.get('daily_budget')) state[id] = Number(p.get('daily_budget')) / 100; if (p.get('status')) status[id] = p.get('status')!; return j({ success: true }); }
      return j({ id, name: id, status: status[id] ?? 'ACTIVE', daily_budget: String((state[id] ?? 0) * 100) });
    }
    return j([]);
  }));
  return calls;
}
const writes = (calls: { url: string; method: string; body: any }[]) => calls.filter(c => c.url.includes('graph.facebook.com') && c.method === 'POST');
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('settings', () => {
  it('off by default; the spend cap is 2,500 SAR and can only go down', () => {
    expect(cleanAuto({})).toEqual({ on: { buyer: false }, spendCap: SPEND_CAP_SAR });
    expect(cleanAuto({ on: { buyer: true }, spendCap: 9000 }).spendCap).toBe(2500);
    expect(cleanAuto({ spendCap: 1000 }).spendCap).toBe(1000);
    expect(cleanAuto({ on: { buyer: 'yes' } }).on.buyer).toBe(false);
  });
  it('expected spend: the active managed daily budgets, with this change applied', () => {
    const live = [{ entity_id: 'a', budget: 1000, status: 'active' }, { entity_id: 'b', budget: 800, status: 'paused' }];
    expect(expectedSpend(live, { entity_id: 'a', change: { op: 'budget', from: 1000, to: 1200, pct: 20 } } as any)).toBe(1200);
    expect(expectedSpend(live, { entity_id: 'b', change: { op: 'status', from: 'paused', to: 'active' } } as any)).toBe(1800);
  });
});

describe('autoApply', () => {
  it('auto off (the default): nothing is written, the proposal stays for approval', async () => {
    const calls = world({ dailyCap: 5000 });
    expect(await autoApply(cfg, ENV, 'buyer', ACTION() as any)).toMatchObject({ applied: false, why: 'off' });
    expect(writes(calls)).toEqual([]);
  });
  it('on, managed, within 20% and the day: applied through the normal path (written and read back)', async () => {
    const calls = world({ auto: { on: { buyer: true } }, dailyCap: 5000 });
    expect(await autoApply(cfg, ENV, 'buyer', ACTION() as any)).toEqual({ applied: true });
    expect(writes(calls).map(c => new URLSearchParams(String(c.body)).get('daily_budget'))).toEqual(['120000']);
    const claim = calls.find(c => c.url.includes('/buyer_actions') && c.method === 'PATCH' && c.body?.status === 'applying')!;
    expect(claim.body.decided_by).toBe('auto:buyer');
  });
  it('refuses: emergency stop, not on the managed list, over 20%, over the 2,500 SAR day, a guard (no daily cap set)', async () => {
    const cases: [World, any, string][] = [
      [{ auto: { on: { buyer: true } }, kill: true, dailyCap: 5000 }, ACTION(), 'kill'],
      [{ auto: { on: { buyer: true } }, dailyCap: 5000, managed: [] }, ACTION(), 'not_managed'],
      [{ auto: { on: { buyer: true } }, dailyCap: 5000 }, ACTION({ change: { op: 'budget', from: 1000, to: 1300, pct: 30 } }), 'cap_pct'],
      [{ auto: { on: { buyer: true } }, dailyCap: 5000, budgets: { c1: 2200 } }, ACTION({ change: { op: 'budget', from: 2200, to: 2640, pct: 20 } }), 'spend_cap'],
      [{ auto: { on: { buyer: true } } }, ACTION(), 'guard'],
      [{ auto: { on: { buyer: true } }, managed: 'missing' }, ACTION(), 'setup'],
    ];
    for (const [w, a, why] of cases) {
      const calls = world(w);
      expect(await autoApply(cfg, ENV, 'buyer', a), why).toMatchObject({ applied: false, why });
      expect(writes(calls), why).toEqual([]);
    }
    expect(AUTO_MAX_PCT).toBe(20);
  });
  it('a pause that lowers spend is never stopped by the spend cap', async () => {
    const a = ACTION({ change: { op: 'status', from: 'active', to: 'paused' } });
    const calls = world({ action: a, auto: { on: { buyer: true } }, budgets: { c1: 3000 }, statuses: {} });
    const r = await autoApply(cfg, ENV, 'buyer', a as any);
    expect(r, JSON.stringify(r)).toEqual({ applied: true });
    expect(writes(calls).map(c => new URLSearchParams(String(c.body)).get('status'))).toEqual(['PAUSED']);
  });
});

describe('autoWatch', () => {
  it('a worse 7-day result of an auto action switches the agent back and says so', async () => {
    world({ auto: { on: { buyer: true } }, outcomes: [{ action_id: 'x', result: 'worse', buyer_actions: { decided_by: 'auto:buyer' } }] });
    const alert = vi.fn(async () => 1);
    expect(await autoWatch(cfg, alert)).toEqual(['buyer']);
    expect(alert).toHaveBeenCalledOnce();
  });
  it('auto off: nothing is read', async () => {
    const calls = world({});
    expect(await autoWatch(cfg, vi.fn())).toEqual([]);
    expect(calls.some(c => c.url.includes('buyer_outcomes'))).toBe(false);
  });
});
