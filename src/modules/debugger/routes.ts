// /api/debugger/*: tracking health for the user's company, computed from stored data (read-only).
// report = the findings; explain = Claude's plan for them (paid, needs ANTHROPIC_API_KEY).
import { json, handle, requireUser, notEnabled, type AuthEnv, type Cfg, type Session } from '../../lib/auth';
import { scoped, WELL_COMPANY } from '../../lib/tenant';
import { readAll as all } from '../../lib/paging';
import { diagnose, type AdRow, type ConnRow, type LeadRow, type MetricRow } from './debugger';
import { explain as claude, explainViaOpenRouter, type ClaudeEnv } from './explain';
import { viaOpenRouter, type LlmEnv } from '../../lib/llm';
import { overCap, record, usageCtx } from '../../lib/usage';
import { linkedShare } from '../../lib/linked';

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

// The same linked-to-an-ad numbers as the performance summary and the data-health page: from dash.json's crm block (R2)
async function linked(e: { FILES?: R2Bucket }) {
  try {
    const obj = await e.FILES?.get('site/dash.json');
    return obj ? linkedShare(((await obj.json()) as { crm?: unknown }).crm) : null;
  } catch { return null; }
}

export const report = { GET: handle(async (request, e: AuthEnv & { FILES?: R2Bucket }) => {
  const { cfg, user } = await requireUser(request, e, 'debugger');
  // dash.json is Well's own pipeline output: another company's users get their own findings, not Well's linked-lead share
  return json(200, { ...(await build(cfg, user)), linked: user.co === WELL_COMPANY ? await linked(e) : null });
}) };

// The findings are read again on the server: Claude gets this company's data, never what the page sends
// Runs on Claude, unless the owner routed the Debugger to OpenRouter (Maestro → models); if that fails, Claude answers when its key is there.
export const explain = { POST: handle(async (request, e: AuthEnv & ClaudeEnv & LlmEnv) => {
  const { cfg, user } = await requireUser(request, e, 'debugger', { write: true });
  const ctx = usageCtx(cfg, user, 'debugger'), orOn = await viaOpenRouter(e, 'debugger', ctx);
  if (!orOn && !e.ANTHROPIC_API_KEY) return json(503, { error: notEnabled(user, 'الشرح بـ Claude', 'ANTHROPIC_API_KEY') });
  const r = await build(cfg, user);
  try {
    if (orOn && ctx) {
      try { return json(200, await explainViaOpenRouter(e, r.findings, r.platforms, ctx)); }
      catch (err) { console.warn('debugger_openrouter_failed', (err as Error).message); if (!e.ANTHROPIC_API_KEY) throw err; }
    }
    // Claude is billed per call, so it is recorded like the others and stops at the tab's monthly cap
    if (ctx && await overCap(ctx, 'debugger')) return json(429, { error: 'وصل الديبقر سقفه الشهري للذكاء الاصطناعي. تواصل مع الإدارة.' });
    const out = await claude(e, r.findings, r.platforms);
    record(ctx, 'debugger', { provider: 'anthropic', model: out.model, usage: out.usage });
    return json(200, { text: out.text, model: out.model });
  }
  catch (err) { console.warn('debugger_explain_failed', (err as Error).message); return json(502, { error: 'Claude ما رد الحين، جرّب بعد دقيقة' }); }
}) };
