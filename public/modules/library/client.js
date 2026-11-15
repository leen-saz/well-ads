// المكتبة: قائمة بفلتر وبحث، نجمة المفضلة، وللمالكة (أو اللي حفظ العنصر قبل التعميد) تعديل، وللمالكة تعميد.
import { $, api, say, esc, shell, busy, when } from '/assets/common.js';

// Runs on every visit of this page (assets/router.js calls it after each ClientRouter navigation).
export default async function mount() {
  let D = { items: [], modules: [], kinds: {}, owner: false };
  const STATUS = { draft: 'مسودة', in_review: 'عند المراجعة', returned: 'مرجّع بملاحظة', approved: 'معمّد' };
  const modAr = k => D.modules.find(m => m.key === k)?.ar || k;
  const query = () => {
    const q = new URLSearchParams();
    for (const [id, k] of [['fq', 'q'], ['fmod', 'module'], ['fkind', 'kind'], ['fplat', 'platform'], ['fserv', 'service'], ['fstar', 'starred']]) { const v = $('#' + id).value.trim(); if (v) q.set(k, v); }
    return q.toString();
  };
  const flags = it => (it.compliance_result?.hits || []).map(h => `<div class="lb-flag${h.level === 'critical' ? ' bad' : ''}">امتثال: ${esc(h.title)} «${esc(h.match)}». ${esc(h.fix)}</div>`).join('')
    || (it.compliance_result?.checked_at ? '<div class="lb-flag">فحص الامتثال: ما لقى ملاحظات</div>' : '');
  const card = it => {
    const canEdit = D.owner || (it.mine && it.review_status !== 'approved');
    return `<article class="card lb-item" data-id="${it.id}">
      <div class="lb-top"><h3>${esc(it.title)}</h3>
        <button type="button" class="lb-star" data-star aria-pressed="${it.starred}" aria-label="${it.starred ? 'شل من المفضلة' : 'حط في المفضلة'}">${it.starred ? '★' : '☆'}</button></div>
      <div class="lb-top"><span class="lb-chip">${esc(modAr(it.module))}</span><span class="lb-chip">${esc(D.kinds[it.kind] || it.kind)}</span>
        ${it.platform ? `<span class="lb-chip">${esc(it.platform)}</span>` : ''}${it.service ? `<span class="lb-chip">${esc(it.service)}</span>` : ''}
        <span class="lb-chip${it.review_status === 'approved' ? ' ok' : ''}">${STATUS[it.review_status] || esc(it.review_status)}</span>
        <span class="muted" style="font-size:12px">${esc(when(it.created_at))}</span></div>
      <p class="lb-body">${esc(it.content)}</p>${flags(it)}
      <div class="lb-act"><button type="button" class="btn sm secondary" data-copy>انسخ</button>
        ${canEdit ? '<button type="button" class="btn sm ghost" data-edit>عدّل</button>' : ''}
        ${D.owner && it.review_status !== 'approved' ? '<button type="button" class="btn sm primary" data-approve>اعتمد</button>' : ''}</div>
      <form class="lb-edit" data-form hidden novalidate><label>العنوان<input type="text" name="title" maxlength="120" value="${esc(it.title)}"></label>
        <label>النص<textarea name="content" rows="6" maxlength="20000">${esc(it.content)}</textarea></label>
        <div class="lb-act"><button class="btn sm primary" type="submit">احفظ التعديل</button><button class="btn sm ghost" type="button" data-cancel>إلغاء</button></div></form>
    </article>`;
  };
  function draw() {
    $('#list').innerHTML = D.items.length ? D.items.map(card).join('')
      : `<div class="card lb-empty"><p class="muted" style="margin:0">${query() ? 'ما فيه شي يطابق الفلتر.' : 'المكتبة فاضية. من أي تاب، اضغط «احفظ في المكتبة» على الناتج اللي عجبك.'}</p></div>`;
  }
  let seq = 0;   // typing in the filters starts many loads: only the last one is drawn
  async function load() {
    const mine = ++seq;
    try {
      const got = await api('/api/library' + (query() ? '?' + query() : ''));
      if (mine !== seq) return;
      D = got;
      if (!$('#fmod').dataset.done) {
        $('#fmod').insertAdjacentHTML('beforeend', D.modules.filter(m => m.ok).map(m => `<option value="${esc(m.key)}">${esc(m.ar)}</option>`).join(''));
        $('#fkind').insertAdjacentHTML('beforeend', Object.entries(D.kinds).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join(''));
        $('#fmod').dataset.done = '1';
      }
      draw();
    } catch (err) { say($('#msg'), err.message); }
  }
  const find = el => D.items.find(i => i.id === Number(el.closest('[data-id]')?.dataset.id));
  const put = it => { const at = D.items.findIndex(x => x.id === it.id); if (at >= 0) D.items[at] = it; draw(); };

  $('#list').addEventListener('click', async e => {
    const it = find(e.target); if (!it) return;
    const b = e.target.closest('button'); if (!b) return;
    const root = e.target.closest('[data-id]');
    if (b.matches('[data-copy]')) { try { await navigator.clipboard.writeText(it.content); b.textContent = 'انسخ ✓'; } catch { b.textContent = 'ما قدرت أنسخ'; } }
    else if (b.matches('[data-edit]')) { $('[data-form]', root).hidden = false; $('[name=title]', root).focus(); }
    else if (b.matches('[data-cancel]')) $('[data-form]', root).hidden = true;
    else if (b.matches('[data-star]')) {
      busy(b, true);
      try { const r = await api('/api/library/star', { method: 'POST', body: { id: it.id, on: !it.starred } }); put({ ...it, starred: r.starred }); if ($('#fstar').value && !r.starred) await load(); }
      catch (err) { say($('#msg'), err.message); busy(b, false); }
    } else if (b.matches('[data-approve]')) {
      busy(b, true);
      try { put((await api('/api/library/approve', { method: 'POST', body: { id: it.id } })).item); say($('#msg'), 'انعمّد العنصر', true); }
      catch (err) { say($('#msg'), err.message); busy(b, false); }
    }
  });
  $('#list').addEventListener('submit', async e => {
    e.preventDefault();
    const it = find(e.target); if (!it) return;
    const f = e.target, b = e.submitter; busy(b, true);
    try { put((await api('/api/library/item', { method: 'PATCH', body: { id: it.id, title: f.elements.title.value, content: f.elements.content.value } })).item); say($('#msg'), 'انحفظ التعديل', true); }
    catch (err) { say($('#msg'), err.message); busy(b, false); }
  });
  let t = 0;
  $('#filters').addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 250); });
  $('#filters').addEventListener('submit', e => e.preventDefault());

  shell({ active: 'library', title: 'المكتبة' }).then(load).catch(err => say($('#msg'), err.message));
}
