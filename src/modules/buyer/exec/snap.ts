// Snapchat Marketing API adapter. Snap has no per-action keys: the owner's OAuth app (refresh token) is exchanged for a short
// access token on every run, kept only in memory. Updates are read-modify-write of the whole object (Snap's PUT replaces it).
// Budgets are in micro-currency (×1,000,000). Campaign-level budget is a spend cap; ad squads carry the daily budget.
import { PlatformError, type Adapter, type Entity, type ExecEnv } from './adapters';
import type { Level, Status } from './guards';

const API = 'https://adsapi.snapchat.com/v1/';
const TOKEN_URL = 'https://accounts.snapchat.com/login/oauth2/access_token';
const MICRO = 1e6;
type Row = Record<string, unknown>;
const st = (v: unknown): Status | 'other' => (v === 'ACTIVE' ? 'active' : v === 'PAUSED' ? 'paused' : 'other');

export function snapAdapter(env: ExecEnv, fetcher: typeof fetch = fetch): Adapter {
  const acct = String(env.SNAP_WRITE_AD_ACCOUNT_ID ?? '').trim();
  let access: string | null = null;

  async function token(): Promise<string> {
    if (access) return access;
    const res = await fetcher(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: String(env.SNAP_WRITE_CLIENT_ID), client_secret: String(env.SNAP_WRITE_CLIENT_SECRET), refresh_token: String(env.SNAP_WRITE_REFRESH_TOKEN) }).toString() });
    const d = await res.json().catch(() => ({})) as Row;
    if (!res.ok || typeof d.access_token !== 'string') throw new PlatformError(`snap_auth_${res.status}`);
    return (access = d.access_token);
  }
  async function call(path: string, method: 'GET' | 'PUT' = 'GET', body?: unknown): Promise<Row> {
    const res = await fetcher(API + path, { method, headers: { Authorization: `Bearer ${await token()}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const d = await res.json().catch(() => ({})) as Row;
    if (!res.ok || (d.request_status && d.request_status !== 'SUCCESS')) throw new PlatformError(`snap_${res.status}`);
    // a bulk answer carries one status per item
    for (const k of ['campaigns', 'adsquads']) for (const it of (Array.isArray(d[k]) ? d[k] as Row[] : [])) if (it.sub_request_status && it.sub_request_status !== 'SUCCESS') throw new PlatformError('snap_item');
    return d;
  }
  const unwrap = (d: Row, key: 'campaigns' | 'adsquads', inner: 'campaign' | 'adsquad'): Row[] =>
    (Array.isArray(d[key]) ? d[key] as Row[] : []).map(x => (x[inner] ?? x) as Row);
  const entity = (r: Row, level: Level): Entity => {
    const m = Number(r.daily_budget_micro);
    return { id: String(r.id), level, name: String(r.name ?? ''), status: st(r.status), budget: isFinite(m) && m > 0 ? m / MICRO : null, ...(r.campaign_id ? { campaignId: String(r.campaign_id) } : {}) };
  };
  const path = (level: Level, id: string) => level === 'campaign' ? `campaigns/${id}` : `adsquads/${id}`;
  async function raw(level: Level, id: string): Promise<Row | null> {
    try { const d = await call(path(level, id)); return unwrap(d, level === 'campaign' ? 'campaigns' : 'adsquads', level === 'campaign' ? 'campaign' : 'adsquad')[0] ?? null; }
    catch (e) { if (e instanceof PlatformError && e.code === 'snap_404') return null; throw e; }
  }
  async function put(level: Level, id: string, patch: Row): Promise<void> {
    const cur = await raw(level, id); if (!cur) throw new PlatformError('snap_gone');
    const next = { ...cur, ...patch };
    if (level === 'campaign') await call(`adaccounts/${acct}/campaigns`, 'PUT', { campaigns: [next] });
    else await call(`campaigns/${String(cur.campaign_id)}/adsquads`, 'PUT', { adsquads: [next] });
  }

  return {
    platform: 'snapchat',
    async findCampaigns(name) { return unwrap(await call(`adaccounts/${acct}/campaigns`), 'campaigns', 'campaign').filter(r => r.name === name).map(r => entity(r, 'campaign')); },
    async budgetedAdsets(campaignId) { return unwrap(await call(`campaigns/${campaignId}/adsquads`), 'adsquads', 'adsquad').filter(r => r.status === 'ACTIVE' && Number(r.daily_budget_micro) > 0).map(r => entity(r, 'adset')); },
    async read(level, id) { const r = await raw(level, id); return r ? entity(r, level) : null; },
    async setBudget(level, id, daily) { await put(level, id, { daily_budget_micro: Math.round(daily * MICRO) }); },
    async setStatus(level, id, to) { await put(level, id, { status: to === 'paused' ? 'PAUSED' : 'ACTIVE' }); },
  };
}
