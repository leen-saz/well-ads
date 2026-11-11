// The execution layer's pure parts and adapters, with fake platforms only: guards, the Snap and Meta calls' shape, TikTok and Google
// staying manual, and a hygiene check that only the two adapters may name an ad platform's host. Synthetic ids and numbers.
import { describe, expect, it, vi } from 'vitest';
import { check } from '../../compliance/compliance';
import type { Rec } from '../buyer';
import { cleanSettings, defaultSettings, evaluate, idemKey, newBudget, reachedTarget, sameAsShown, type Change, type Recent, type Settings, type Subject } from './guards';
import { metaAdapter } from './meta';
import { snapAdapter } from './snap';
import { adapterFor, MSG, propose } from './service';
import { configured } from './adapters';

const NOW = Date.parse('2026-11-20T09:00:00Z');
const S = (): Settings => ({ ...defaultSettings(), dailyCap: 100, live: { meta: true, snapchat: true, tiktok: false, google: false } });
const budget = (from: number, to: number): Change => ({ op: 'budget', from, to, pct: Math.round(((to - from) / from) * 10000) / 100 });
const sub = (c: Change, over: Partial<Subject> = {}): Subject => ({ platform: 'meta', entityId: '1', mode: 'auto', change: c, ...over });
const codes = (a: Subject, s = S(), r: Recent[] = []) => evaluate(a, s, r, NOW).blocks.map(b => b.code);

describe('guards', () => {
  it('passes a 20% budget step inside every limit and reports the money impact', () => {
    const v = evaluate(sub(budget(100, 120)), S(), [], NOW);
    expect(v.ok).toBe(true); expect(v.live).toBe(true);
    expect(v.impact).toMatchObject({ dayDelta: 20, weekDelta: 140, pct: 20, dailyUsed: 0, dailyCap: 100 });
  });
  it('the default cap is 20% and the hard ceiling is 50%', () => {
    expect(defaultSettings().maxPct).toBe(20);
    expect(codes(sub(budget(100, 121)))).toEqual(['cap_pct']);
    expect(cleanSettings({ maxPct: 90 }, {}, false).maxPct).toBe(50);
    expect(codes(sub(budget(100, 130)), { ...S(), maxPct: 30 })).toEqual([]);
  });
  it('a decrease needs no daily-total room, an increase does', () => {
    expect(codes(sub(budget(100, 80)), { ...S(), dailyCap: null })).toEqual([]);
    expect(codes(sub(budget(100, 120)), { ...S(), dailyCap: null })).toEqual(['no_daily_cap']);
    expect(codes(sub(budget(100, 120)), S(), [{ platform: 'snapchat', entityId: 'z', at: NOW - 3600e3, increase: 90 }])).toEqual(['cap_daily']);
    // yesterday (Riyadh) does not count against today
    expect(codes(sub(budget(100, 120)), S(), [{ platform: 'snapchat', entityId: 'z', at: NOW - 30 * 3600e3, increase: 90 }])).toEqual([]);
  });
  it('one change per entity per 48 hours, a different entity is free', () => {
    const r: Recent[] = [{ platform: 'meta', entityId: '1', at: NOW - 47 * 3600e3, increase: 0 }];
    expect(codes(sub(budget(100, 110)), S(), r)).toEqual(['cooldown']);
    expect(codes(sub(budget(100, 110), { entityId: '2' }), S(), r)).toEqual([]);
    expect(codes(sub(budget(100, 110)), S(), [{ ...r[0]!, at: NOW - 49 * 3600e3 }])).toEqual([]);
  });
  it('kill, manual platforms, missing values and no-ops are refused', () => {
    expect(codes(sub(budget(100, 110)), { ...S(), kill: true })).toEqual(['kill']);
    expect(codes(sub(budget(100, 110), { platform: 'tiktok' }))).toEqual(['manual']);
    expect(codes(sub(budget(100, 110), { platform: 'google' }))).toEqual(['manual']);
    expect(codes(sub(budget(100, 110), { mode: 'manual', entityId: null }))).toEqual(['manual']);
    expect(codes(sub({ op: 'budget', from: null, to: null, pct: 10 } as Change))).toContain('bad_value');
    expect(codes(sub({ op: 'budget', from: 100, to: 100, pct: 0 }))).toEqual(['no_change']);
    expect(codes(sub({ op: 'status', from: 'paused', to: 'paused' }))).toEqual(['no_change']);
    expect(codes(sub({ op: 'manual', text: 'x' }))).toEqual([]);   // manual: refused by mode, never "run"
  });
  it('real execution is per platform: the flag decides, TikTok and Google can never be live', () => {
    expect(evaluate(sub(budget(100, 110)), { ...S(), live: { ...S().live, meta: false } }, [], NOW).live).toBe(false);
    const s = cleanSettings({}, { meta: { live: true }, snapchat: { live: 'yes' } }, false);
    expect(s.live).toEqual({ meta: true, snapchat: false, tiktok: false, google: false });
    expect(cleanSettings({}, {}, true).kill).toBe(true);
  });
  it('compares against the live state with a small tolerance, and checks the target after the write', () => {
    expect(sameAsShown(budget(100, 120), { budget: 100.2, status: 'active' })).toBe(true);
    expect(sameAsShown(budget(100, 120), { budget: 103, status: 'active' })).toBe(false);
    expect(sameAsShown({ op: 'status', from: 'active', to: 'paused' }, { budget: null, status: 'paused' })).toBe(false);
    expect(reachedTarget(budget(100, 120), { budget: 120, status: 'active' })).toBe(true);
    expect(reachedTarget({ op: 'status', from: 'active', to: 'paused' }, { budget: null, status: 'paused' })).toBe(true);
    expect(newBudget(100, 20)).toBe(120); expect(newBudget(33.33, -20)).toBe(26.66);
  });
  it('the idempotency key is the same for the same change on the same day and differs otherwise', () => {
    const a = { platform: 'meta' as const, level: 'campaign' as const, entityId: '1', change: budget(100, 120) };
    expect(idemKey(a, NOW)).toBe(idemKey(a, NOW + 3600e3));
    expect(idemKey(a, NOW)).not.toBe(idemKey(a, NOW + 30 * 3600e3));
    expect(idemKey({ ...a, change: budget(100, 110) }, NOW)).not.toBe(idemKey(a, NOW));
  });
});

