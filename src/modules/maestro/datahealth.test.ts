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
const call = async (p: A.Profile) => {
  const cookie = `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(p, cfg), cfg.secret))}`;
  const files = { get: async () => ({ uploaded: new Date('2026-11-05T03:00:00Z'), text: async () => JSON.stringify({ crm: { total: 2, unmatched: 1, rows: [['m1', 'd', 'd', 1, 5]], paid_all: [[], []] } }) }) } as unknown as R2Bucket;
  return ROUTES.maestro.health.GET!(new Request('https://well.example/api/maestro/health', { headers: { cookie } }), { ...E, FILES: files } as A.AuthEnv);
};
afterEach(() => { vi.unstubAllGlobals(); });

describe('/api/maestro/health', () => {
  it('is owner only', async () => {
    world(MEMBER);
    expect((await call(MEMBER)).status).toBe(403);
  });
  it('returns counts, dates and duplicates, and no ad names, customer ids or knowledge text', async () => {
    world(OWNER);
    const r = await call(OWNER);
    expect(r.status).toBe(200);
    const text = await r.text();
    for (const s of ['Secret', 'secret', 'C-SECRET']) expect(text).not.toContain(s);
    const h = JSON.parse(text);
    expect(h.duplicates).toMatchObject({ ads: 1, knowledge: 1, leads: 1 });
    expect(h.joins).toMatchObject({ leads: 2, matched: 1, closings_all: 2, closings_with_ad: 1 });
    expect(h.freshness.dash_json_uploaded).toBe('2026-11-05T03:00:00.000Z');
    expect(h.counts.ads).toBe(7);
    expect(h.orphans).toEqual({ ads: 7, crm_leads: 7, audit_log: 7, connections: 7 });
    expect(h.migrations_missing).toEqual([]);
  });
  it('lists the migrations that are not applied, by file name', async () => {
    world(OWNER, ['crm_leads', 'copy_projects']);
    const h = await (await call(OWNER)).json() as { migrations_missing: { migration: string; reason: string }[] };
    expect([...new Set(h.migrations_missing.map(m => m.migration))]).toEqual(['011_crm_leads.sql', '015_copy.sql']);
    expect(h.migrations_missing.every(m => m.reason === 'table')).toBe(true);
  });
});
