// «صحة الداتا»: owner only, aggregates only, and it names the migrations that are missing. Synthetic data.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../lib/auth';
import { ROUTES } from '../routes';
import { freshness, joinRates, surplus } from './datahealth';
import { SCHEMA } from './schema';

describe('pure checks', () => {
  it('counts the rows beyond the first of each group', () => {
    expect(surplus(['a', 'a', 'a', 'b', 'c', 'c', ''], x => x || null)).toBe(3);
    expect(surplus([], () => 'x')).toBe(0);
  });
  it('finds the newest ad update and the newest metrics day per platform', () => {
    const f = freshness(
      [{ ad_key: 'm1', platform: 'meta', name: 'a', campaign: 'c', updated_at: '2026-11-05T01:00:00Z' }, { ad_key: 'm2', platform: 'meta', name: 'b', campaign: 'c', updated_at: '2026-11-04T01:00:00Z' }, { ad_key: 't1', platform: 'tiktok', name: 'x', campaign: 'c', updated_at: null }],
      [{ ad_key: 'm1', day: '2026-11-04' }, { ad_key: 'm2', day: '2026-11-05' }, { ad_key: 'gone', day: '2026-11-06' }],
      [{ platform: 'meta', expires_at: '2026-12-01T00:00:00Z' }]);
    const meta = f.find(p => p.platform === 'meta')!;
    expect(meta).toMatchObject({ ads: 2, newest_ad_update: '2026-11-05T01:00:00Z', newest_metric_day: '2026-11-05', token_expires_at: '2026-12-01T00:00:00Z' });
    expect(f.find(p => p.platform === 'snap')).toMatchObject({ ads: 0, newest_metric_day: null });
  });
  it('reads join rates from the crm block, and tolerates a missing one', () => {
    const j = joinRates({ total: 10, unmatched: 4, rows: [['m1', 'd', 'd', 1, 5], ['m2', 'd', '', 0, 0], ['m3', 'd', 'd', 1, 7], ['m4', 'd', '', 0, 0], ['m5', 'd', '', 0, 0], ['m6', 'd', '', 0, 0]], paid_all: [[], [], [], []] });
    expect(j).toMatchObject({ leads: 10, matched: 6, unmatched: 4, matched_pct: 60, closings_all: 4, closings_with_ad: 2, closings_pct: 50 });
    expect(joinRates(undefined)).toMatchObject({ leads: 0, matched_pct: null, closings_pct: null });
  });
  it('passes the attribution reasons through as counts only', () => {
    const j = joinRates({ total: 1, rows: [], paid_all: [], attribution: { paid: 3, why: { id: 1, source: 2, evil: 9 }, unmatched_sources: { whatsapp_organic: 2, 'Bad Name!': 5 } } });
    expect(j.attribution).toEqual({ paid: 3, why: { id: 1, utm: 0, name: 0, via_customer: 0, source: 2, no_id: 0, broken_id: 0, not_in_ads: 0 }, unmatched_sources: { whatsapp_organic: 2 } });
    expect(joinRates({}).attribution).toBeNull();
  });
  it('probes every table once per migration and names real files', () => {
    for (const p of SCHEMA) expect(p.migration).toMatch(/^\d{3}_[a-z_]+\.sql$/);
    expect(SCHEMA.find(p => p.table === 'crm_leads')!.migration).toBe('011_crm_leads.sql');
  });
});

const E = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'leen@example.com' };
const cfg = A.env(E);
const OWNER: A.Profile = { id: '11111111-1111-1111-1111-111111111111', email: 'leen@example.com', active: true };
const MEMBER = { id: '22222222-2222-2222-2222-222222222222', email: 'm@example.com', active: true, dashboards: ['maestro'] } as unknown as A.Profile;
const WELL = '00000000-0000-0000-0000-000000000001';