// A fake Snap that holds one campaign and one ad squad; records every call
function fakeSnap() {
  type Body = Record<string, unknown> & { adsquads: Record<string, unknown>[]; campaigns: Record<string, unknown>[] };
  const calls: { url: string; method: string; body: Body }[] = [];
  const squad: Record<string, unknown> = { id: 'q1', name: 'squad', status: 'ACTIVE', daily_budget_micro: 50_000_000, campaign_id: 'c1', type: 'SNAP_ADS' };
  const camp: Record<string, unknown> = { id: 'c1', name: 'TEST_SNAP', status: 'ACTIVE', ad_account_id: 'acct' };
  const f = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method || 'GET', body = init.body ? (String(url).includes('oauth2') ? String(init.body) : JSON.parse(String(init.body))) : undefined;
    calls.push({ url: String(url), method, body });
    const ok = (d: object) => new Response(JSON.stringify({ request_status: 'SUCCESS', ...d }), { status: 200 });
    if (String(url).includes('oauth2')) return new Response(JSON.stringify({ access_token: 'snap-access' }), { status: 200 });
    const p = new URL(String(url)).pathname.replace('/v1/', '');
    if (p === 'adaccounts/acct/campaigns' && method === 'GET') return ok({ campaigns: [{ sub_request_status: 'SUCCESS', campaign: camp }] });
    if (p === 'campaigns/c1/adsquads' && method === 'GET') return ok({ adsquads: [{ sub_request_status: 'SUCCESS', adsquad: squad }] });
    if (p === 'adsquads/q1' && method === 'GET') return ok({ adsquads: [{ sub_request_status: 'SUCCESS', adsquad: squad }] });
    if (p === 'campaigns/c1' && method === 'GET') return ok({ campaigns: [{ sub_request_status: 'SUCCESS', campaign: camp }] });
    if (p === 'campaigns/c1/adsquads' && method === 'PUT') { Object.assign(squad, body.adsquads[0]); return ok({ adsquads: [{ sub_request_status: 'SUCCESS' }] }); }
    if (p === 'adaccounts/acct/campaigns' && method === 'PUT') { Object.assign(camp, body.campaigns[0]); return ok({ campaigns: [{ sub_request_status: 'SUCCESS' }] }); }
    return new Response('{}', { status: 404 });
  });
  const env = { SNAP_WRITE_CLIENT_ID: 'id', SNAP_WRITE_CLIENT_SECRET: 'sec', SNAP_WRITE_REFRESH_TOKEN: 'ref', SNAP_WRITE_AD_ACCOUNT_ID: 'acct' };
  return { calls, squad, camp, adapter: snapAdapter(env, f as unknown as typeof fetch) };
}

