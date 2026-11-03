// الامتثال: يفحص نصوص إعلاناتنا ونص حر على قواعد الإعلان الصحي والكلمات الممنوعة في المعرفة، ويعرض العبارة بالضبط
// والقاعدة ومصدرها والصياغة الأسلم، ويقترح إعادة صياغة. تنويه بس، ما يمنع النشر.
import { $, $$, api, say, esc, shell, busy, fmt } from '/assets/common.js';
import { block, marked, hitsHTML } from '/assets/compliance-ui.js';

const PLAT = { meta: 'ميتا', snapchat: 'سناب شات', tiktok: 'تيك توك', google: 'جوجل' };

export default async function mount() {
  let live = '1';
  async function load() {
    $('#list').innerHTML = '<p class="muted">يفحص…</p>';
    try {
      const r = await api(`/api/compliance/scan?live=${live}`);
      const s = r.summary || {};
      $('#sum').innerHTML = [['critical', 'مخالفة'], ['warn', 'انتبه'], ['info', 'ملاحظة']].map(([k, l]) => `<div class="card"><b>${fmt(s[k] || 0)}</b><span>${l}</span></div>`).join('')
        + `<div class="card"><b>${fmt(r.checked || 0)}</b><span>إعلان انفحص</span></div>`;
      $('#list').innerHTML = (r.ads || []).length ? r.ads.map(a => `<article class="card dg-f ${a.worst}">
          <div class="cp-meta"><b>${esc(a.name || a.ad_key)}</b><span class="muted">${esc(PLAT[a.platform] || a.platform)}${a.live ? ' · نشط' : ''}</span></div>
          <p class="cp-q" dir="auto">${marked(a.text || '', a.hits)}</p>${hitsHTML(a.hits)}</article>`).join('')
        : '<div class="card dg-ok"><b>ما لقيت مخالفات في نصوص الإعلانات.</b></div>';
    } catch (err) { $('#list').innerHTML = ''; say($('#msg'), err.message); }
  }
  function showOne(text, hits) {
    $('#one').innerHTML = hits.length ? block(text, hits) + (hits.some(h => h.level !== 'info') ? '<div class="bar" style="margin-top:8px"><button class="btn" type="button" id="rw">اقترح صياغة أسلم</button></div>' : '')
      : '<div class="card dg-ok"><b>النص سليم حسب القواعد.</b></div>';
  }
  $('#f').addEventListener('submit', async e => {
    e.preventDefault(); const btn = e.submitter; busy(btn, true);
    try {
      const r = await api('/api/compliance/check', { method: 'POST', body: { text: $('#txt').value } });
      showOne($('#txt').value, r.hits);
      say($('#msg'), r.hits.length ? `${r.hits.length} ملاحظة` : 'سليم', true);
    } catch (err) { $('#one').innerHTML = ''; say($('#msg'), err.message); }
    busy(btn, false);
  });
  $('#one').addEventListener('click', async e => {
    const btn = e.target.closest('#rw'); if (!btn) return; busy(btn, true);
    try {
      const r = await api('/api/compliance/rewrite', { method: 'POST', body: { text: $('#txt').value } });
      $('#one').insertAdjacentHTML('beforeend', `<div class="card pad" style="margin-top:10px"><h3 style="margin:0 0 6px">الصياغة المقترحة <span class="muted">(راجعها قبل ما تستخدمها)</span></h3>
        <p class="cp-q" dir="auto">${esc(r.text)}</p>${r.hits.length ? `<p class="muted" style="margin:8px 0 0">باقي فيها ملاحظات:</p>${hitsHTML(r.hits)}` : '<p class="muted" style="margin:8px 0 0">سليمة حسب القواعد.</p>'}
        <div class="bar" style="margin-top:8px"><button class="btn" type="button" data-use>استخدمها بدل النص</button></div></div>`);
      $('[data-use]', $('#one')).addEventListener('click', () => { $('#txt').value = r.text; $('#f').requestSubmit(); });
    } catch (err) { say($('#msg'), err.message); }
    busy(btn, false);
  });
  $$('[data-live]').forEach(b => b.addEventListener('click', () => { live = b.dataset.live; $$('[data-live]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); load(); }));
  await shell({ active: 'compliance', title: 'الامتثال' });
  await load();
}
