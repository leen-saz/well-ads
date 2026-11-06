// صحة الداتا (للمالكة): بطاقات قراءة فقط. كل بطاقة تجيب أرقامها من /api/maestro/<اسمها>.
import { $, api, say, esc, fmt, shell } from '/assets/common.js';

const STATUS = { paid: 'مدفوع', unpaid: 'غير مدفوع', pending: 'معلّق', partial: 'مدفوع جزئي', refunded: 'مسترجع', '(empty)': 'فاضي', other: 'قيمة ثانية' };
const FINDING = {
  table_missing: 'جدول الليدز غير موجود: شغّل مايقريشن 011_crm_leads أول.',
  no_leads: 'ما فيه ليدز مخزّنة. تأكد إن CRM_API_KEY موجود وإن مزامنة الـ CRM اشتغلت.',
  no_payments_at_all: 'ما فيه ولا ليد عنده دفع (لا حالة مدفوع ولا مبلغ). المشكلة من الـ CRM نفسه: الدفع ما يوصل لنا.',
  amount_under_other_status: 'فيه ليدز عندها مبلغ مدفوع لكن حالة الدفع مو «مدفوع». هذي ما تنحسب إقفالات: غالباً قيمة حالة الدفع مختلفة عن اللي نتوقعه (انظر الجدول).',
  paid_without_amount: 'فيه ليدز حالتها «مدفوع» بس المبلغ صفر أو فاضي. هذي ما تنحسب إقفالات ولا تدخل في الإيراد.',
  mostly_unlinked: 'أغلب الإقفالات بدون إعلان مربوط، فتطلع في الإجمالي وما تنسب لإعلان.',
  paid_stale: 'آخر دفع مسجّل قبل أكثر من 14 يوم. يمكن الدفع ما يتسجّل في الـ CRM أو ما يوصلنا.',
  sync_stale: 'آخر تحديث وصلنا من الـ CRM قبل أكثر من 3 أيام. المزامنة متوقفة أو ما فيه تغييرات.',
};
const when = iso => iso ? new Date(iso).toLocaleString('ar-SA-u-nu-latn', { timeZone: 'Asia/Riyadh', dateStyle: 'medium', timeStyle: 'short' }) : '—';
const kpi = (n, t) => `<div class="card dh-kpi"><b>${n}</b><span>${t}</span></div>`;
const table = (head, rows) => `<table class="dh-tbl"><thead><tr>${head.map((h, i) => `<th class="${i ? 'n' : ''}">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td class="${i ? 'n' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

export function crmCard(d) {
  const p = d.paid;
  const finds = d.findings.map(f => FINDING[f]).filter(Boolean).map(t => `<p class="dh-find bad">${esc(t)}</p>`).join('') || '<p class="dh-find ok">ما لقينا مشكلة واضحة في الدفع.</p>';
  const status = Object.entries(d.by_status).sort((a, b) => b[1] - a[1]).map(([s, n]) => [esc(STATUS[s] || s) + (STATUS[s] ? ` <span class="muted">(${esc(s)})</span>` : ''), fmt(n)]);
  const other = Object.entries(d.amount_not_paid_status).map(([s, n]) => [esc(STATUS[s] || s), fmt(n)]);
  const months = Object.entries(d.by_month).map(([m, v]) => [esc(m), fmt(v.closings), fmt(v.amount_sar)]);
  return `<section class="card pad dh-sec"><h2>ليدز الـ CRM والدفع</h2><p class="muted" style="margin:0">الإقفالة = حالة الدفع «paid» ومبلغ أكبر من صفر.</p>${finds}
    <div class="dh-kpis">${kpi(fmt(d.leads), 'ليدز مخزّنة')}${kpi(fmt(p.count), 'إقفالات (مدفوع ومبلغ)')}${kpi(fmt(p.amount_sar) + ' ر.س', 'مبلغ الإقفالات')}
      ${kpi(fmt(d.paid_status_no_amount), 'مدفوع بمبلغ صفر أو فاضي')}${kpi(fmt(p.linked), 'إقفالات مربوطة بإعلان')}${kpi(fmt(p.unlinked), 'إقفالات بدون إعلان')}</div>
    <div class="dh-kpis">${kpi(when(d.newest_updated_at), 'أحدث تحديث (updated_at)')}${kpi(when(d.newest_paid_at), 'أحدث دفع (paid_at)')}</div>
    <h3>الليدز حسب حالة الدفع</h3>${status.length ? table(['الحالة', 'ليدز'], status) : '<p class="muted">لا شي.</p>'}
    ${other.length ? `<h3>مبلغ مدفوع تحت حالة غير «مدفوع»</h3>${table(['الحالة', 'ليدز'], other)}` : ''}
    <h3>الإقفالات والمبالغ حسب شهر الدفع</h3>${months.length ? table(['الشهر', 'إقفالات', 'المبلغ (ر.س)'], months) : '<p class="muted">لا شي.</p>'}
    ${p.count ? `<p class="muted">المربوطة بإعلان: ${fmt(p.linked_amount_sar)} ر.س. بدون إعلان: ${fmt(p.unlinked_amount_sar)} ر.س.</p>` : ''}</section>`;
}

export default async function mount() {
  shell({ active: 'maestro', title: 'صحة الداتا' }).then(async () => {
    try { $('#sections').innerHTML = crmCard(await api('/api/maestro/crm')); }
    catch (err) { $('#sections').innerHTML = ''; say($('#msg'), err.message); }
  }).catch(err => say($('#msg'), err.message));
}
