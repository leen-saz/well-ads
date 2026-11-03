// السوشال: إنشاء منشور مجدول لأكثر من منصة، وتقويم الأسبوعين الجايين. النشر يصير من السيرفر في وقته.
import { $, $$, api, say, esc, shell, busy, LANG } from '/assets/common.js';
import { block } from '/assets/compliance-ui.js';
import { t } from '/assets/i18n.js';

// Runs on every visit of this page (assets/router.js calls it after each ClientRouter navigation).
export default async function mount() {

  const ST = { draft: 'مسودة', scheduled: 'مجدول', publishing: 'ينشر الحين', published: 'انتشر', partial: 'انتشر جزئياً', failed: 'ما انتشر', cancelled: 'ملغي' };
  let PLATS = {}, APPR = { approvers: [], canApprove: false, owner: false, people: [] };
  const fmtDay = d => new Intl.DateTimeFormat((LANG === 'en' ? 'en-GB' : 'ar-SA-u-nu-latn'), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Riyadh' }).format(d);
  const fmtTime = d => new Intl.DateTimeFormat((LANG === 'en' ? 'en-GB' : 'ar-SA-u-nu-latn'), { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Riyadh' }).format(d);

  function counter() {
    const n = $('#body').value.length;
    const picked = $$('input[name="pl"]:checked').map(x => x.value);
    const limit = Math.min(...picked.map(p => PLATS[p]?.max || Infinity));
    const el = $('#cnt');
    el.textContent = picked.length && Number.isFinite(limit) ? `${n} / ${limit} حرف` : `${n} حرف`;
    el.classList.toggle('over', n > limit);
  }

  function postCard(p) {
    const at = new Date(p.publish_at);
    const waiting = p.status === 'scheduled' && !p.approved_at;
    const errs = Object.entries(p.results || {}).filter(([, r]) => !r.ok).map(([k, r]) => `${PLATS[k]?.name || k}: ${r.error}`);
    return `<article class="card so-post" data-id="${p.id}">
      <div class="so-top">${p.platforms.map(k => `<span class="so-chip">${esc(PLATS[k]?.name || k)}</span>`).join('')}
        <span class="muted">${fmtTime(at)}</span><span class="so-st muted">${waiting ? 'ينتظر الاعتماد' : p.status === 'scheduled' ? `معتمد · ${esc(p.approved_by || '')}` : ST[p.status] || p.status}</span></div>
      ${p.body ? (p.compliance?.length ? block(p.body, p.compliance) : `<p class="so-body">${esc(p.body)}</p>`) : ''}
      ${errs.length ? `<p class="so-note">${errs.map(esc).join('<br>')}</p>` : ''}
      ${p.status === 'scheduled' ? `<div class="bar">${waiting && APPR.canApprove ? '<button class="btn sm primary" data-act="approve">اعتمد</button>' : ''}<button class="btn sm ghost" data-act="cancel">ألغِ</button></div>` : ''}
    </article>`;
  }

  async function load() {
    const from = new Date(Date.now() - 864e5), to = new Date(Date.now() + 14 * 864e5);
    const r = await api(`/api/social/posts?from=${from.toISOString()}&to=${to.toISOString()}`);
    PLATS = r.platforms;
    if (!$('#plats').innerHTML) {
      $('#plats').innerHTML = Object.entries(PLATS).map(([k, p]) => `<label><input type="checkbox" name="pl" value="${k}"> ${esc(p.name)}${p.live ? '' : ' <span class="muted">(قريباً)</span>'}</label>`).join('');
      $$('input[name="pl"]').forEach(x => x.addEventListener('change', counter));
    }
    $('#range').textContent = `${fmtDay(from)} ← ${fmtDay(to)}`;
    const byDay = new Map();
    for (const p of r.posts) { const k = fmtDay(new Date(p.publish_at)); byDay.set(k, [...(byDay.get(k) || []), p]); }
    $('#list').innerHTML = byDay.size ? [...byDay].map(([d, ps]) => `<h3 class="so-day">${esc(d)}</h3><div class="cx-list" style="display:grid;gap:10px">${ps.map(postCard).join('')}</div>`).join('')
      : '<p class="muted">ما فيه منشورات مجدولة. ابدأ من النموذج.</p>';
    counter();
  }

  // Who approves: named in the tab by the owner; the form says who will approve the post
  async function loadApprovers() {
    APPR = await api('/api/social/approvers');
    const names = APPR.approvers.map(e => APPR.people.find(p => p.email === e)?.name || e);
    $('#who').textContent = APPR.approvers.length ? `ينتظر اعتماد ${names.join(' أو ')} قبل ما ينشر.` : 'ينتظر اعتماد المالك قبل ما ينشر.';
    $('#appr').hidden = !APPR.owner;
    if (APPR.owner) $('#apprList').innerHTML = APPR.people.map(p => `<label><input type="checkbox" name="ap" value="${esc(p.email)}"${APPR.approvers.includes(p.email) ? ' checked' : ''}> ${esc(p.name || p.email)} <span class="muted" dir="ltr">${esc(p.email)}</span></label>`).join('');
  }
  $('#apprSave').onclick = async e => {
    busy(e.currentTarget, true);
    try { await api('/api/social/approvers', { method: 'PUT', body: { approvers: $$('input[name="ap"]:checked').map(x => x.value) } }); say($('#apprMsg'), 'انحفظ.', true); await loadApprovers(); await load(); }
    catch (err) { say($('#apprMsg'), err.message); }
    busy(e.currentTarget, false);
  };
  $('#body').addEventListener('input', counter);
  // Upload the chosen photo/video right away; its public link goes into the post (Meta reads it from there)
  let uploaded = null;
  const showPrev = m => { const el = $('#prev'); el.hidden = !m; el.innerHTML = !m ? '' : m.type === 'video' ? `<video src="${esc(m.url)}" controls muted></video>` : `<img src="${esc(m.url)}" alt="">`; };
  $('#file').addEventListener('change', async e => {
    const f = e.target.files[0]; uploaded = null; showPrev(null); if (!f) { $('#upMsg').textContent = ''; return; }
    $('#upMsg').textContent = 'يرفع…';
    try {
      const res = await fetch('/api/social/upload', { method: 'POST', headers: { 'content-type': f.type }, body: f, credentials: 'same-origin' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'ما انرفع الملف');
      uploaded = { url: j.url, type: j.type }; $('#media').value = ''; showPrev(uploaded); $('#upMsg').textContent = 'انرفع ✓';
    } catch (err) { $('#upMsg').textContent = err.message; e.target.value = ''; }
  });

  // Write the idea in the text box, then let the social model write the post (it is checked, and you edit it before scheduling)
  $('#suggest').addEventListener('click', async e => {
    const btn = e.currentTarget; busy(btn, true); $('#notices').innerHTML = '';
    try {
      const r = await api('/api/social/suggest', { method: 'POST', body: { brief: $('#body').value, platforms: $$('input[name="pl"]:checked').map(x => x.value) } });
      $('#body').value = r.body; $('#body').dispatchEvent(new Event('input'));
      say($('#msg'), `${r.engine === 'xai' ? 'كتبه Grok' : 'كتبه الذكاء الاصطناعي'}. راجعه قبل ما تجدوله.`, true);
      $('#notices').innerHTML = block(r.body, r.compliance || []);
    } catch (err) { say($('#msg'), err.message); }
    busy(btn, false);
  });

  $('#f').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.submitter; busy(btn, true); $('#notices').innerHTML = '';
    const local = $('#at').value; // Riyadh time (UTC+3, no DST)
    const body = { platforms: $$('input[name="pl"]:checked').map(x => x.value), body: $('#body').value,
      media: uploaded ? [uploaded] : $('#media').value ? [{ url: $('#media').value, type: /\.(mp4|mov|webm)(\?|$)/i.test($('#media').value) ? 'video' : 'image' }] : [],
      publish_at: local ? new Date(local + ':00+03:00').toISOString() : '' };
    try {
      const r = await api('/api/social/posts', { method: 'POST', body });
      say($('#msg'), 'انجدول.', true);
      $('#notices').innerHTML = (r.notices || []).map(n => `<p class="so-note">${esc(n)}</p>`).join('');
      $('#body').value = ''; $('#media').value = ''; $('#file').value = ''; uploaded = null; showPrev(null); $('#upMsg').textContent = ''; await load();
    } catch (err) { say($('#msg'), err.message); }
    busy(btn, false);
  });

  $('#list').addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'cancel' && !confirm(t('تلغي المنشور؟'))) return;
    busy(b, true);
    try { await api('/api/social/posts', { method: 'PATCH', body: { id: b.closest('[data-id]').dataset.id, action: b.dataset.act } }); await load(); }
    catch (err) { say($('#msg'), err.message); busy(b, false); }
  });

  shell({ active: 'social', title: 'السوشال' }).then(loadApprovers).then(load).catch(err => say($('#msg'), err.message));
}
