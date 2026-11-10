// /api/maestro/audit (GET) and /api/maestro/critique (POST): «تدقيق القرارات», OWNER ONLY. The auditor re-reads dash.json from
// R2 itself (the page sends nothing but the period), recomputes, argues against the verdict, replays history, and writes each
// disagreement to the audit log as ids and counts, never a figure. The critique (Claude, paid, needs ANTHROPIC_API_KEY) is a
// draft on top; the audit works without any key.
import { json, handle, requireUser, audit as logAudit, sb, notEnabled, type AuthEnv } from '../../lib/auth';
import { scoped, WELL_COMPANY } from '../../lib/tenant';
import { usageCtx } from '../../lib/usage';
import { viaOpenRouter } from '../../lib/llm';
import type { Dash } from '../overview/numbers';
import { audit } from './audit';
import { claimFromJudge, judgeHeadline } from './adapter';
import { backtest } from './backtest';
import { critique, type CriticEnv } from './critic';
import { type Raw, dayAdd, rowsOf } from './facts';

type Env = AuthEnv & CriticEnv & { FILES?: R2Bucket };
const DAY = /^\d{4}-\d{2}-\d{2}$/;

async function load(e: Env, url: URL): Promise<{ d: Dash & Raw; from: string; to: string; plat?: string; by: 'lead' | 'paid' } | Response> {
  const obj = e.FILES ? await e.FILES.get('site/dash.json') : null;
  if (!obj) return json(404, { error: 'ما فيه أرقام للحين' });
  const raw = (await obj.json()) as Raw & Dash;
  const d = { ...raw, rows: rowsOf(raw) } as Dash & Raw;
  const last = d.range?.end;
  if (!last) return json(404, { error: 'ما فيه أرقام للحين' });
  const q = url.searchParams, to = DAY.test(q.get('to') || '') ? q.get('to')! : last;
  const days = Math.round(Number(q.get('days')));
  const from = DAY.test(q.get('from') || '') ? q.get('from')! : dayAdd(to, -((days >= 3 && days <= 365 ? days : 30) - 1));
  if (from > to) return json(400, { error: 'طلب غير صحيح' });
  const plat = q.get('plat') || undefined;
  if (plat && !Object.values(d.ads ?? {}).some(a => a.platform === plat)) return json(400, { error: 'طلب غير صحيح' });
  return { d, from, to, ...(plat ? { plat } : {}), by: q.get('by') === 'paid' ? 'paid' : 'lead' };
}

export const auditRoute = { GET: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'owner');
  // dash.json is Well's own numbers: another company's owner gets nothing
  if (user.co !== WELL_COMPANY) return json(404, { error: 'ما فيه أرقام لشركتك للحين' });
  const url = new URL(request.url), L = await load(e, url);
  if (L instanceof Response) return L;
  const { d, from, to, plat, by } = L;
  const claim = claimFromJudge(d, from, to, by, plat), r = audit(d, claim), head = judgeHeadline(d, from, to, by, plat);
  const bt = backtest(d, d.range!.end!, { back: Math.min(180, Math.max(28, Number(url.searchParams.get('back')) || 90)) });

  // The log of disagreements: one row per (period, platform, step, status, set of checks), written once. Ids only.
  const checks = [...new Set(r.verdict.findings.filter(f => f.effect !== 'info').map(f => f.id))].sort();
  if (r.status !== 'confirmed') {
    const key = [to, plat ?? 'all', claim.verdict.step ?? 'none', r.status, checks.join(',')].join('|');
    const seen = await sb<unknown[]>(cfg, scoped(`/rest/v1/audit_log?select=id&action=eq.verdict_audit&target->>key=eq.${encodeURIComponent(key)}&limit=1`, user.co), { admin: true });
    if (seen.ok && Array.isArray(seen.data) && !seen.data.length)
      await logAudit(cfg, user, 'verdict_audit', { target: { key, to, plat: plat ?? 'all', step: claim.verdict.step, level: claim.verdict.level, status: r.status, checks } });
  }
  const log = await sb<{ at: string; target: Record<string, unknown> | null }[]>(cfg, scoped('/rest/v1/audit_log?select=at,target&action=eq.verdict_audit&order=at.desc&limit=30', user.co), { admin: true });
  return json(200, {
    period: { from, to, plat: plat ?? null }, headline: head, status: r.status, checked: r.checked,
    verdict: { step: claim.verdict.step, level: claim.verdict.level, findings: r.verdict.findings },
    steps: Object.fromEntries(Object.entries(r.steps).map(([k, v]) => [k, { status: v!.status, findings: v!.findings }])),
    backtest: bt, critic: !!e.ANTHROPIC_API_KEY,
    log: log.ok && Array.isArray(log.data) ? log.data.map(x => ({ at: x.at, to: x.target?.to, plat: x.target?.plat, step: x.target?.step, status: x.target?.status, checks: x.target?.checks })) : [],
  });
}) };

export const critiqueRoute = { POST: handle(async (request, e: Env) => {
  const { cfg, user } = await requireUser(request, e, 'owner', { write: true });
  if (user.co !== WELL_COMPANY) return json(404, { error: 'ما فيه أرقام لشركتك للحين' });
  const cctx = usageCtx(cfg, user, 'overview');
  if (!e.ANTHROPIC_API_KEY && !(await viaOpenRouter(e, 'overview', cctx))) return json(503, { error: notEnabled(user, 'مراجعة Claude', 'ANTHROPIC_API_KEY') });
  const L = await load(e, new URL(request.url));
  if (L instanceof Response) return L;
  const claim = claimFromJudge(L.d, L.from, L.to, L.by, L.plat), r = audit(L.d, claim);
  try { return json(200, await critique(e, claim, r.findings, undefined, cctx)); }
  catch (err) { console.warn('auditor_critique_failed', (err as Error).message); return json(502, { error: 'Claude ما رد الحين، جرّب بعد دقيقة' }); }
}) };
