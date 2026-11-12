// ONE definition of «مربوط بإعلان», read from the crm block of dash.json (pipeline/crm/join.py attach). Used by the
// performance summary, «صحة الداتا» and «التتبع», so the three pages say the same thing (UX audit 2026-11-12, note 1).
//   linked lead    = a CRM lead that matched one of our ads: by ad id, by an unambiguous ad name, or (closings only) the
//                    same customer's earlier ad lead (join.py)
//   linked closing = a paid lead (payment_status paid and an amount) that ended up on an ad by the same rules
//   unattributed   = every other paid closing: it counts in the CRM total, never in an ad's return
// Why a lead is not linked (no ad id, damaged id, not an ad source…) is a different question: crm.attribution answers it.
export interface Linked {
  leads: number; linked: number; unlinked: number; leadsPct: number | null;
  closings: number; closingsLinked: number; closingsUnlinked: number; closingsPct: number | null;
}
export const LINKED_DEF_AR = 'مربوط بإعلان = ليد (أو إقفالة) انطبق مع إعلان من إعلاناتنا برقم الإعلان أو باسمه الفريد، أو عبر نفس العميل لإعلان سابق. الباقي «غير منسوب».';
export const LINKED_DEF_EN = 'Linked to an ad = a lead (or closing) matched one of our ads by ad id, by its unique name, or through the same customer\'s earlier ad lead. The rest is «unattributed».';

const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : null);

export function linkedShare(crm: unknown): Linked | null {
  if (!crm || typeof crm !== 'object') return null;
  const c = crm as { rows?: unknown; paid_all?: unknown; total?: unknown };
  if (!Array.isArray(c.rows)) return null;
  const leads = Number(c.total) || 0, linked = Math.min(c.rows.length, leads || c.rows.length);
  const closings = Array.isArray(c.paid_all) ? c.paid_all.length : 0;
  // A second payment on one ad lead is its own row, so linked closings can never exceed all closings
  const closingsLinked = Math.min(closings, c.rows.filter(r => Array.isArray(r) && r[3] === 1).length);
  return { leads, linked, unlinked: Math.max(0, leads - linked), leadsPct: pct(linked, leads),
    closings, closingsLinked, closingsUnlinked: closings - closingsLinked, closingsPct: pct(closingsLinked, closings) };
}
