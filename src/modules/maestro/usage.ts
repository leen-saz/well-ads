// /api/maestro/usage|budgets|reconcile: what the AI costs, per tab and month, the owner's monthly cap per tab, and the
// check against a provider invoice. Owner only (PRD: the cost screen is Leen's alone in phase 1). Nothing here logs a figure.
import { sb, json, readJson, handle, requireUser, audit, missingSchema, notApplied } from '../../lib/auth';
import { scoped } from '../../lib/tenant';
import { MODULES } from '../registry';
import { PRICES } from '../../lib/prices';
import { USD_SAR, DEFAULT_ALERT_PCT, clearSnaps, levelOf, monthStart, reconcile as compare, type Row } from '../../lib/usage';

const MIGRATION = 'migration 019_ai_usage.sql';
const TABS = MODULES.filter(m => m.status === 'live').map(m => ({ key: m.key, ar: m.ar }));
const TAB_KEYS = new Set(TABS.map(t => t.key));
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (x: unknown) => { const n = Number(x); return isFinite(n) ? n : 0; };
type Budget = { module: string; monthly_cap_usd: number | null; alert_at_pct: number };

export const usage = { GET: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'owner');
  const now = Date.now(), pick = new URL(request.url).searchParams.get('month') || '';
  const [u, b] = await Promise.all([
    sb<Row[]>(cfg, '/rest/v1/rpc/ai_spend', { method: 'POST', admin: true, body: { p_company: user.co, p_since: monthStart(now, 5) } }),
    sb<Budget[]>(cfg, scoped('/rest/v1/ai_budgets?select=module,monthly_cap_usd,alert_at_pct', user.co), { admin: true }),
  ]);
  if (!u.ok || !b.ok) return json(missingSchema(u) || missingSchema(b) ? 503 : 500, { error: missingSchema(u) || missingSchema(b) ? notApplied(MIGRATION) : 'ما قدرت أقرأ الصرف' });
  const rows = Array.isArray(u.data) ? u.data : [];
  const months = [...new Set([...rows.map(r => String(r.month)), new Date(now + 3 * 3600e3).toISOString().slice(0, 7)])].sort().reverse();
  const month = months.includes(pick) ? pick : months[0]!;
  const caps = new Map((Array.isArray(b.data) ? b.data : []).map(x => [x.module, x]));
  const nowMonth = new Date(now + 3 * 3600e3).toISOString().slice(0, 7);
  const here = rows.filter(r => String(r.month) === month);
  const byTab = new Map(here.map(r => [r.module, r]));
  const tabs = TABS.map(t => {
    const r = byTab.get(t.key), c = caps.get(t.key), spent = num(r?.cost_usd);
    const cap = c && c.monthly_cap_usd != null ? { usd: num(c.monthly_cap_usd), pct: num(c.alert_at_pct) || DEFAULT_ALERT_PCT } : undefined;
    return {
      tab: t.key, ar: t.ar, calls: num(r?.calls), tokens_in: num(r?.tokens_in), tokens_out: num(r?.tokens_out), usd: num(r?.cost_usd), sar: r2(num(r?.cost_sar)), unpriced: num(r?.unpriced),
      cap_sar: cap ? r2(cap.usd * USD_SAR) : null, alert_pct: cap?.pct ?? DEFAULT_ALERT_PCT,
      // a cap only means something for the month it limits
      level: month === nowMonth ? levelOf(spent, cap) : 'ok',
    };
  });
  const sum = (m: string) => rows.filter(r => String(r.month) === m).reduce((a, r) => ({ usd: a.usd + num(r.cost_usd), sar: a.sar + num(r.cost_sar) }), { usd: 0, sar: 0 });
  return json(200, {
    month, current: month === nowMonth, rate: USD_SAR,
    months: months.map(m => ({ month: m, usd: sum(m).usd, sar: r2(sum(m).sar) })),
    tabs, total: { usd: sum(month).usd, sar: r2(sum(month).sar) },
    prices: PRICES.map(p => ({ provider: p.provider, match: p.match, in_usd: p.inUsd, out_usd: p.outUsd, source: p.source, date: p.date, verified: p.verified })),
  });
}) };

