// وصف الصور: الصورة تنصغّر وتنعاد ترميزها في المتصفح (وهذا يشيل بيانات موقعها)، وتنرسل مع بصمتها، ويرجع الوصف والنص وملاحظات الامتثال.
import { $, api, say, esc, shell, busy, when, failure } from '/assets/common.js';

// Runs on every visit of this page (assets/router.js calls it after each ClientRouter navigation).
export default async function mount() {
  let D = { items: [], ready: true, why: '' };
  const previews = new Map();   // id -> object URL of the image shown just now (never stored)
  const MAX_SIDE = 1600;

  const section = (h, t) => t ? `<p class="vi-h">${h}</p><p class="vi-t" data-user-text>${esc(t)}</p>` : '';
  const card = it => {
    const r = it.result || {};
    return `<article class="card vi-item" data-id="${it.id}">
      <div class="vi-top"><h3 data-user-text>${esc(it.title)}</h3><span class="muted" style="font-size:12px">${esc(when(it.created_at))}</span></div>
      ${previews.has(it.id) ? `<img class="vi-prev" src="${previews.get(it.id)}" alt="${esc(r.alt || '')}">` : ''}
      ${section('الوصف', r.description)}${section('النص البديل', r.alt)}${section('النص داخل الصورة', r.text)}${section('العرض الإعلاني', r.offer)}${section('الهوك', r.hook)}${section('الدعوة', r.cta)}
      ${r.people ? '<div class="vi-flag" role="status">في الصورة أشخاص: تأكد إن عندك موافقتهم قبل ما تنشرها.</div>' : ''}
      ${(it.compliance || []).map(h => `<div class="vi-flag${h.level === 'critical' ? ' bad' : ''}">امتثال: ${esc(h.title)} «${esc(h.match)}». ${esc(h.fix)}</div>`).join('')}
      <div class="vi-act"><button class="btn sm secondary" type="button" data-copy="alt">انسخ النص البديل</button>${r.text ? '<button class="btn sm secondary" type="button" data-copy="text">انسخ النص</button>' : ''}
        ${it.library_id ? '<a class="btn sm ghost" href="/library/">افتح المكتبة</a>' : '<button class="btn sm primary" type="button" data-save>احفظ في المكتبة</button>'}</div>
    </article>`;
  };
  const draw = () => {
    $('#items').innerHTML = D.items.length ? D.items.map(card).join('') : '<div class="card vi-empty"><p class="muted" style="margin:0">ما فيه صور للحين. ارفع أول صورة.</p></div>';
  };
  const put = it => { const at = D.items.findIndex(x => x.id === it.id); if (at >= 0) D.items[at] = it; else D.items.unshift(it); draw(); };

  async function load() {
    try {
      D = await api('/api/vision/recent');
      $('#notready').hidden = D.ready; $('#notready').textContent = D.why; $('#go').disabled = !D.ready;
      draw();
    } catch (err) { failure($('#items'), err, load); }
  }

  // A smaller JPEG: faster, cheaper, and without the camera's location data
  async function shrink(file) {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.85));
    if (!blob) throw new Error('ما قدرنا نقرا الصورة، جرّب صيغة ثانية');
    const buf = await blob.arrayBuffer();
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map(b => b.toString(16).padStart(2, '0')).join('');
    const data = await new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(String(f.result).split(',')[1] || ''); f.onerror = () => rej(new Error('ما قدرنا نقرا الصورة، جرّب صيغة ثانية')); f.readAsDataURL(blob); });
    return { data, hash, mime: 'image/jpeg', url: URL.createObjectURL(blob) };
  }

  $('#uf').addEventListener('submit', async e => {
    e.preventDefault();
    const file = $('#file').files[0];
    if (!file) return say($('#msg'), 'اختر الصورة أول');
    const b = e.submitter; busy(b, true); say($('#msg'), 'يحلل الصورة…', true);
    try {
      const img = await shrink(file);
      const r = await api('/api/vision/describe', { method: 'POST', body: { title: $('#title').value, mime: img.mime, data: img.data, hash: img.hash } });
      previews.set(r.item.id, img.url);
      put(r.item); $('#uf').reset();
      say($('#msg'), r.cached ? 'هالصورة سبق وانحللت، هذا ناتجها.' : 'جاهز.', true);
    } catch (err) { say($('#msg'), err.message); }
    busy(b, false);
  });

  $('#items').addEventListener('click', async e => {
    const root = e.target.closest('[data-id]'); if (!root) return;
    const it = D.items.find(x => x.id === Number(root.dataset.id)); if (!it) return;
    const c = e.target.closest('[data-copy]'), s = e.target.closest('[data-save]');
    if (c) { try { await navigator.clipboard.writeText(it.result[c.dataset.copy] || ''); c.textContent = 'انسخ ✓'; } catch { c.textContent = 'ما قدرت أنسخ'; } }
    else if (s) {
      busy(s, true);
      try { const r = await api('/api/vision/save', { method: 'POST', body: { id: it.id } }); put({ ...it, library_id: r.library_id }); }
      catch (err) { say($('#msg'), err.message); busy(s, false); }
    }
  });

  shell({ active: 'vision', title: 'وصف الصور' }).then(load).catch(err => say($('#msg'), err.message));
}