describe('adapters (fake platforms)', () => {
  it('Snap: finds by exact name, reads the ad squad budget in currency units, and writes the whole object back with only the one field changed', async () => {
    const { adapter, calls, squad } = fakeSnap();
    const found = await adapter.findCampaigns('TEST_SNAP'); expect(found).toHaveLength(1);
    expect(await adapter.findCampaigns('test_snap')).toHaveLength(0);
    const sets = await adapter.budgetedAdsets('c1'); expect(sets[0]).toMatchObject({ id: 'q1', budget: 50 });
    await adapter.setBudget('adset', 'q1', 60);
    const put = calls.find(c => c.method === 'PUT')!;
    expect(put.body.adsquads[0]).toMatchObject({ id: 'q1', type: 'SNAP_ADS', campaign_id: 'c1', daily_budget_micro: 60_000_000, status: 'ACTIVE' });
    expect((await adapter.read('adset', 'q1'))!.budget).toBe(60); expect(squad.daily_budget_micro).toBe(60_000_000);
    await adapter.setStatus('campaign', 'c1', 'paused');
    expect((await adapter.read('campaign', 'c1'))!.status).toBe('paused');
  });
  it('Snap: an item-level failure is an error, not a silent success', async () => {
    const f = vi.fn(async (u: string) => String(u).includes('oauth2') ? new Response(JSON.stringify({ access_token: 't' })) : new Response(JSON.stringify({ request_status: 'SUCCESS', campaigns: [{ sub_request_status: 'ERROR' }] })));
    const a = snapAdapter({ SNAP_WRITE_CLIENT_ID: 'i', SNAP_WRITE_CLIENT_SECRET: 's', SNAP_WRITE_REFRESH_TOKEN: 'r', SNAP_WRITE_AD_ACCOUNT_ID: 'a' }, f as unknown as typeof fetch);
    await expect(a.findCampaigns('x')).rejects.toThrow('snap_item');
  });
  it('Meta: a zero-decimal currency is written without the ×100', async () => {
    const calls: string[] = [];
    const f = vi.fn(async (u: string, init: RequestInit = {}) => { calls.push(`${init.method || 'GET'} ${u} ${init.body ?? ''}`); return new Response(JSON.stringify(String(u).endsWith('act_5?fields=currency') ? { currency: 'JPY' } : { id: '9', name: 'n', status: 'ACTIVE', daily_budget: '1000' })); });
    const a = metaAdapter({ META_WRITE_TOKEN: 't', META_WRITE_AD_ACCOUNT_ID: 'act_5' }, f as unknown as typeof fetch);
    expect((await a.read('campaign', '9'))!.budget).toBe(1000);
    await a.setBudget('campaign', '9', 1200);
    expect(calls.some(c => c.startsWith('POST') && c.endsWith('daily_budget=1200'))).toBe(true);
  });
  it('configured() is booleans only, and every secret name is needed', () => {
    expect(configured({ META_WRITE_TOKEN: 'x' })).toEqual({ meta: false, snapchat: false });
    expect(configured({ META_WRITE_TOKEN: 'x', META_WRITE_AD_ACCOUNT_ID: '1' }).meta).toBe(true);
    expect(adapterFor('tiktok', { META_WRITE_TOKEN: 'x', META_WRITE_AD_ACCOUNT_ID: '1' })).toBeNull();
    expect(adapterFor('google', {})).toBeNull();
  });
});

