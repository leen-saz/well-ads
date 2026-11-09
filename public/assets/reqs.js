// الإعدادات ← طلبات الموقع: المالكة تقرا طلبات صفحات Apipeline، تغيّر حالتها، أو تحذفها (PDPL: حذف عند الطلب).
import { $, api, say, esc, shell, busy, settingsTabs, when, icon, LANG } from './common.js';

const KIND = { board: ['تجربة اللوحة', 'Board trial'], leakmap: ['خريطة التسرب', 'Leak Map'], security: ['فحص أمني', 'Security audit'], other: ['استفسار', 'Enquiry'] };
const SCOPE = { code: ['الكود', 'Code'], web: ['الموقع والـ API', 'Web & API'], mobile: ['الجوال', 'Mobile'], cloud: ['السحابة', 'Cloud'] };
const STATUS = { new: ['جديد', 'New'], contacted: ['تواصلنا', 'Contacted'], closed: ['مقفل', 'Closed'] };

export default async function mount() {
  const L = (pair) => pair[LANG === 'en' ? 1 : 0];
  const me = await shell({ active: 'settings', title: LANG === 'en' ? 'Settings' : 'الإعدادات' });
  settingsTabs('requests', me);
  const list = $('#rq-list'), msg = $('#msg');

  const card = r => {
    const wa = `https://wa.me/${r.phone.replace(/^\+/, '')}`;
    return `<article class="rq" data-id="${r.id}" data-status="${esc(r.status)}">
      <div class="rq-head"><b>${esc(r.name)}</b>${r.company ? `<span class="muted">${esc(r.company)}</span>` : ''}
        <span class="chip">${esc(L(KIND[r.kind] || KIND.other))}</span>
        ${(r.scope || []).map(s => `<span class="chip">${esc(L(SCOPE[s] || [s, s]))}</span>`).join('')}
        <span class="muted" style="margin-inline-start:auto">${when(r.at)}</span></div>
      <div class="rq-meta">
        <a href="${esc(wa)}" target="_blank" rel="noopener" dir="ltr">${esc(r.phone)}</a>
        ${r.email ? `<a href="mailto:${esc(r.email)}" dir="ltr">${esc(r.email)}</a>` : ''}
        <span class="muted">${esc(r.page)}</span>
      </div>
      ${r.message ? `<p class="rq-msg">${esc(r.message)}</p>` : ''}
      <div class="rq-acts">
        <select data-status-select aria-label="${LANG === 'en' ? 'Status' : 'الحالة'}">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${k === r.status ? ' selected' : ''}>${esc(L(v))}</option>`).join('')}</select>
        <button class="btn ghost sm" type="button" data-del>${icon('x')}${LANG === 'en' ? 'Delete' : 'حذف'}</button>
      </div>
    </article>`;
  };

  const load = async () => {
    list.innerHTML = `<p class="muted">${LANG === 'en' ? 'Loading…' : 'يحمّل…'}</p>`;
    try {
      const st = $('#rq-filter').value;
      const r = await api('/api/site/requests' + (st ? `?status=${st}` : ''));
      if (r.missing) { list.innerHTML = ''; say(msg, r.missing); return; }
      list.innerHTML = r.requests.length ? r.requests.map(card).join('')
        : `<div class="empty">${icon('inbox')}<p>${LANG === 'en' ? 'No requests yet.' : 'ما وصل طلب للحين.'}</p></div>`;
    } catch (err) { list.innerHTML = ''; say(msg, err.message); }
  };

  $('#rq-filter').onchange = load;
  list.onchange = async e => {
    const sel = e.target.closest('[data-status-select]'); if (!sel) return;
    const art = sel.closest('.rq');
    try { await api('/api/site/requests', { method: 'PATCH', body: { id: Number(art.dataset.id), status: sel.value } }); art.dataset.status = sel.value; say(msg, LANG === 'en' ? 'Saved.' : 'انحفظ.', true); }
    catch (err) { say(msg, err.message); }
  };
  list.onclick = async e => {
    const b = e.target.closest('[data-del]'); if (!b) return;
    if (!confirm(LANG === 'en' ? 'Delete this request for good? This cannot be undone.' : 'تحذف هالطلب نهائيًا؟ ما تقدر ترجعه.')) return;
    const art = b.closest('.rq');
    busy(b, true);
    try { await api('/api/site/requests', { method: 'DELETE', body: { id: Number(art.dataset.id) } }); art.remove(); say(msg, LANG === 'en' ? 'Deleted.' : 'انحذف.', true); }
    catch (err) { say(msg, err.message); busy(b, false); }
  };
  await load();
}
