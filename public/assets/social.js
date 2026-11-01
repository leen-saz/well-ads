// السوشال: إنشاء منشور مجدول لأكثر من منصة، وتقويم الأسبوعين الجايين. النشر يصير من السيرفر في وقته.
import { $, $$, api, say, esc, shell, busy, LANG } from './common.js';
import { t } from './i18n.js';

// Runs on every visit of this page (assets/router.js calls it after each ClientRouter navigation).
export default async function mount() {

  const ST = { draft: 'مسودة', scheduled: 'مجدول', publishing: 'ينشر الحين', published: 'انتشر', partial: 'انتشر جزئياً', failed: 'ما انتشر', cancelled: 'ملغي' };
  let PLATS = {}, mode = 'manual';
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
    const waiting = p.status === 'scheduled' && p.mode === 'manual' && !p.approved_at;
    const errs = Object.entries(p.results || {}).filter(([, r]) => !r.ok).map(([k, r]) => `${PLATS[k]?.name || k}: ${r.error}`);
    return `<article class="card so-post" data-id="${p.id}">
      <div class="so-top">${p.platforms.map(k => `<span class="so-chip">${esc(PLATS[k]?.name || k)}</span>`).join('')}
        <span class="muted">${fmtTime(at)}</span><span class="so-st muted">${waiting ? 'ينتظر موافقتك' : ST[p.status] || p.status}${p.mode === 'auto' ? ' · تلقائي' : ''}</span></div>
      ${p.body ? `<p class="so-body">${esc(p.body)}</p>` : ''}
      ${errs.length ? `<p class="so-note">${errs.map(esc).join('<br>')}</p>` : ''}
      ${p.status === 'scheduled' ? `<div class="bar">${waiting ? '<button class="btn sm primary" data-act="approve">وافق</button>' : ''}<button class="btn sm ghost" data-act="cancel">ألغِ</button></div>` : ''}
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

  $$('.seg [data-mode]').forEach(b => b.onclick = () => {
    mode = b.dataset.mode;
    $$('.seg [data-mode]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    $('#modeNote').textContent = mode === 'auto' ? 'تنبيه: ينشر لحاله في وقته بدون موافقة. تأكد من النص والامتثال.' : 'ينتظر موافقتك قبل ما ينشر.';
  });
  $('#body').addEventListener('input', counter);

  $('#f').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.submitter; busy(btn, true); $('#notices').innerHTML = '';
    const local = $('#at').value; // Riyadh time (UTC+3, no DST)
    const body = { platforms: $$('input[name="pl"]:checked').map(x => x.value), body: $('#body').value, mode,
      media: $('#media').value ? [{ url: $('#media').value, type: /\.(mp4|mov|webm)(\?|$)/i.test($('#media').value) ? 'video' : 'image' }] : [],
      publish_at: local ? new Date(local + ':00+03:00').toISOString() : '' };
    try {
      const r = await api('/api/social/posts', { method: 'POST', body });
      say($('#msg'), 'انجدول.', true);
      $('#notices').innerHTML = (r.notices || []).map(n => `<p class="so-note">${esc(n)}</p>`).join('');
      $('#body').value = ''; $('#media').value = ''; await load();
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

  shell({ active: 'social', title: 'السوشال' }).then(load).catch(err => say($('#msg'), err.message));
}
