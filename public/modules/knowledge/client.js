// المعرفة: إضافة وتعديل وإيقاف ما يتعلمه الذكاء الاصطناعي عن الشركة، ومعاينة اللي يوصل لكل موديول.
import { $, $$, api, say, esc, shell, busy, when } from '/assets/common.js';

const MOD = { content: 'المحتوى', design: 'التصميم', voice: 'الصوت', social: 'السوشال', maestro: 'المايسترو', journeys: 'الرحلات' };

export default async function mount() {
  let S = { entries: [], kinds: {}, modules: [], canEdit: false, canApprove: false };

  const form = () => ({ id: $('#id').value, kind: $('#kind').value, title: $('#title').value, body: $('#body').value,
    price: $('#kind').value === 'service' ? $('#price').value : '', modules: $$('#mods input:checked').map(x => x.value) });
  function setKind() { $('#hint').textContent = S.kinds[$('#kind').value]?.hint || ''; $('#pricebox').hidden = $('#kind').value !== 'service'; }
  function reset() {
    $('#f').reset(); $('#id').value = ''; $('#ftitle').textContent = 'أضف معرفة'; $('#cancel').hidden = true; setKind();
  }
  function edit(x) {
    $('#id').value = x.id; $('#kind').value = x.kind; $('#title').value = x.title || ''; $('#body').value = x.body; $('#price').value = x.price ?? '';
    $$('#mods input').forEach(c => { c.checked = x.modules.includes(c.value); });
    $('#ftitle').textContent = 'عدّل'; $('#cancel').hidden = false; setKind(); $('#body').focus();
  }

  function draw() {
    if (!S.entries.length) { $('#list').innerHTML = '<div class="card pad"><b>ما فيه معرفة للحين.</b><p class="muted" style="margin:6px 0 0">ابدأ بصوت العلامة والكلمات الممنوعة، وبعدها الخدمات وأسعارها.</p></div>'; return; }
    $('#list').innerHTML = Object.entries(S.kinds).map(([k, info]) => {
      const list = S.entries.filter(x => x.kind === k);
      if (!list.length) return '';
      return `<h3 class="kn-head">${esc(info.ar)} <span class="muted">(${list.length})</span></h3>` + list.map(x => `<article class="card kn-e${x.active ? '' : ' off'}">
        <div class="kn-top">${x.title ? `<b>${esc(x.title)}</b>` : ''}${x.price != null ? `<span class="kn-chip">${esc(x.price)} ريال</span>` : ''}
          <span class="kn-chip">${x.modules.length ? x.modules.map(m => esc(MOD[m] || m)).join('، ') : 'كل الموديولات'}</span>
          ${x.active ? '' : '<span class="kn-chip wait">موقوف</span>'}
          <span class="kn-act">${S.canEdit ? `<button class="btn" type="button" data-edit="${x.id}">عدّل</button>` : ''}${S.canApprove ? `<button class="btn" type="button" data-on="${x.id}" data-v="${!x.active}">${x.active ? 'أوقف' : 'فعّل'}</button>` : ''}</span></div>
        <p class="kn-body" dir="auto">${esc(x.body)}</p>
        <span class="muted" style="font-size:12px">${esc(x.updated_by || x.created_by || '')} · ${when(x.updated_at || x.created_at)}</span></article>`).join('');
    }).join('');
    $$('[data-edit]').forEach(b => b.addEventListener('click', () => edit(S.entries.find(x => String(x.id) === b.dataset.edit))));
    $$('[data-on]').forEach(b => b.addEventListener('click', async () => {
      busy(b, true);
      try { await api('/api/knowledge/entry', { method: 'PATCH', body: { id: +b.dataset.on, active: b.dataset.v === 'true' } }); await load(); }
      catch (err) { say($('#msg'), err.message); busy(b, false); }
    }));
  }

  async function load() {
    try { S = await api('/api/knowledge/list'); draw(); }
    catch (err) { $('#list').innerHTML = ''; say($('#msg'), err.message); }
  }

  await shell({ active: 'knowledge', title: 'المعرفة' });
  await load();
  $('#kind').innerHTML = Object.entries(S.kinds).map(([k, v]) => `<option value="${k}">${esc(v.ar)}</option>`).join('');
  $('#mods').innerHTML = S.modules.map(m => `<label><input type="checkbox" value="${m}"> ${esc(MOD[m] || m)}</label>`).join('');
  $('#pv').innerHTML = S.modules.map(m => `<option value="${m}">${esc(MOD[m] || m)}</option>`).join('');
  setKind();
  if (!S.canEdit) $('#f').hidden = $('#ftitle').hidden = true;

  $('#kind').addEventListener('change', setKind);
  $('#cancel').addEventListener('click', reset);
  $('#f').addEventListener('submit', async e => {
    e.preventDefault(); const btn = $('#save'); busy(btn, true);
    const b = form();
    try {
      const r = await api('/api/knowledge/entry', { method: b.id ? 'PATCH' : 'POST', body: { ...b, id: b.id ? +b.id : undefined } });
      say($('#msg'), r.pending || (r.entry && !r.entry.active) ? 'انحفظ، وينتظر اعتماد المدير.' : 'انحفظ، والذكاء الاصطناعي بيستخدمه من الحين.', true);
      reset(); await load();
    } catch (err) { say($('#msg'), err.message); }
    busy(btn, false);
  });
  $('#pvgo').addEventListener('click', async e => {
    const btn = e.currentTarget; busy(btn, true);
    try { const r = await api(`/api/knowledge/preview?module=${encodeURIComponent($('#pv').value)}`); $('#pvout').hidden = false; $('#pvout').textContent = r.system || 'ما فيه معرفة فعّالة لهالموديول.'; }
    catch (err) { say($('#msg'), err.message); }
    busy(btn, false);
  });
}