function world(p: A.Profile, missing: string[] = []) {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = url.replace('https://sb.example', '');
    const table = path.match(/\/rest\/v1\/([a-z_]+)/)?.[1] || '';
    if (missing.includes(table)) return new Response(JSON.stringify({ code: 'PGRST205' }), { status: 404 });
    if (init.method === 'HEAD') return new Response(null, { headers: { 'content-range': '0-0/7' } });
    if (path.includes('/profiles?')) return new Response(JSON.stringify([p]));
    if (path.includes('limit=0')) return new Response('[]');
    const rows: Record<string, unknown[]> = {
      ads: [{ ad_key: 'm1', platform: 'meta', name: 'Secret Ad Name', campaign: 'Secret Campaign', updated_at: '2026-11-05T01:00:00Z' }, { ad_key: 'm2', platform: 'meta', name: 'Secret Ad Name', campaign: 'Secret Campaign', updated_at: '2026-11-05T01:00:00Z' }],
      companies: [{ id: WELL }], knowledge: [{ kind: 'note', title: 'Secret Title', body: 'Secret body' }, { kind: 'note', title: 'Secret Title', body: 'secret body ' }],
      crm_leads: [{ customer_id: 'C-SECRET', source_platform: 'meta_form', created_at: '2026-11-01T00:00:00Z' }, { customer_id: 'C-SECRET', source_platform: 'meta_form', created_at: '2026-11-01T00:00:00Z' }],
      crm_sync_state: [{ last_updated_at: '2026-11-05T00:00:00Z', last_run_at: '2026-11-05T02:00:00Z', rows_last_run: 3 }],
    };
    return new Response(JSON.stringify(rows[table] || []));
  }));
}
const call = async (p: A.Profile, part = 'sources') => {
  const cookie = `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(p, cfg), cfg.secret))}`;
  const files = { get: async () => ({ uploaded: new Date('2026-11-05T03:00:00Z'), text: async () => JSON.stringify({ crm: { total: 2, unmatched: 1, rows: [['m1', 'd', 'd', 1, 5]], paid_all: [[], []] } }) }) } as unknown as R2Bucket;
  return ROUTES.maestro.health.GET!(new Request(`https://well.example/api/maestro/health?part=${part}`, { headers: { cookie } }), { ...E, FILES: files } as A.AuthEnv);
};
afterEach(() => { vi.unstubAllGlobals(); });

describe('/api/maestro/health', () => {
  it('is owner only, and refuses an unknown part', async () => {
    world(MEMBER);
    expect((await call(MEMBER)).status).toBe(403);
    world(OWNER);
    expect((await call(OWNER, 'everything')).status).toBe(400);
  });
  it('returns counts, dates and duplicates, and no ad names, customer ids or knowledge text', async () => {
    world(OWNER);
    const texts: string[] = [];
    const got: Record<string, unknown> = {};
    for (const part of ['sources', 'content', 'counts', 'schema']) {
      const r = await call(OWNER, part);
      expect(r.status).toBe(200);
      const text = await r.text(); texts.push(text);
      Object.assign(got, JSON.parse(text));
    }
    for (const s of ['Secret', 'secret', 'C-SECRET']) expect(texts.join()).not.toContain(s);
    const h = got as { joins: object; freshness: { dash_json_uploaded: string }; counts: { ads: number }; orphans: object; migrations_missing: unknown[] };
    expect(h.joins).toMatchObject({ leads: 2, matched: 1, closings_all: 2, closings_with_ad: 1 });
    expect(h.freshness.dash_json_uploaded).toBe('2026-11-05T03:00:00.000Z');
    expect(h.counts.ads).toBe(7);
    expect(h.orphans).toEqual({ ads: 7, crm_leads: 7, audit_log: 7, connections: 7 });
    expect(h.migrations_missing).toEqual([]);
  });
  it('splits the duplicate checks across parts', async () => {
    world(OWNER);
    expect(((await (await call(OWNER, 'sources')).json()) as { duplicates: object }).duplicates).toEqual({ ads: 1 });
    expect(((await (await call(OWNER, 'content')).json()) as { duplicates: object }).duplicates).toMatchObject({ knowledge: 1, leads: 1 });
  });
  it('keeps every part under 40 subrequests', async () => {
    world(OWNER);
    for (const part of ['sources', 'content', 'counts', 'schema']) {
      await call(OWNER, part);
      const calls = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.length;
      expect(calls, part).toBeLessThanOrEqual(40);
      world(OWNER);
    }
  });
  it('lists the migrations that are not applied, by file name', async () => {
    world(OWNER, ['crm_leads', 'copy_projects']);
    const h = await (await call(OWNER, 'schema')).json() as { migrations_missing: { migration: string; reason: string }[] };
    expect([...new Set(h.migrations_missing.map(m => m.migration))]).toEqual(['011_crm_leads.sql', '015_copy.sql']);
    expect(h.migrations_missing.every(m => m.reason === 'table')).toBe(true);
  });
});
