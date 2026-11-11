// Meta Marketing API adapter (Graph API). The token goes in the Authorization header, never in the URL, so it cannot land in a log.
// Budgets are read and written in the account currency's minor units (SAR: halalas, ×100; a few currencies have none).
// Needs a system-user token with ads_management on the one ad account (docs/media-buyer/execution.md).
import { PlatformError, type Adapter, type Entity, type ExecEnv } from './adapters';
import type { Level, Status } from './guards';

const GRAPH = 'https://graph.facebook.com/v23.0/';
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'HUF', 'TWD', 'UGX', 'PYG']);

type Row = Record<string, unknown>;
const st = (v: unknown): Status | 'other' => (v === 'ACTIVE' ? 'active' : v === 'PAUSED' ? 'paused' : 'other');

export function metaAdapter(env: ExecEnv, fetcher: typeof fetch = fetch): Adapter {
  const token = String(env.META_WRITE_TOKEN ?? '').trim();
  const acct = 'act_' + String(env.META_WRITE_AD_ACCOUNT_ID ?? '').trim().replace(/^act_/, '');
  let offset: number | null = null;

  async function call(path: string, method: 'GET' | 'POST' = 'GET', params: Record<string, string> = {}): Promise<Row> {
    const qs = new URLSearchParams(params).toString();
    const res = await fetcher(GRAPH + path + (method === 'GET' && qs ? `?${qs}` : ''), {
      method, headers: { Authorization: `Bearer ${token}`, ...(method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      ...(method === 'POST' ? { body: qs } : {}),
    });
    const text = await res.text(); let data: Row = {};
    try { data = text ? JSON.parse(text) as Row : {}; } catch { /* not JSON */ }
    if (!res.ok) { const e = (data.error ?? {}) as Row; throw new PlatformError(`meta_${res.status}_${Number(e.code) || 0}`); }
    return data;
  }
  async function minor(): Promise<number> {
    if (offset == null) { const a = await call(acct, 'GET', { fields: 'currency' }); offset = ZERO_DECIMAL.has(String(a.currency ?? '').toUpperCase()) ? 1 : 100; }
    return offset;
  }
  const entity = async (r: Row, level: Level): Promise<Entity> => {
    const b = Number(r.daily_budget);
    const camp = r.campaign_id as string | undefined;
    return { id: String(r.id), level, name: String(r.name ?? ''), status: st(r.status), budget: r.daily_budget != null && isFinite(b) && b > 0 ? b / (await minor()) : null, ...(camp ? { campaignId: camp } : {}) };
  };
  const F = 'id,name,status,daily_budget';

  return {
    platform: 'meta',
    async findCampaigns(name) {
      const d = await call(`${acct}/campaigns`, 'GET', { fields: F, limit: '500' });
      const rows = (Array.isArray(d.data) ? d.data : []) as Row[];
      return Promise.all(rows.filter(r => r.name === name).map(r => entity(r, 'campaign')));
    },
    async budgetedAdsets(campaignId) {
      const d = await call(`${campaignId}/adsets`, 'GET', { fields: F + ',campaign_id', limit: '100' });
      const rows = (Array.isArray(d.data) ? d.data : []) as Row[];
      return Promise.all(rows.filter(r => r.status === 'ACTIVE' && Number(r.daily_budget) > 0).map(r => entity(r, 'adset')));
    },
    async read(level, id) {
      try { return await entity(await call(id, 'GET', { fields: F + (level === 'campaign' ? '' : ',campaign_id') }), level); }
      catch (e) { if (e instanceof PlatformError && /^meta_(400|404)_/.test(e.code)) return null; throw e; }
    },
    async setBudget(_level, id, daily) { await call(id, 'POST', { daily_budget: String(Math.round(daily * await minor())) }); },
    async setStatus(_level, id, to) { await call(id, 'POST', { status: to === 'paused' ? 'PAUSED' : 'ACTIVE' }); },
  };
}
