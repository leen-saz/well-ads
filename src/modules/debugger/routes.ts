// /api/debugger/report: tracking health for the user's company, computed from stored data (read-only).
import { sb, json, handle, requireUser, type Cfg } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { diagnose, type AdRow, type ConnRow, type LeadRow, type MetricRow } from './debugger';

// Reads every page of a table (PostgREST returns at most 1000 rows per request). A missing table reads as empty.
async function all<T>(cfg: Cfg, path: string, max = 20): Promise<{ ok: boolean; rows: T[] }> {
  const out: T[] = [];
  for (let i = 0; i < max; i++) {
    const r = await sb<T[]>(cfg, path, { admin: true, headers: { 'Range-Unit': 'items', Range: `${i * 1000}-${i * 1000 + 999}` } });
    if (!r.ok || !Array.isArray(r.data)) return { ok: i > 0, rows: out };
    out.push(...r.data);
    if (r.data.length < 1000) break;
  }
  return { ok: true, rows: out };
}

export const report = { GET: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'debugger');
  const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  const d14 = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10), d30 = new Date(Date.now() - 30 * 864e5).toISOString();
  const [ads, conns, leads] = await Promise.all([
    all<AdRow>(cfg, scoped('/rest/v1/ads?select=ad_key,platform,name,goal,live,link', user.co)),
    all<ConnRow>(cfg, scoped('/rest/v1/connections?select=platform,expires_at', user.co), 1),
    all<LeadRow>(cfg, scoped(`/rest/v1/crm_leads?select=source_platform,ad_id,ad_id_quality,created_at&created_at=gte.${d30}`, user.co)),
  ]);
  // ad_metrics has no company column: its rows are kept only for this company's ads (diagnose joins on ad_key)
  const metrics = await all<MetricRow>(cfg, `/rest/v1/ad_metrics?select=ad_key,day,spend,leads&day=gte.${d14}`);
  const r = diagnose({ today, ads: ads.rows, metrics: metrics.rows, leads: leads.rows, connections: conns.rows,
    tables: { ads: ads.ok, metrics: metrics.ok, leads: leads.ok, connections: conns.ok } });
  return json(200, { ...r, checked_at: new Date().toISOString(), counts: { ads: ads.rows.length, metrics: metrics.rows.length, leads: leads.rows.length } });
}) };