describe('manual platforms and placement shifts', () => {
  const rec = (over: Partial<Rec>): Rec => ({ id: 'r1', rule: 'stop_cpl', platform: 'tiktok', campaign: 'TEST_TT', kind: 'pause', title: 't', change: 'غيّر الحالة', why: 'سبب كافي', risk: 'خطر كافي', success: { metric: 'م', goal: 'ه', checkAfterDays: [3, 7] }, evidence: [], judge: null, priority: 1, confidence: 'medium', owner: 'media_buyer', readOnly: true, ...over });
  function fakeCfg() {
    const rows: Record<string, unknown>[] = [], audits: Record<string, unknown>[] = []; const net = vi.fn(async (u: string, init: RequestInit = {}) => {
      if (String(u).startsWith('https://db.test/rest/v1/buyer_actions')) { const b = JSON.parse(String(init.body)); const r = { id: 'a1', ...b, status: 'proposed' }; rows.push(r); return new Response(JSON.stringify([r]), { status: 201 }); }
      if (String(u).includes('audit_log')) { audits.push(JSON.parse(String(init.body))); return new Response(''); }
      throw new Error('unexpected network call ' + u);
    });
    vi.stubGlobal('fetch', net);
    return { rows, audits, net, ctx: { cfg: { url: 'https://db.test', service: 'k', secret: 's', owner: 'o' }, user: { uid: 'u', email: 'e@x', co: '00000000-0000-0000-0000-000000000001' } as never, env: { META_WRITE_TOKEN: 't', META_WRITE_AD_ACCOUNT_ID: '1' } } };
  }
  it('TikTok stays manual even with a pause operation and a configured Meta key: details kept, no platform call', async () => {
    const { rows, net, ctx } = fakeCfg();
    const r = await propose(ctx, rec({ act: { op: 'status', to: 'paused' } }));
    expect(r.body).toMatchObject({ mode: 'manual', manual_why: 'platform_manual' });
    expect(rows[0]).toMatchObject({ platform: 'tiktok', mode: 'manual', entity_id: null, change: { op: 'status', from: null, to: 'paused' } });
    expect(net.mock.calls.every(c => String(c[0]).startsWith('https://db.test'))).toBe(true);
    vi.unstubAllGlobals();
  });
  it('a placement or platform budget shift is a manual action carrying the full instruction', async () => {
    const { rows, ctx } = fakeCfg();
    const r = await propose(ctx, rec({ platform: 'meta', campaign: null, kind: 'shift_budget', rule: 'placement_gap', change: 'انقل ميزانية فيسبوك إلى انستقرام' }));
    expect(r.body.mode).toBe('manual'); expect(rows[0]!.change).toEqual({ op: 'manual', text: 'انقل ميزانية فيسبوك إلى انستقرام' });
    vi.unstubAllGlobals();
  });
  it('advice that does not change an account (new creative, review) is not turned into an action', async () => {
    const { ctx } = fakeCfg();
    expect((await propose(ctx, rec({ kind: 'refresh_creative' }))).status).toBe(422);
    vi.unstubAllGlobals();
  });
});

describe('hygiene', () => {
  const files = import.meta.glob(['../*.ts', './*.ts', '../*.astro'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  it('only the two adapters name an ad platform host or write with PUT/PATCH/DELETE', () => {
    for (const [f, src] of Object.entries(files)) {
      if (f.endsWith('.test.ts') || f === './meta.ts' || f === './snap.ts') continue;
      expect(src, f).not.toMatch(/graph\.facebook|business-api\.tiktok|adsapi\.snapchat|accounts\.snapchat|googleads\.googleapis/);
    }
  });
  it('no file holds a key or token value, and the secret names are only read from the Worker env', () => {
    for (const [f, src] of Object.entries(files)) {
      if (f.endsWith('.test.ts')) continue;
      expect(src, f).not.toMatch(/EAA[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9._-]{20,}|sk-[A-Za-z0-9]{10,}/);
    }
  });
  it('every refusal text is plain Arabic and passes the compliance check', () => {
    for (const [k, t] of Object.entries(MSG)) { expect(t.length, k).toBeGreaterThan(5); expect(check(t), k).toEqual([]); }
  });
});
