import { describe, expect, it } from 'vitest';
import { dataStatus } from '../../src/lib/datastatus';

const NOW = Date.parse('2026-01-10T12:00:00Z');
const ago = (h: number) => new Date(NOW - h * 36e5).toISOString();
const bucket = (o: { dash?: string | null; status?: unknown; refresh?: unknown }) => ({
  head: async () => (o.dash ? { uploaded: new Date(o.dash) } : null),
  get: async (k: string) => { const v = k.endsWith('data-status.json') ? o.status : o.refresh; return v === undefined ? null : { text: async () => JSON.stringify(v) }; },
});

describe('dataStatus', () => {
  it('fresh data with a synced CRM is ok', async () => {
    const s = await dataStatus(bucket({ dash: ago(1), status: { crm_present: true, crm_synced: ago(1) }, refresh: { ok: true } }), NOW);
    expect(s).toMatchObject({ level: 'ok', warnings: [], dash_age_hours: 1, dispatch: 'ok' });
  });
  it('3 hours is a warning, 6 hours is stale for everyone', async () => {
    expect((await dataStatus(bucket({ dash: ago(4) }), NOW))).toMatchObject({ level: 'warn', warnings: ['data_old'] });
    expect((await dataStatus(bucket({ dash: ago(7) }), NOW))).toMatchObject({ level: 'stale', warnings: ['data_very_old'] });
  });
  it('no dash.json at all is stale', async () => {
    expect(await dataStatus(bucket({ dash: null }), NOW)).toMatchObject({ level: 'stale', warnings: ['no_data'], dash_age_hours: null });
  });
  it('a dash.json built without the CRM block is flagged, an old CRM sync too', async () => {
    expect((await dataStatus(bucket({ dash: ago(1), status: { crm_present: false, crm_synced: null } }), NOW)).warnings).toEqual(['crm_missing']);
    expect((await dataStatus(bucket({ dash: ago(1), status: { crm_present: true, crm_synced: ago(30) } }), NOW)).warnings).toEqual(['crm_old']);
  });
  it('a failed dispatch is a warning even while the data is still fresh', async () => {
    const s = await dataStatus(bucket({ dash: ago(1), refresh: { at: ago(0.2), ok: false, status: 403 } }), NOW);
    expect(s).toMatchObject({ level: 'warn', warnings: ['dispatch_failed'], dispatch: 'failed' });
  });
  it('without the bucket nothing is claimed; unreadable JSON is ignored', async () => {
    expect((await dataStatus(undefined, NOW)).level).toBe('unknown');
    const b = { head: async () => ({ uploaded: new Date(NOW - 36e5) }), get: async () => ({ text: async () => '{oops' }) };
    expect((await dataStatus(b, NOW)).level).toBe('ok');
  });
  it('answers codes and numbers only, no words', async () => {
    const s = await dataStatus(bucket({ dash: ago(9), status: { crm_present: false }, refresh: { ok: false } }), NOW);
    for (const w of s.warnings) expect(w).toMatch(/^[a-z_]+$/);
  });
});
