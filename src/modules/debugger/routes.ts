// /api/debugger/*: tracking health for the user's company, computed from stored data (read-only).
// report = the findings; explain = Claude's plan for them (paid, needs ANTHROPIC_API_KEY).
import { json, handle, requireUser, notEnabled, type AuthEnv, type Cfg, type Session } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { readAll as all } from '../../lib/paging';
import { diagnose, type AdRow, type ConnRow, type LeadRow, type MetricRow } from './debugger';
import { explain as claude, type ClaudeEnv } from './explain';

async function build(cfg: Cfg, user: Session) {
  const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  const d14 = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10), d30 = new Date(Date.now() - 30 * 864e5).toISOString();
  const [ads, conns, leads] = await Promise.all([
    all<AdRow>(cfg, scoped('/rest/v1/ads?select=ad_key,platform,name,goal,live,link', user.co), 'ad_key.asc'),
    all<ConnRow>(cfg, scoped('/rest/v1/connections?select=platform,expires_at', user.co), 'platform.asc', 1),
    all<LeadRow>(cfg, scoped(`/rest/v1/crm_leads?select=source_platform,ad_id,ad_id_quality,created_at&created_at=gte.${d30}`, user.co), 'lead_id.asc'),
  ]);
  // ad_metrics has no company column: its rows are kept only for this company's ads (diagnose joins on ad_key)
  const metrics = await all<MetricRow>(cfg, `/rest/v1/ad_metrics?select=ad_key,day,spend,leads&day=gte.${d14}`, 'ad_key.asc,day.asc');
  const r = diagnose({ today, ads: ads.rows, metrics: metrics.rows, leads: leads.rows, connections: conns.rows,
    tables: { ads: ads.ok, metrics: metrics.ok, leads: leads.ok, connections: conns.ok } });
  return { ...r, checked_at: new Date().toISOString(), counts: { ads: ads.rows.length, metrics: metrics.rows.length, leads: leads.rows.length } };
}

export const report = { GET: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'debugger');
  return json(200, await build(cfg, user));
}) };

// The findings are read again on the server: Claude gets this company's data, never what the page sends
export const explain = { POST: handle(async (request, e: AuthEnv & ClaudeEnv) => {
  const { cfg, user } = await requireUser(request, e, 'debugger', { write: true });
  if (!e.ANTHROPIC_API_KEY) return json(503, { error: notEnabled(user, 'الشرح بـ Claude', 'ANTHROPIC_API_KEY') });
  const r = await build(cfg, user);
  try { return json(200, await claude(e, r.findings, r.platforms)); }
  catch (err) { console.warn('debugger_explain_failed', (err as Error).message); return json(502, { error: 'Claude ما رد الحين، جرّب بعد دقيقة' }); }
}) };
