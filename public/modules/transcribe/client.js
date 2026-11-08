// التفريغ: رفع ملف، وخطوات التفريغ تمشي والصفحة مفتوحة (وإذا انقفلت يكملها الخادم)، والنتيجة: ملخص وبنود عمل والنص.
import { $, api, say, esc, shell, busy, when, pageSignal, failure } from '/assets/common.js';

// Runs on every visit of this page (assets/router.js calls it after each ClientRouter navigation).
export default async function mount() {
  let D = { jobs: [], ready: true, why: '', purposes: {}, max_mb: 95 };
  const running = new Set();
  const STATUS = { queued: 'بالانتظار', processing: 'يتفرّغ', done: 'جاهز', failed: 'ما تم' };
  const MB = 1048576;

  const pct = j => Math.min(100, Math.round(100 * (j.step || 0) / (j.steps || 1)));
  const label = j => j.status === 'failed' ? esc(j.error || '') : j.status === 'done' ? '' : `الخطوة ${Math.min(j.steps, j.step + 1)} من ${j.steps}`;
  const doc = j => {
    const r = j.result || {};
    const acts = (r.actions || []).map(a => `<li>${esc(a.task)}${a.owner ? ` <span class="muted">(${esc(a.owner)})</span>` : ''}${a.due ? ` <span class="muted">· ${esc(a.due)}</span>` : ''}</li>`).join('');
    return `<p class="tr-sum" data-user-text>${esc(r.summary || '')}</p>
      ${r.hook ? `<p class="tr-h">الهوك (أول 3 ثواني)</p><p class="tr-sum" data-user-text>${esc(r.hook)}</p>` : ''}
      ${r.offer ? `<p class="tr-h">العرض الإعلاني</p><p class="tr-sum" data-user-text>${esc(r.offer)}</p>` : ''}
      ${acts ? `<p class="tr-h">بنود العمل</p><ul class="tr-list" data-user-text>${acts}</ul>` : ''}
      ${(r.notes || []).length ? '<div class="tr-warn" role="status">انتبه: النص فيه بيانات شخصية محتملة (رقم جوال أو هوية أو ذكر مريض). لا تشاركه قبل ما تراجعه وتشيل أي بيانات شخصية.</div>' : ''}
      <details data-full><summary>النص كامل</summary><pre class="tr-text" data-user-text></pre></details>
      <div class="tr-act"><button class="btn sm secondary" type="button" data-copy>انسخ النص</button>${r.library_id ? '<a class="btn sm ghost" href="/library/">افتح المكتبة</a>' : ''}</div>`;
  };
  const card = j => `<article class="card tr-job" data-id="${j.id}">
    <div class="tr-top"><h3 data-user-text>${esc(j.title)}</h3><span class="tr-chip${j.status === 'done' ? ' ok' : j.status === 'failed' ? ' bad' : ''}">${STATUS[j.status] || ''}</span>
      <span class="muted" style="font-size:12px">${esc(when(j.created_at))}</span>
      ${j.status === 'queued' || j.status === 'processing' ? '<button class="btn sm ghost" type="button" data-cancel style="margin-inline-start:auto">ألغِ التفريغ</button>' : ''}</div>
    ${j.status === 'done' ? doc(j) : `<p class="muted" style="margin:0">${label(j)}</p>${j.status === 'failed' ? '' : `<div class="tr-bar"><i style="width:${pct(j)}%"></i></div>`}`}
  </article>`;
  const draw = () => {
    $('#jobs').innerHTML = D.jobs.length ? D.jobs.map(card).join('') : '<div class="card tr-empty"><p class="muted" style="margin:0">ما فيه ملفات للحين. ارفع أول ملف.</p></div>';
  };
  const put = j => { const at = D.jobs.findIndex(x => x.id === j.id); if (at >= 0) D.jobs[at] = j; else D.jobs.unshift(j); draw(); };

  async function load() {
    try {
      D = await api('/api/transcribe/jobs');
      $('#purpose').innerHTML = Object.entries(D.purposes).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('');
      $('#limits').textContent = `الحد ${D.max_mb} ميقا للملف. الملفات الأكبر قسّمها لأجزاء.`;
      $('#notready').hidden = D.ready; $('#notready').textContent = D.why;
      $('#go').disabled = !D.ready;
      draw();
      D.jobs.filter(j => j.status === 'queued' || j.status === 'processing').forEach(j => run(j.id));
    } catch (err) { failure($('#jobs'), err, load); }
  }

  // Steps a job until it is over. A step that finds another one running, or the file still being prepared, just waits.
  async function run(id) {
    if (running.has(id)) return;
    running.add(id);
    try {
      let last = -1;
      for (;;) {
        if (pageSignal().aborted) return;
        const r = await api('/api/transcribe/step', { method: 'POST', body: { id } });
        put(r.job);
        if (r.job.status === 'done' || r.job.status === 'failed') return;
        const same = r.job.step === last; last = r.job.step;
        await new Promise(res => setTimeout(res, r.busy || same ? 4000 : 600));
      }
    } catch (err) { say($('#msg'), err.message); }
    finally { running.delete(id); }
  }

  // The length of the recording, read by the browser
  const lengthOf = file => new Promise(res => {
    const m = document.createElement(file.type.startsWith('video/') ? 'video' : 'audio');
    const url = URL.createObjectURL(file);
    const done = s => { URL.revokeObjectURL(url); res(s); };
    m.preload = 'metadata'; m.onloadedmetadata = () => done(isFinite(m.duration) ? Math.ceil(m.duration) : 0); m.onerror = () => done(0); m.src = url;
    setTimeout(() => done(0), 8000);
  });

  $('#uf').addEventListener('submit', async e => {
    e.preventDefault();
    const file = $('#file').files[0];
    if (!file) return say($('#msg'), 'اختر الملف أول');
    if (file.size > D.max_mb * MB) return say($('#msg'), `الملف أكبر من ${D.max_mb} ميقا. قسّمه لأجزاء`);
    const b = e.submitter; busy(b, true); say($('#msg'), '');
    const seconds = (await lengthOf(file)) || Math.max(1, Math.round(file.size / 16000));   // when the browser cannot read it: about 128 kbit/s
    const q = new URLSearchParams({ title: $('#title').value, purpose: $('#purpose').value, seconds: String(seconds) });
    $('#prog').hidden = false; $('#progI').style.width = '0';
    try {
      const j = await new Promise((res, rej) => {
        const x = new XMLHttpRequest();
        x.open('POST', `/api/transcribe/upload?${q}`);
        x.setRequestHeader('content-type', file.type || 'application/octet-stream');
        x.upload.onprogress = ev => { if (ev.lengthComputable) { $('#progI').style.width = `${Math.round(100 * ev.loaded / ev.total)}%`; say($('#msg'), `يرفع الملف… ${Math.round(100 * ev.loaded / ev.total)}%`, true); } };
        x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText); } catch { /* not JSON */ } if (x.status === 401) location.href = '/login/'; else if (x.status < 300) res(d.job); else rej(new Error(d.error || 'صار خطأ')); };
        x.onerror = () => rej(new Error('ما قدرت أوصل للخادم'));
        x.send(file);
      });
      say($('#msg'), 'انرفع الملف، يبدأ التفريغ.', true);
      $('#uf').reset(); put(j); run(j.id);
    } catch (err) { say($('#msg'), err.message); }
    $('#prog').hidden = true; busy(b, false);
  });

  $('#jobs').addEventListener('click', async e => {
    const root = e.target.closest('[data-id]'); if (!root) return;
    const id = Number(root.dataset.id);
    if (e.target.closest('[data-cancel]')) {
      try { put((await api('/api/transcribe/cancel', { method: 'POST', body: { id } })).job); } catch (err) { say($('#msg'), err.message); }
    } else if (e.target.closest('[data-copy]')) {
      const b = e.target.closest('[data-copy]');
      try { const t = (await api(`/api/transcribe/job?id=${id}`)).job.transcript; await navigator.clipboard.writeText(t); b.textContent = 'انسخ النص ✓'; } catch { b.textContent = 'ما قدرت أنسخ'; }
    }
  });
  // The full text is fetched when its section is opened, not with the list
  $('#jobs').addEventListener('toggle', async e => {
    const d = e.target; if (!d.matches?.('[data-full]') || !d.open) return;
    const pre = $('pre', d); if (pre.textContent) return;
    try { pre.textContent = (await api(`/api/transcribe/job?id=${d.closest('[data-id]').dataset.id}`)).job.transcript; } catch (err) { pre.textContent = err.message; }
  }, true);

  shell({ active: 'transcribe', title: 'التفريغ' }).then(load).catch(err => say($('#msg'), err.message));
}
