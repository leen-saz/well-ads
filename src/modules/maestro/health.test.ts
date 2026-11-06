// Owner's CRM diagnostic: aggregates only, owner only. Synthetic data.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../lib/auth';
import { need } from '../../lib/gate';
import { ROUTES } from '../routes';
import { crmDiagnostic, type CrmRow } from './health';

const NOW = Date.parse('2026-11-05T12:00:00Z');
const paid = (amount: unknown, extra: CrmRow = {}): CrmRow => ({ payment_status: 'paid', amount_paid_sar: amount as number, ad_id: '123', source_platform: 'meta_form', paid_at: '2026-11-04T10:00:00Z', updated_at: '2026-11-04T10:00:00Z', ...extra });

describe('crmDiagnostic', () => {
  it('counts statuses, paid with amount, paid with none, linked vs unlinked, months and newest dates', () => {
    const d = crmDiagnostic([
      paid(500), paid('250.5', { paid_at: '2026-10-31T22:30:00Z' }), // 22:30 UTC on the 31st is November in Riyadh
      paid(100, { ad_id: null }), paid(80, { ad_id: '9', ad_id_quality: 'broken_by_import' }),
      paid(0), paid(null),
      { payment_status: 'pending', amount_paid_sar: 300, updated_at: '2026-11-05T01:00:00Z' },
      { payment_status: null, amount_paid_sar: null }, { payment_status: 'Some Customer Name!' },
    ], NOW);
    expect(d.leads).toBe(9);
    expect(d.by_status).toEqual({ paid: 6, pending: 1, '(empty)': 1, other: 1 });
    expect(d.paid).toMatchObject({ count: 4, amount_sar: 930.5, linked: 2, unlinked: 2, linked_amount_sar: 750.5, unlinked_amount_sar: 180 });
    expect(d.paid_status_no_amount).toBe(2);
    expect(d.amount_not_paid_status).toEqual({ pending: 1 });
    expect(d.by_month['2026-11']).toEqual({ closings: 4, amount_sar: 930.5 });
    expect(d.newest_updated_at).toBe('2026-11-05T01:00:00Z');
    expect(d.newest_paid_at).toBe('2026-11-04T10:00:00Z');
    expect(d.findings).toEqual(expect.arrayContaining(['amount_under_other_status', 'paid_without_amount']));
  });
  it('says what is wrong when nothing was ever paid, or the payments went stale', () => {
    expect(crmDiagnostic([{ payment_status: 'unpaid', amount_paid_sar: 0 }], NOW).findings).toContain('no_payments_at_all');
    expect(crmDiagnostic([], NOW).findings).toEqual(['no_leads']);
    expect(crmDiagnostic([paid(10, { paid_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z' })], NOW).findings).toEqual(expect.arrayContaining(['paid_stale', 'sync_stale']));
  });
});

const E = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'leen@example.com' };
const cfg = A.env(E);
const OWNER: A.Profile = { id: '11111111-1111-1111-1111-111111111111', email: 'leen@example.com', active: true };
const MEMBER = { id: '22222222-2222-2222-2222-222222222222', email: 'm@example.com', active: true, dashboards: ['maestro'] } as unknown as A.Profile;
const call = async (p: A.Profile, leads: unknown[]) => {
  const queries: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    queries.push(url);
    return new Response(JSON.stringify(url.includes('/profiles?') ? [p] : url.includes('/crm_leads?') ? leads : []));
  }));
  const cookie = `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(p, cfg), cfg.secret))}`;
  const r = await ROUTES.maestro.crm.GET!(new Request('https://well.example/api/maestro/crm', { headers: { cookie } }), E);
  return { r, queries };
};
afterEach(() => { vi.unstubAllGlobals(); });

describe('/api/maestro/crm', () => {
  it('is owner only, even for someone with the Manager tab', async () => {
    expect((await call(MEMBER, [])).r.status).toBe(403);
    expect(need('/api/maestro/crm', '')).toBe('owner');
    expect(need('/maestro/health/', '')).toBe('owner');
    expect(need('/maestro/', '')).toBe('maestro');
  });
  it('never selects or returns names, phones or lead ids, even if the database sent them', async () => {
    const leaky = { ...paid(500), lead_id: 'L-SECRET-1', customer_name: 'Synthetic Person', phone: '+966500000000', doc: { name: 'Synthetic Person' } };
    const { r, queries } = await call(OWNER, [leaky]);
    expect(r.status).toBe(200);
    const text = await r.text();
    for (const s of ['L-SECRET-1', 'Synthetic Person', '966500000000', 'lead_id', 'phone', 'name']) expect(text).not.toContain(s);
    const q = decodeURIComponent(queries.find(u => u.includes('/crm_leads?'))!);
    expect(q).not.toMatch(/select=[^&]*(lead_id|customer_id|doc|phone|name)/);
    expect(JSON.parse(text).paid.count).toBe(1);
  });
  it('says the table is missing when migration 011 was not applied', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.includes('/crm_leads?') ? new Response('{}', { status: 404 }) : new Response(JSON.stringify([OWNER])))));
    const cookie = `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(OWNER, cfg), cfg.secret))}`;
    const r = await ROUTES.maestro.crm.GET!(new Request('https://well.example/api/maestro/crm', { headers: { cookie } }), E);
    expect(((await r.json()) as { findings: string[] }).findings).toEqual(['table_missing']);
  });
});
