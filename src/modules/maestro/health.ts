// CRM diagnostic for the owner: aggregates only. Nothing here reads or returns a name, phone or lead id:
// the query selects the seven columns below and the result is counts, sums, dates and status words.
import { sb, type Cfg } from '../../lib/auth';
import { scoped } from '../../lib/tenant';

export type CrmRow = {
  source_platform?: string | null; ad_id?: string | null; ad_id_quality?: string | null;
  payment_status?: string | null; amount_paid_sar?: number | string | null; paid_at?: string | null; updated_at?: string | null;
};
export const CRM_COLUMNS = 'source_platform,ad_id,ad_id_quality,payment_status,amount_paid_sar,paid_at,updated_at';

export type CrmDiagnostic = {
  available: boolean;
  leads: number;
  by_status: Record<string, number>;          // leads per payment_status value ('(empty)' when null)
  paid: { count: number; amount_sar: number; linked: number; unlinked: number; linked_amount_sar: number; unlinked_amount_sar: number };
  paid_status_no_amount: number;              // payment_status = paid but amount is 0 or null
  amount_not_paid_status: Record<string, number>; // amount > 0 under a status other than paid, per status
  by_month: Record<string, { closings: number; amount_sar: number }>; // paid, by paid_at month (Riyadh)
  newest_updated_at: string | null;
  newest_paid_at: string | null;
  findings: string[];                         // codes the page turns into sentences
};

const RIYADH = 3 * 3600e3;
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round2 = (n: number) => Math.round(n * 100) / 100;
// A status is a short word; anything else is counted as 'other' so odd text can never travel to the page
const label = (s: unknown) => { const t = String(s ?? '').trim(); return !t ? '(empty)' : /^[A-Za-z0-9_ -]{1,40}$/.test(t) ? t : 'other'; };
const monthOf = (iso: string) => { const t = Date.parse(iso); return Number.isNaN(t) ? '?' : new Date(t + RIYADH).toISOString().slice(0, 7); };
const newer = (a: string | null, b?: string | null) => (b && (!a || Date.parse(b) > Date.parse(a)) ? b : a);

export function crmDiagnostic(rows: CrmRow[], now = Date.now()): CrmDiagnostic {
  const d: CrmDiagnostic = { available: true, leads: rows.length, by_status: {}, paid: { count: 0, amount_sar: 0, linked: 0, unlinked: 0, linked_amount_sar: 0, unlinked_amount_sar: 0 },
    paid_status_no_amount: 0, amount_not_paid_status: {}, by_month: {}, newest_updated_at: null, newest_paid_at: null, findings: [] };
  for (const r of rows) {
    const st = label(r.payment_status), amount = num(r.amount_paid_sar);
    d.by_status[st] = (d.by_status[st] || 0) + 1;
    d.newest_updated_at = newer(d.newest_updated_at, r.updated_at);
    d.newest_paid_at = newer(d.newest_paid_at, r.paid_at);
    if (st === 'paid') {
      if (amount <= 0) { d.paid_status_no_amount++; continue; }
      const linked = !!String(r.ad_id ?? '').trim() && r.ad_id_quality !== 'broken_by_import';
      d.paid.count++; d.paid.amount_sar += amount;
      if (linked) { d.paid.linked++; d.paid.linked_amount_sar += amount; } else { d.paid.unlinked++; d.paid.unlinked_amount_sar += amount; }
      const m = r.paid_at ? monthOf(r.paid_at) : '?';
      const cur = d.by_month[m] || (d.by_month[m] = { closings: 0, amount_sar: 0 });
      cur.closings++; cur.amount_sar += amount;
    } else if (amount > 0) d.amount_not_paid_status[st] = (d.amount_not_paid_status[st] || 0) + 1;
  }
  d.paid.amount_sar = round2(d.paid.amount_sar); d.paid.linked_amount_sar = round2(d.paid.linked_amount_sar); d.paid.unlinked_amount_sar = round2(d.paid.unlinked_amount_sar);
  for (const m of Object.values(d.by_month)) m.amount_sar = round2(m.amount_sar);
  d.by_month = Object.fromEntries(Object.entries(d.by_month).sort(([a], [b]) => (a < b ? -1 : 1)));
  if (!d.leads) d.findings.push('no_leads');
  if (d.leads && !d.paid.count && !d.paid_status_no_amount && !Object.keys(d.amount_not_paid_status).length) d.findings.push('no_payments_at_all');
  if (Object.keys(d.amount_not_paid_status).length) d.findings.push('amount_under_other_status');
  if (d.paid_status_no_amount) d.findings.push('paid_without_amount');
  if (d.paid.count && d.paid.unlinked > d.paid.linked) d.findings.push('mostly_unlinked');
  if (d.paid.count && d.newest_paid_at && now - Date.parse(d.newest_paid_at) > 14 * 864e5) d.findings.push('paid_stale');
  if (d.newest_updated_at && now - Date.parse(d.newest_updated_at) > 3 * 864e5) d.findings.push('sync_stale');
  return d;
}

// Every page of a table (PostgREST returns at most 1000 rows per request). A missing table reads as `ok: false`.
export async function readAll<T>(cfg: Cfg, path: string, max = 40): Promise<{ ok: boolean; rows: T[] }> {
  const out: T[] = [];
  for (let i = 0; i < max; i++) {
    const r = await sb<T[]>(cfg, path, { admin: true, headers: { 'Range-Unit': 'items', Range: `${i * 1000}-${i * 1000 + 999}` } });
    if (!r.ok || !Array.isArray(r.data)) return { ok: i > 0, rows: out };
    out.push(...r.data);
    if (r.data.length < 1000) break;
  }
  return { ok: true, rows: out };
}

export async function crmFor(cfg: Cfg, company: string): Promise<CrmDiagnostic> {
  const r = await readAll<CrmRow>(cfg, scoped(`/rest/v1/crm_leads?select=${CRM_COLUMNS}&order=lead_id.asc`, company));
  return r.ok ? crmDiagnostic(r.rows) : { ...crmDiagnostic([]), available: false, findings: ['table_missing'] };
}