// The owner's cap for one tab, typed in riyals (empty clears it). Stored in dollars, the unit the providers bill in.
export const budgets = { POST: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'owner', { write: true });
  const b = await readJson(request, 2000);
  const tab = String(b.tab || '');
  if (!TAB_KEYS.has(tab)) return json(400, { error: 'اختر تاب' });
  const raw = b.cap_sar === null || b.cap_sar === undefined || String(b.cap_sar).trim() === '' ? null : Number(b.cap_sar);
  if (raw !== null && !(isFinite(raw) && raw > 0 && raw <= 10_000_000)) return json(400, { error: 'السقف رقم أكبر من صفر، أو اتركه فاضي لو ما تبي سقف' });
  const pct = b.alert_pct === undefined || b.alert_pct === '' ? DEFAULT_ALERT_PCT : Math.round(Number(b.alert_pct));
  if (!(pct >= 1 && pct <= 99)) return json(400, { error: 'نسبة التنبيه بين 1 و99' });
  const r = await sb(cfg, '/rest/v1/ai_budgets?on_conflict=company_id,module', { method: 'POST', admin: true, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: { company_id: user.co, module: tab, monthly_cap_usd: raw === null ? null : Math.round((raw / USD_SAR) * 1e4) / 1e4, alert_at_pct: pct, updated_by: user.email, updated_at: new Date().toISOString() } });
  if (!r.ok) return json(missingSchema(r) ? 503 : 500, { error: missingSchema(r) ? notApplied(MIGRATION) : 'ما انحفظ السقف' });
  clearSnaps();
  await audit(cfg, user, raw === null ? 'ai_budget_cleared' : 'ai_budget_set', { target: { tab, alert_pct: pct } });
  return json(200, { ok: true });
}) };

// The acceptance gate: what we recorded for one provider in one month against the total on its invoice (USD), within 5%.
export const reconcile = { POST: handle(async (request, e) => {
  const { cfg, user } = await requireUser(request, e, 'owner', { write: true });
  const b = await readJson(request, 2000);
  const provider = String(b.provider || ''), m = MONTH.exec(String(b.month || '')), invoice = Number(b.invoice_usd);
  if (provider !== 'openai' && provider !== 'xai' && provider !== 'gemini') return json(400, { error: 'اختر المزوّد: OpenAI أو Grok' });
  if (!m) return json(400, { error: 'اختر الشهر' });
  if (!(isFinite(invoice) && invoice > 0 && invoice <= 100_000_000)) return json(400, { error: 'اكتب مبلغ الفاتورة بالدولار' });
  const from = new Date(Date.UTC(+m[1]!, +m[2]! - 1, 1) - 3 * 3600e3), to = new Date(Date.UTC(+m[1]!, +m[2]!, 1) - 3 * 3600e3);
  const r = await sb<{ calls: number; cost_usd: number; unpriced: number }[]>(cfg, '/rest/v1/rpc/ai_spend_provider', { method: 'POST', admin: true, body: { p_company: user.co, p_provider: provider, p_from: from.toISOString(), p_to: to.toISOString() } });
  if (!r.ok) return json(missingSchema(r) ? 503 : 500, { error: missingSchema(r) ? notApplied(MIGRATION) : 'ما قدرت أقرأ الصرف' });
  const row = Array.isArray(r.data) ? r.data[0] : undefined, calls = num(row?.calls), unpriced = num(row?.unpriced);
  const out = compare(num(row?.cost_usd), invoice);
  await audit(cfg, user, 'ai_reconciled', { target: { provider, month: `${m[1]}-${m[2]}`, ok: out.ok, diff_pct: out.diff_pct } });
  return json(200, { ...out, provider, month: `${m[1]}-${m[2]}`, calls, unpriced, rate: USD_SAR,
    notes: [
      ...(calls === 0 ? ['ما فيه طلبات مسجّلة لهالمزوّد بهالشهر'] : []),
      ...(unpriced ? [`${unpriced} طلب بسعر غير معروف انحسب بصفر`] : []),
      'الفاتورة تشمل أشياء ما نسجلها: بحث Grok المدفوع، والصور، وطلبات الديبقر',
    ] });
}) };
