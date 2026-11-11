// The report the page shows and the executor re-derives (so a proposal always comes from the server's own analysis, never from
// what a browser sent): ads and metrics of the user's company, the company's settings, the marketing judge's targets.
import { sb, type Cfg, type Session } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { readAll } from '../../lib/paging';
import { recommend, type AdRow, type CompanyRule, type MetricRow, type Plan, type Report } from './buyer';
import { cleanRules } from './rules';
import { PLATS, type Plat } from './playbook';
import '../../../pipeline/dash/00-judge.js';

export const PLAT_KEY: Record<string, Plat> = { meta: 'meta', tiktok: 'tiktok', snap: 'snapchat', google: 'google' };
export const DB_KEY: Record<Plat, string> = { meta: 'meta', tiktok: 'tiktok', snapchat: 'snap', google: 'google' };
type Row = { platform: string; guardrails?: { buyer?: { stop_cpl?: number; ladder?: number[]; rules?: CompanyRule[] }; target_cpl?: number } };

export async function settings(cfg: Cfg): Promise<{ plans: Partial<Record<Plat, Plan>>; cpl: number | null; rules: CompanyRule[]; rows: Row[] }> {
  const r = await sb<Row[]>(cfg, '/rest/v1/control_settings?select=platform,guardrails', { admin: true });
  const rows = r.ok && Array.isArray(r.data) ? r.data : [];
  const plans: Partial<Record<Plat, Plan>> = {}; let cpl: number | null = null; const rules: CompanyRule[] = [];
  for (const row of rows) {
    const p = PLAT_KEY[row.platform], b = row.guardrails?.buyer;
    if (!p || !PLATS.includes(p) || !b) continue;
    const ladder = Array.isArray(b.ladder) ? b.ladder.map(Number).filter(v => v > 0 && isFinite(v)).sort((a, c) => a - c) : undefined;
    plans[p] = { ...(Number(b.stop_cpl) > 0 ? { stopCpl: Number(b.stop_cpl) } : {}), ...(ladder?.length ? { ladder } : {}) };
    const t = Number(row.guardrails?.target_cpl); if (t > 0) cpl = t;
    const clean = cleanRules(b.rules ?? []); if ('rules' in clean) rules.push(...clean.rules.filter(x => x.platform === p));
  }
  return { plans, cpl, rules, rows };
}

export type Built = { ok: true; report: Report & { targets: { cpl: number; ctr: number; clickToLead: number }; rules: number; checked_at: string } } | { ok: false };
export async function buildReport(cfg: Cfg, user: Pick<Session, 'co'>): Promise<Built> {
  const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  const since = new Date(Date.now() - 36 * 864e5).toISOString().slice(0, 10);
  const [ads, metrics, s] = await Promise.all([
    readAll<AdRow>(cfg, scoped('/rest/v1/ads?select=ad_key,platform,campaign,name,goal,live', user.co), 'ad_key.asc'),
    // ad_metrics has no company column: rows only count through this company's ads (recommend joins on ad_key)
    readAll<MetricRow>(cfg, `/rest/v1/ad_metrics?select=ad_key,day,spend,impressions,clicks,leads,conversations&day=gte.${since}`, 'ad_key.asc,day.asc', 40),
    settings(cfg),
  ]);
  if (!ads.ok || !metrics.ok) return { ok: false };
  const targets = globalThis.WELL_JUDGE.targets(s.cpl ? { cpl: s.cpl } : null);
  const r = recommend({ today, ads: ads.rows, metrics: metrics.rows, targets, plans: s.plans, rules: s.rules });
  return { ok: true, report: { ...r, targets: { cpl: targets.cpl, ctr: targets.ctr, clickToLead: targets.clickToLead }, rules: s.rules.length, checked_at: new Date().toISOString() } };
}
