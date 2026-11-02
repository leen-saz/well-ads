// المعرفة: شات تدريب يسأل سؤال سؤال، وإضافة وتعديل وإيقاف ما يتعلمه الذكاء الاصطناعي عن الشركة، ومعاينة اللي يوصل لكل موديول.
import { $, $$, api, say, esc, shell, busy, when } from '/assets/common.js';
import { block } from '/assets/compliance-ui.js';

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
        ${x.question ? `<span class="muted" style="font-size:13px">من شات التدريب: ${esc(x.question)}</span>` : ''}
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

  // Training chat: the agent asks, the trainer answers; each answer becomes an entry (editable under "كل المعرفة")
  const skipped = [];
  let Q = null;
  async function chat() {
    try {
      const r = await api(`/api/knowledge/train?skip=${encodeURIComponent(skipped.join(','))}`);
      Q = r.next;
      $('#prog').textContent = `الأسئلة الأساسية: ${r.covered} من ${r.total}` + (Q ? '' : ' · ما عندي أسئلة ثانية الحين');
      $('#chat').innerHTML = r.history.map(h => `<p class="kn-q" dir="auto">${esc(h.question)}</p><p class="kn-a" dir="auto">${esc(h.answer)}${h.active ? '' : '<small>ينتظر اعتماد المدير</small>'}</p>`).join('')
        + (Q ? `<p class="kn-q" dir="auto"><b>${esc(Q.q)}</b></p>` : `<p class="kn-q">${r.history.length ? 'المعرفة مكتملة الحين. أي شي يتغير، عدّله من «كل المعرفة».' : 'ما فيه أسئلة.'}</p>`);
      $('#tf').hidden = !Q || !r.canEdit;
      if (Q && r.canEdit) $('#ans').focus();
    } catch (err) { $('#chat').innerHTML = `<p class="msg err">${esc(err.message)}</p>`; }
  }
  function tab(t) {
    $$('[data-tab]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.tab === t)));
    $('#train').hidden = t !== 'train'; $('#all').hidden = t !== 'all'; $('#brand').hidden = t !== 'brand';
    if (t === 'train') chat(); else if (t === 'brand') brandLoad(); else load();
  }

  // الهوية والبصريات: files in R2 per company, same approval rule as the entries, no delete
  let B = { assets: [], kinds: {} };
  const KAR = { logo: 'الشعار', colors: 'الألوان', font: 'خط', guide: 'دليل العلامة', reference: 'صورة مرجعية' };
  const fileUrl = id => `/api/knowledge/brandfile?id=${id}`;
  // Some browsers give fonts no type: take it from the extension
  const BYEXT = { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf', pdf: 'application/pdf', svg: 'image/svg+xml' };
  function brandDraw() {
    $('#blist').innerHTML = B.assets.length ? B.assets.map(a => `<article class="card kn-e${a.active ? '' : ' off'}">
      <div class="kn-top"><span class="kn-chip">${esc(KAR[a.kind] || a.kind)}</span>${a.title ? `<b>${esc(a.title)}</b>` : ''}${a.active ? '' : '<span class="kn-chip wait">موقوف</span>'}
        <span class="kn-act">${B.canApprove ? `<button class="btn" type="button" data-bon="${a.id}" data-v="${!a.active}">${a.active ? 'أوقف' : 'فعّل'}</button>` : ''}</span></div>
      ${a.kind === 'colors' ? `<div class="kn-sw">${String(a.value || '').split(' ').map(c => `<i style="background:${/^#[0-9a-f]{6}$/i.test(c) ? c : 'transparent'}" title="${esc(c)}"></i>`).join('')}</div>`
        : a.kind === 'logo' || a.kind === 'reference' ? `<img class="kn-thumb" alt="${esc(a.title || KAR[a.kind])}" src="${fileUrl(a.id)}" loading="lazy">`
        : `<a href="${fileUrl(a.id)}" target="_blank" rel="noopener">افتح الملف</a>`}
      ${a.description ? `<span class="muted" style="font-size:13px">${esc(a.description)}</span>` : ''}
      <span class="muted" style="font-size:12px">${esc(a.updated_by || a.created_by || '')} · ${when(a.updated_at || a.created_at)}</span></article>`).join('')
      : '<div class="card pad"><b>ما فيه ملفات هوية للحين.</b><p class="muted" style="margin:6px 0 0">ابدأ بالشعار والألوان.</p></div>';
    $$('[data-bon]').forEach(b => b.addEventListener('click', async () => {
      busy(b, true);
      try { await api('/api/knowledge/brand', { method: 'PATCH', body: { id: +b.dataset.bon, active: b.dataset.v === 'true' } }); await brandLoad(); }
      catch (err) { say($('#bmsg'), err.message); busy(b, false); }
    }));
  }
  function bhint() {
    const k = B.kinds[$('#bkind').value];
    if (!k) return;
    $('#bfile').accept = k.types.join(',');
    $('#bhint').textContent = `الصيغ: ${k.types.map(t => t.split('/')[1]).join('، ')} · الحد ${k.max / 1048576} ميقا`;
  }
  async function brandLoad() {
    try {
      B = await api('/api/knowledge/brand');
      if (!$('#bkind').options.length) { $('#bkind').innerHTML = Object.entries(B.kinds).map(([k, v]) => `<option value="${k}">${esc(v.ar)}</option>`).join(''); bhint(); }
      $('#bf').hidden = $('#cf').hidden = !B.canEdit;
      brandDraw();
    } catch (err) { $('#blist').innerHTML = `<p class="msg err">${esc(err.message)}</p>`; }
  }
  // Images are downscaled in the browser first (logos keep PNG transparency); fonts, PDFs and SVG go as they are
  async function prepared(file, kind) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || !['logo', 'reference'].includes(kind)) return file;
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = URL.createObjectURL(file); });
    const max = kind === 'logo' ? 512 : 1024, s = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.width * s)); c.height = Math.max(1, Math.round(img.height * s));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const type = kind === 'logo' ? 'image/png' : 'image/jpeg';
    return new Promise(ok => c.toBlob(b => ok(b || file), type, 0.85));
  }
  $('#bkind').addEventListener('change', bhint);
  $('#bf').addEventListener('submit', async e => {
    e.preventDefault(); const f = $('#bfile').files[0]; if (!f) { say($('#bmsg'), 'اختر ملف'); return; }
    const btn = $('#bsave'); busy(btn, true);
    try {
      const kind = $('#bkind').value, blob = await prepared(f, kind);
      const res = await fetch(`/api/knowledge/brandfile?kind=${encodeURIComponent(kind)}&title=${encodeURIComponent($('#btitle').value)}`,
        { method: 'POST', headers: { 'content-type': blob.type || f.type || BYEXT[(f.name.split('.').pop() || '').toLowerCase()] || '' }, body: blob, credentials: 'same-origin' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'ما انرفع الملف');
      say($('#bmsg'), j.pending ? 'انرفع، وينتظر اعتماد المدير.' : 'انرفع، والتصميم بيستخدمه من الحين.', true);
      $('#bf').reset(); bhint(); await brandLoad();
    } catch (err) { say($('#bmsg'), err.message); }
    busy(btn, false);
  });
  $('#cf').addEventListener('submit', async e => {
    e.preventDefault();
    try { const r = await api('/api/knowledge/brandcolors', { method: 'POST', body: { colors: $('#colors').value } }); say($('#bmsg'), r.pending ? 'انحفظت، وتنتظر اعتماد المدير.' : 'انحفظت.', true); $('#colors').value = ''; await brandLoad(); }
    catch (err) { say($('#bmsg'), err.message); }
  });
  $$('[data-tab]').forEach(b => b.addEventListener('click', () => tab(b.dataset.tab)));
  $('#tf').addEventListener('submit', async e => {
    e.preventDefault(); if (!Q) return; const btn = $('#send'); busy(btn, true);
    try {
      const r = await api('/api/knowledge/train', { method: 'POST', body: { topic: Q.topic, question: Q.q, kind: Q.kind, answer: $('#ans').value } });
      const said = $('#ans').value; $('#ans').value = ''; say($('#tmsg'), r.pending ? 'انحفظ، وينتظر اعتماد المدير.' : 'انحفظ.', true);
      await chat(); $('#tcomp').innerHTML = block(said, r.compliance || []);
    } catch (err) { say($('#tmsg'), err.message); }
    busy(btn, false);
  });
  $('#skip').addEventListener('click', () => { if (Q) { skipped.push(Q.topic); say($('#tmsg'), ''); chat(); } });

  await shell({ active: 'knowledge', title: 'المعرفة' });
  await load();
  tab('train');
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
      $('#comp').innerHTML = block(b.body, r.compliance || []);
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
