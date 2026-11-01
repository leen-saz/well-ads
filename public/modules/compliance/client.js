// الامتثال: يفحص نصوص إعلاناتنا ونص حر على قواعد الإعلان الصحي، ويعرض الكلمة والسبب والصياغة الأسلم.
import { $, $$, api, say, esc, shell, busy, fmt } from '/assets/common.js';

const LEVEL = { critical: 'مخالفة', warn: 'انتبه', info: 'ملاحظة' };
const PLAT = { meta: 'ميتا', snapchat: 'سناب شات', tiktok: 'تيك توك', google: 'جوجل' };
const mark = (text, words) => { let t = esc(text); for (const w of words) { if (w) t = t.split(esc(w)).join(`<mark>${esc(w)}</mark>`); } return t; };
const hitsHTML = hits => hits.map(h => `<div class="cp-hit"><div class="cp-meta"><span class="dg-tag">${LEVEL[h.level]}</span><b>${esc(h.title)}</b><span class="muted">«${esc(h.match)}»</span></div>
  <span class="muted">${esc(h.why)}</span><div class="dg-fix"><b>الأسلم:</b> ${esc(h.fix)}</div></div>`).join('');

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
          <p class="cp-q" dir="auto">${mark(a.text || '', a.hits.map(h => h.match))}</p>${hitsHTML(a.hits)}</article>`).join('')
        : '<div class="card dg-ok"><b>ما لقيت مخالفات في نصوص الإعلانات.</b></div>';
    } catch (err) { $('#list').innerHTML = ''; say($('#msg'), err.message); }
  }
  $('#f').addEventListener('submit', async e => {
    e.preventDefault(); const btn = e.submitter; busy(btn, true);
    try {
      const r = await api('/api/compliance/check', { method: 'POST', body: { text: $('#txt').value } });
      $('#one').innerHTML = r.hits.length ? `<article class="card dg-f ${r.hits[0].level}"><p class="cp-q" dir="auto">${mark($('#txt').value, r.hits.map(h => h.match))}</p>${hitsHTML(r.hits)}</article>`
        : '<div class="card dg-ok"><b>النص سليم حسب القواعد.</b></div>';
      say($('#msg'), r.hits.length ? `${r.hits.length} ملاحظة` : 'سليم', true);
    } catch (err) { $('#one').innerHTML = ''; say($('#msg'), err.message); }
    busy(btn, false);
  });
  $$('[data-live]').forEach(b => b.addEventListener('click', () => { live = b.dataset.live; $$('[data-live]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); load(); }));
  await shell({ active: 'compliance', title: 'الامتثال' });
  await load();
}
