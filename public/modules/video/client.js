// الفيديو: مشروع (مقاس ومدة وأفاتار)، لقطات تتولّد بالخلفية وتتابع حالتها، والناتج مسودة داخل النظام.
import { $, api, say, esc, shell, busy, pageFailure, pageSignal, LANG } from '/assets/common.js';

const KINDS = { 'text-to-video': 'من وصف', 'image-to-video': 'من صورة', avatar: 'أفاتار يتكلم' };
const STATE = { queued: 'بالانتظار', running: 'يتولّد', done: 'جاهزة', failed: 'ما تمت', cancelled: 'موقوفة' };

export default async function mount() {
  let META = null, NOT_READY = false, LIST = [], CUR = null, JOBS = [], timer = 0;
  const sig = pageSignal();
  const stop = () => { clearTimeout(timer); timer = 0; };
  sig.addEventListener('abort', stop);

  const fillSelect = (el, items, sel) => { el.innerHTML = items.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(sel) ? ' selected' : ''}>${esc(l)}</option>`).join(''); };

  function draw() {
    const e = META.engines[0];
    const note = $('#notready');
    // Everyone reads one plain sentence; what is still to set up is in the owner's status card, apart from the work area
    const off = !META.ready || NOT_READY;
    note.hidden = !off;
    note.innerHTML = off ? '<b>ما اكتمل تجهيزه، بلّغ الإدارة.</b>' : '';
    drawOwner();
    fillSelect($('#pick'), [['', '+ فيديو جديد'], ...LIST.map(p => [p.id, p.title])], CUR?.id || '');
    $('#title').value = CUR?.title || '';
    fillSelect($('#ratio'), META.ratios.map(r => [r, r]), CUR?.ratio || '9:16');
    fillSelect($('#seconds'), META.seconds.map(s => [s, `${s} ثانية`]), CUR?.seconds || 15);
    fillSelect($('#avatar'), [['', 'بدون أفاتار'], ...META.avatars.map(a => [a.id, LANG === 'en' ? a.en : a.ar])], CUR?.avatar_id || '');
    $('#save').textContent = CUR ? 'احفظ' : 'أنشئ الفيديو';
    for (const k of ['ratio', 'seconds', 'avatar']) $('#' + k).disabled = !!CUR;   // the size and length are fixed once clips exist
    avatarNote();
    const caps = e?.caps;
    fillSelect($('#kind'), (caps?.kinds || []).filter(k => k !== 'avatar' || CUR?.avatar_id).map(k => [k, KINDS[k] || k]), $('#kind').value || 'text-to-video');
    fillSelect($('#clip'), (caps?.clipSeconds || []).map(s => [s, `${s} ثواني`]), 5);
    kindBoxes();
    $('#cf').hidden = !CUR; $('#noproj').hidden = !!CUR;
    $('#go').disabled = !META.canEdit || off;
    $('#save').disabled = NOT_READY;
  }
  // The owner's status card (outside the work area): what is still to set up, names only
  function drawOwner() {
    const box = $('#ownerSetup'); const st = META.setup;
    const todo = st ? [...(st.secrets || []), ...(NOT_READY ? [st.migration] : [])] : [];
    box.hidden = !todo.length;
    $('#ownerList').innerHTML = todo.map(k => `<li><code>${esc(k)}</code></li>`).join('');
  }
  const avatarNote = () => { const a = META.avatars.find(x => x.id === $('#avatar').value); $('#avatarDoes').textContent = a ? (LANG === 'en' ? a.doesEn : a.does) : ''; };
  const kindBoxes = () => { const k = $('#kind').value; $('#imgBox').hidden = k !== 'image-to-video'; $('#voiceBox').hidden = k !== 'avatar'; };

  function drawJobs() {
    $('#jobs').innerHTML = JOBS.length ? JOBS.map(j => `<article class="vd-job" data-id="${j.id}">
      <header><b>لقطة ${j.shot_no}</b><span class="chip line">${esc(KINDS[j.kind] || '')}</span><span class="vd-st ${esc(j.status)}">${esc(STATE[j.status] || '')}</span>
        ${j.status === 'queued' ? `<button class="btn sm ghost" type="button" data-stop="${j.id}">وقّف</button>` : ''}</header>
      ${j.say ? `<span class="muted">${esc(j.say)}</span>` : ''}
      ${j.ready ? `<video controls preload="metadata" src="/api/video/file?job=${j.id}"></video>` : ''}</article>`).join('') : '';
  }

  // Polling: asking for the jobs also moves the due ones forward. Every 5 seconds while something is waiting.
  async function poll() {
    stop();
    if (!CUR || sig.aborted) return;
    try { JOBS = (await api(`/api/video/jobs?project=${CUR.id}`)).jobs; drawJobs(); } catch (err) { say($('#cmsg'), err.message); }
    if (!sig.aborted && JOBS.some(j => j.status === 'queued' || j.status === 'running')) timer = setTimeout(poll, 5000);
  }

  async function load(keep) {
    const pr = await api('/api/video/projects'); LIST = pr.projects; NOT_READY = !!pr.notReady;
    CUR = LIST.find(p => p.id === keep) || (keep === undefined ? LIST[0] : null) || null;
    draw(); JOBS = []; drawJobs(); poll();
  }

  $('#pick').onchange = () => { CUR = LIST.find(p => p.id === Number($('#pick').value)) || null; draw(); JOBS = []; drawJobs(); poll(); };
  $('#avatar').onchange = avatarNote; $('#kind').onchange = kindBoxes;
  $('#pf').addEventListener('submit', async e => {
    e.preventDefault(); const b = e.submitter; busy(b, true);
    try {
      if (CUR) { say($('#pmsg'), 'ما فيه شي يتعدّل للحين.', true); }
      else { const r = await api('/api/video/projects', { method: 'POST', body: { title: $('#title').value, ratio: $('#ratio').value, seconds: Number($('#seconds').value), avatar_id: $('#avatar').value } }); say($('#pmsg'), 'انحفظ.', true); await load(r.project.id); }
    } catch (err) { say($('#pmsg'), err.message); }
    busy(b, false);
  });
  $('#cf').addEventListener('submit', async e => {
    e.preventDefault(); const b = e.submitter; busy(b, true);
    try {
      const kind = $('#kind').value;
      await api('/api/video/jobs', { method: 'POST', body: { project: CUR.id, clips: [{ kind, prompt: $('#prompt').value, seconds: Number($('#clip').value),
        ...(kind === 'image-to-video' ? { imageUrl: $('#img').value } : {}), ...(kind === 'avatar' ? { voiceUrl: $('#voice').value } : {}) }] } });
      say($('#cmsg'), 'انضافت اللقطة، تتولّد بالخلفية.', true); $('#prompt').value = ''; poll();
    } catch (err) { say($('#cmsg'), err.message); }
    busy(b, false);
  });
  $('#jobs').addEventListener('click', async e => {
    const id = e.target.closest('[data-stop]')?.dataset.stop; if (!id) return;
    try { await api('/api/video/jobs', { method: 'PATCH', body: { id: Number(id) } }); poll(); } catch (err) { say($('#cmsg'), err.message); }
  });

  shell({ active: 'video', title: 'الفيديو' }).then(async () => { META = await api('/api/video/engines'); await load(); }).catch(pageFailure);
}
