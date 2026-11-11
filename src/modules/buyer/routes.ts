// /api/buyer/*: the media buyer's recommendations for the user's company, computed from stored numbers. Read-only twice
// over: it reads Well's own tables, and it returns advice only; nothing here talks to an ad platform or writes a campaign.
// The company's rules and limits are saved by the owner into control_settings.guardrails.buyer (database, never the repo).
import { sb, json, readJson, handle, requireUser, audit, type Cfg } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { readAll } from '../../lib/paging';
import { recommend, type AdRow, type CompanyRule, type MetricRow, type Plan } from './buyer';
import { cleanRules } from './rules';
import { PLATS, type Plat } from './playbook';
import '../../../pipeline/dash/00-judge.js';

const PLAT_KEY: Record<string, Plat> = { meta: 'meta', tiktok: 'tiktok', snap: 'snapchat', google: 'google' };
const DB_KEY: Record<Plat, string> = { meta: 'meta', tiktok: 'tiktok', snapchat: 'snap', google: 'google' };
type Row = { platform: string; guardrails?: { buyer?: { stop_cpl?: number; ladder?: number[]; rules?: CompanyRule[] }; target_cpl?: number } };

async function settings(cfg: Cfg): Promise<{ plans: Partial<Record<Plat, Plan>>; cpl: number | null; rules: CompanyRule[]; rows: Row[] }> {
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

export const report = { GET: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'buyer');
  const today = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  const since = new Date(Date.now() - 36 * 864e5).toISOString().slice(0, 10);
  const [ads, metrics, s] = await Promise.all([
    readAll<AdRow>(cfg, scoped('/rest/v1/ads?select=ad_key,platform,campaign,name,goal,live', user.co), 'ad_key.asc'),
    // ad_metrics has no company column: rows only count through this company's ads (recommend joins on ad_key)
    readAll<MetricRow>(cfg, `/rest/v1/ad_metrics?select=ad_key,day,spend,impressions,clicks,leads,conversations&day=gte.${since}`, 'ad_key.asc,day.asc', 40),
    settings(cfg),
  ]);
  if (!ads.ok || !metrics.ok) return json(500, { error: 'ما قدرت أقرأ أرقام الإعلانات' });
  const targets = globalThis.WELL_JUDGE.targets(s.cpl ? { cpl: s.cpl } : null);
  const r = recommend({ today, ads: ads.rows, metrics: metrics.rows, targets, plans: s.plans, rules: s.rules });
  return json(200, { ...r, targets: { cpl: targets.cpl, ctr: targets.ctr, clickToLead: targets.clickToLead }, rules: s.rules.length, checked_at: new Date().toISOString(), readOnly: true });
}) };

// The owner reads and saves the company's rules. Only the rule list changes; the stop line and ladder stay as they were.
export const rules = {
  GET: handle(async (request, e) => {
    const { cfg } = await requireUser(request, e, 'owner', { well: true });
    return json(200, { rules: (await settings(cfg)).rules });
  }),
  POST: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'owner', { write: true, well: true });
    const b = await readJson(request, 100_000);
    const c = cleanRules(b.rules);
    if ('error' in c) return json(400, { error: c.error });
    const s = await settings(cfg);
    for (const p of PLATS) {
      const existing = s.rows.find(r => r.platform === DB_KEY[p]);
      const guard = { ...(existing?.guardrails ?? {}) }; const buyer = { ...(guard.buyer ?? {}), rules: c.rules.filter(r => r.platform === p) };
      const w = await sb(cfg, '/rest/v1/control_settings', { method: 'POST', admin: true, headers: { Prefer: 'return=representation,resolution=merge-duplicates' }, body: { platform: DB_KEY[p], guardrails: { ...guard, buyer }, updated_by: user.email, updated_at: new Date().toISOString() } });
      if (!w.ok) return json(500, { error: 'ما انحفظت القواعد' });
    }
    // counts only: the rules themselves (names, limits) never go to the log
    await audit(cfg, user, 'buyer_rules_saved', { target: { rules: c.rules.length } });
    return json(200, { ok: true, rules: c.rules.length });
  }),
};
