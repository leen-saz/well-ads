// الرحلات: بناء الخطوات، والحفظ، وتشغيل رحلة لعميل (جوال أو إيميل). الإرسال يصير من السيرفر خطوة خطوة.
import { $, $$, api, say, esc, shell, busy } from './common.js';

let CH = {}, mode = 'manual', steps = [], journeys = [];
const RUN = { running: 'شغالة', done: 'خلصت', failed: 'فيها خطأ', stopped: 'موقفة' };
const fields = s => s.type === 'wait' ? `<label>كم ساعة؟</label><input type="number" min="1" max="2160" data-k="hours" value="${esc(s.hours || 24)}">`
  : s.type === 'whatsapp' ? `<label>اسم القالب المعتمد في واتساب</label><input dir="ltr" data-k="template" value="${esc(s.template || '')}" placeholder="lead_followup"><label>اللغة</label><input dir="ltr" data-k="lang" value="${esc(s.lang || 'ar')}">`
  : s.type === 'email' ? `<label>العنوان</label><input data-k="subject" value="${esc(s.subject || '')}"><label>النص <span class="muted">({{name}} = اسم العميل)</span></label><textarea rows="4" data-k="body">${esc(s.body || '')}</textarea>`
  : `<label>العنوان</label><input data-k="title" value="${esc(s.title || '')}"><label>النص</label><input data-k="body" value="${esc(s.body || '')}">`;

function drawSteps() {
  $('#steps').innerHTML = steps.map((s, i) => `<div class="jr-step" data-i="${i}"><div class="bar"><b>${i + 1}. ${esc(CH[s.type]?.name || s.type)}${CH[s.type]?.soon ? ' <span class="muted">(قريباً)</span>' : ''}</b>
    <span><button class="btn sm ghost" type="button" data-up>↑</button><button class="btn sm ghost" type="button" data-del>احذف</button></span></div>
    ${fields(s)}${s.type === 'whatsapp' ? `<p class="so-note">${esc(CH.whatsapp.notice)}</p>` : ''}</div>`).join('') || '<p class="muted">ما فيه خطوات. مثال: واتساب ← انتظر 24 ساعة ← إيميل.</p>';
}
const readSteps = () => $$('.jr-step').map(el => {
  const s = { ...steps[+el.dataset.i] };
  $$('[data-k]', el).forEach(x => { s[x.dataset.k] = x.dataset.k === 'hours' ? Number(x.value) : x.value; });
  return s;
});

function setMode(m) {
  mode = m;
  $$('.seg [data-mode]').forEach(x => x.setAttribute('aria-pressed', String(x.dataset.mode === m)));
  $('#modeNote').textContent = m === 'auto' ? 'تنبيه: تبدأ لحالها لكل ليد جديد وترسل بدون موافقة. تأكد من الرسائل والامتثال.' : 'ما تبدأ لأي عميل إلا لما تضغط تشغيل.';
}
function edit(j) {
  $('#jid').value = j?.id || ''; $('#name').value = j?.name || ''; $('#trigger').value = j?.trigger || 'manual';
  $('#active').checked = !!j?.active; steps = j ? structuredClone(j.steps) : []; setMode(j?.mode || 'manual');
  $('#formTitle').textContent = j ? 'تعديل رحلة' : 'رحلة جديدة'; drawSteps();
}

async function load() {
  const r = await api('/api/journeys/list');
  CH = r.channels; journeys = r.journeys;
  if (!$('#addType').innerHTML) $('#addType').innerHTML = Object.entries(CH).map(([k, c]) => `<option value="${k}">${esc(c.name)}${c.soon ? ' (قريباً)' : ''}</option>`).join('');
  $('#list').innerHTML = journeys.map(j => `<article class="card so-post" data-id="${j.id}"><div class="so-top"><b>${esc(j.name)}</b>
      <span class="so-chip">${j.trigger === 'lead_created' ? 'ليد جديد' : 'يدوي'}</span><span class="so-chip">${j.mode === 'auto' ? 'تلقائي' : 'يدوي'}</span>
      <span class="so-st muted">${j.active ? 'مفعّلة' : 'موقفة'} · ${j.steps.length} خطوات</span></div>
    <form class="bar jr-start" novalidate><input type="text" placeholder="جوال 05… أو إيميل" aria-label="جوال أو إيميل" style="flex:1;min-width:160px;margin:0"><button class="btn sm primary">شغّل لعميل</button><button class="btn sm ghost" type="button" data-edit>عدّل</button></form></article>`).join('')
    || '<p class="muted">ما فيه رحلات. ابدأ من النموذج.</p>';
  const names = Object.fromEntries(journeys.map(j => [j.id, j.name]));
  $('#runs').innerHTML = r.runs.length ? `<table><thead><tr><th>الرحلة</th><th>العميل</th><th>الحالة</th><th>آخر خطوة</th></tr></thead><tbody>${r.runs.map(x => {
    const last = (x.log || []).at(-1);
    return `<tr><td>${esc(names[x.journey_id] || x.journey_id)}</td><td dir="ltr">${esc(x.contact.phone || x.contact.email)}</td><td>${RUN[x.status] || x.status}</td><td>${last ? `${esc(CH[last.type]?.name || last.type)} ${last.ok ? '✓' : '· ' + esc(last.error || '')}` : '—'}</td></tr>`;
  }).join('')}</tbody></table>` : '<p class="muted" style="padding:0 4px">ما فيه تشغيلات للحين.</p>';
}

$('#add').onclick = () => { steps = readSteps(); steps.push({ type: $('#addType').value }); drawSteps(); };
$('#steps').addEventListener('click', e => {
  const el = e.target.closest('.jr-step'); if (!el) return;
  const i = +el.dataset.i; steps = readSteps();
  if (e.target.closest('[data-del]')) steps.splice(i, 1);
  else if (e.target.closest('[data-up]') && i > 0) [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]];
  else return;
  drawSteps();
});
$$('.seg [data-mode]').forEach(b => b.onclick = () => setMode(b.dataset.mode));
$('#reset').onclick = () => edit(null);

$('#f').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.submitter; busy(btn, true); $('#notices').innerHTML = '';
  try {
    const r = await api('/api/journeys/save', { method: 'POST', body: { id: $('#jid').value, name: $('#name').value, trigger: $('#trigger').value, mode, active: $('#active').checked, steps: readSteps() } });
    say($('#msg'), 'انحفظت.', true); $('#notices').innerHTML = (r.notices || []).map(n => `<p class="so-note">${esc(n)}</p>`).join('');
    $('#jid').value = r.journey.id; await load();
  } catch (err) { say($('#msg'), err.message); }
  busy(btn, false);
});

$('#list').addEventListener('click', e => { if (e.target.closest('[data-edit]')) edit(journeys.find(j => j.id == e.target.closest('[data-id]').dataset.id)); });
$('#list').addEventListener('submit', async e => {
  e.preventDefault();
  const card = e.target.closest('[data-id]'), v = e.target.querySelector('input').value.trim(), btn = e.target.querySelector('.primary');
  busy(btn, true);
  try {
    await api('/api/journeys/start', { method: 'POST', body: { id: card.dataset.id, contact: v.includes('@') ? { email: v } : { phone: v } } });
    say($('#msg'), 'بدأت الرحلة للعميل.', true); e.target.reset(); await load();
  } catch (err) { say($('#msg'), err.message); }
  busy(btn, false);
});

shell({ active: 'journeys', title: 'الرحلات والرسائل' }).then(() => { edit(null); return load(); }).catch(err => say($('#msg'), err.message));
