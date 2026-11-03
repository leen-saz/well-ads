// التصميم ← «موشن جرافيك»: التصميم والصوت المعتمدين ← خطة مشاهد من المصمم (ChatGPT، والواجهة ما تسمي الموديل) ← معاينة، «تعديل»، سجل النسخ، والاعتماد.
// client.js يرسم الشريط الجانبي ويشغّل هذا لما يختار المستخدم النوع.
// الرسم في canvas على وقت الصوت (frame.js)، والتنزيل يسجّل نفس الرسم مع الصوت في المتصفح.
import { $, api, say, esc, busy, when, pageSignal } from '/assets/common.js';
import { SIZE, frame, draw } from '/modules/design/frame.js';

export async function mountMotion() {
  let S = {}, P = null, V = [], cur = null, img = null, raf = 0, audioCtx = null;
  const audio = $('#voiceOut'), canvas = $('#stage'), ctx = canvas.getContext('2d');
  const id = new URL(location.href).searchParams.get('id');
  const spec = () => V.find(v => v.version === cur)?.spec;

  // ---- preview: the frame at the voice's current time
  const paint = () => { const s = spec(); if (s) draw(ctx, s, frame(s, audio.currentTime || 0), img); };
  const loop = () => { paint(); if (!audio.paused) raf = requestAnimationFrame(loop); };
  audio.addEventListener('play', () => { cancelAnimationFrame(raf); loop(); }, { signal: pageSignal() });
  audio.addEventListener('seeked', paint, { signal: pageSignal() });
  audio.addEventListener('pause', paint, { signal: pageSignal() });

  function list() {
    const ps = S.projects || [];
    $('#list').innerHTML = ps.length ? ps.map(p => `<a class="card mv-item" href="/design/?type=motion&id=${p.id}"><b>${esc(p.title)}</b>
      <span class="so-chip">${p.status === 'approved' ? `معتمد · v${p.approved_version}` : 'مسودة'}</span><span class="muted">${when(p.created_at)}</span></a>`).join('')
      : '<p class="muted">ما فيه فيديوهات للحين.</p>';
  }

  function versions() {
    $('#versions').innerHTML = [...V].reverse().map(v => `<li class="mv-ver${v.version === cur ? ' on' : ''}">
      <button type="button" class="mv-pick" data-v="${v.version}"><b>v${v.version}</b>${v.version === 1 ? ' · الأصلية' : ` · من v${v.parent_version}`}
      ${P.approved_version === v.version ? '<span class="so-chip mv-ok">معتمدة</span>' : ''}</button>
      <p class="muted">${v.change_request ? `«${esc(v.change_request)}»` : 'أول نسخة من التصميم والصوت'}</p>
      <p class="muted">${esc(v.created_by || '')} · ${when(v.created_at)} · ${v.engine === 'templates' ? 'قالب ثابت' : 'المصمم'}</p></li>`).join('');
    const approvedHere = P.approved_version === cur;
    $('#approve').hidden = !S.canApprove || approvedHere;
    $('#approve').textContent = `اعتمد v${cur} نسخة نهائية`;
    $('#download').hidden = !approvedHere;
    $('#state').textContent = P.status === 'approved' ? `v${P.approved_version} معتمدة وجاهزة للنشر${P.approved_by ? ` (${P.approved_by})` : ''}` : 'مسودة: ما فيه نسخة معتمدة للحين';
    $('#editBtn').hidden = !S.canEdit;
  }

  function choose(n) {
    cur = n;
    const s = spec();
    [canvas.width, canvas.height] = SIZE[s.ratio] || SIZE['9:16'];
    $('#stageWrap').dataset.ratio = s.ratio;
    versions(); paint();
  }

  async function openProject() {
    const r = await api(`/api/design/videos?id=${encodeURIComponent(id)}`);
    S = { ...S, ...r }; P = r.project; V = r.versions || [];
    $('#new').hidden = true; $('#project').hidden = false;
    $('#ptitle').textContent = P.title;
    $('#ready').hidden = S.ready;
    img = new Image();
    img.onload = paint;
    img.src = `/api/design/videofile?p=${P.id}&kind=design`;
    audio.src = `/api/design/videofile?p=${P.id}&kind=voice`;
    choose(P.approved_version || V[V.length - 1]?.version || 1);
  }

  const warn = ws => ws?.length ? ' تنبيه امتثال: ' + ws.map(w => `«${w.match}» (${w.title})`).join('، ') : '';

  // ---- new video: upload the two files, then ask for v1
  async function upload(kind, file) {
    const res = await fetch(`/api/design/videofile?kind=${kind}`, { method: 'POST', body: file, headers: { 'content-type': file.type }, credentials: 'same-origin' });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || 'ما انرفع الملف');
    return d;
  }
  // The voice length, decoded here (the page CSP allows no blob: media)
  const seconds = async file => {
    const c = new AudioContext();
    try { return (await c.decodeAudioData(await file.arrayBuffer())).duration; }
    catch { throw new Error('ما قدرنا نقرا ملف الصوت'); }
    finally { c.close(); }
  };

  $('#new').onsubmit = async ev => {
    ev.preventDefault();
    const d = $('#design').files[0], v = $('#voice').files[0], btn = $('#make');
    if (!d || !v) return say($('#nmsg'), 'اختر ملف التصميم وملف الصوت');
    busy(btn, true); say($('#nmsg'), 'نرفع الملفات…', true);
    try {
      const [dk, vk, secs] = await Promise.all([upload('design', d), upload('voice', v), seconds(v)]);
      say($('#nmsg'), 'المصمم يكتب المشاهد…', true);
      const r = await api('/api/design/video', { method: 'POST', body: { title: $('#vtitle').value, headline: $('#headline').value, script: $('#script').value, ratio: $('#ratio').value,
        design_key: dk.key, design_mime: dk.mime, voice_key: vk.key, voice_mime: vk.mime, voice_seconds: secs } });
      location.href = `/design/?type=motion&id=${r.id}`;
    } catch (err) { say($('#nmsg'), err.message); busy(btn, false); }
  };

  // ---- «تعديل» → «وش تبي تغيّر؟» → a new version
  $('#editBtn').onclick = () => { $('#editBox').hidden = false; $('#change').focus(); };
  $('#editCancel').onclick = () => { $('#editBox').hidden = true; };
  $('#editForm').onsubmit = async ev => {
    ev.preventDefault();
    const change = $('#change').value.trim(), btn = $('#editGo');
    if (!change) return say($('#emsg'), 'اكتب وش تبي تغيّر');
    busy(btn, true); say($('#emsg'), 'المصمم يسوّي النسخة الجديدة…', true);
    try {
      const r = await api('/api/design/videoedit', { method: 'POST', body: { id: P.id, from: cur, change } });
      $('#change').value = ''; $('#editBox').hidden = true;
      await openProject(); choose(r.version);
      say($('#mmsg'), `انضافت v${r.version}. النسخ القديمة باقية في السجل.${warn(r.warnings)}`, !r.warnings?.length);
    } catch (err) { say($('#emsg'), err.message); }
    busy(btn, false);
  };

  $('#versions').onclick = ev => { const b = ev.target.closest('[data-v]'); if (b) { audio.pause(); audio.currentTime = 0; choose(Number(b.dataset.v)); } };

  $('#approve').onclick = async () => {
    if (!confirm(`تعتمد v${cur} نسخة نهائية للنشر؟`)) return;
    busy($('#approve'), true);
    try { await api('/api/design/videoapprove', { method: 'POST', body: { id: P.id, version: cur } }); await openProject(); say($('#mmsg'), `v${cur} معتمدة`, true); }
    catch (err) { say($('#mmsg'), err.message); }
    busy($('#approve'), false);
  };

  // ---- download (approved version only): record the canvas + the voice in real time
  $('#download').onclick = async () => {
    const btn = $('#download');
    const type = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find(t => window.MediaRecorder?.isTypeSupported(t));
    if (!type || !canvas.captureStream) return say($('#mmsg'), 'متصفحك ما يدعم تسجيل الفيديو، جرّب Chrome أو Safari');
    busy(btn, true); say($('#mmsg'), 'نسجّل الفيديو بوقته الحقيقي، خل الصفحة مفتوحة…', true);
    try {
      if (!audioCtx) { audioCtx = new AudioContext(); const src = audioCtx.createMediaElementSource(audio); audioCtx.dest = audioCtx.createMediaStreamDestination(); src.connect(audioCtx.destination); src.connect(audioCtx.dest); }
      await audioCtx.resume();
      const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...audioCtx.dest.stream.getAudioTracks()]);
      const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 6_000_000 }), parts = [];
      rec.ondataavailable = e => e.data.size && parts.push(e.data);
      const done = new Promise(ok => { rec.onstop = ok; });
      audio.currentTime = 0; rec.start(); await audio.play();
      await new Promise(ok => audio.addEventListener('ended', ok, { once: true }));
      rec.stop(); await done;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(parts, { type })); a.download = `well-video-v${cur}.${type.startsWith('video/mp4') ? 'mp4' : 'webm'}`; a.click();
      say($('#mmsg'), 'نزل الفيديو', true);
    } catch (err) { say($('#mmsg'), err.message || 'ما قدرنا نسجّل الفيديو'); }
    busy(btn, false);
  };

  try {
    const r = await api('/api/design/videos');
    S = r;
    if (r.setup) { $('#setup').innerHTML = `<p class="so-note">${esc(r.setup)}</p>`; return; }
    $('#ready').hidden = r.ready;
    $('#new').hidden = !r.canEdit;
    list();
    if (id) await openProject();
  } catch (err) { say($('#mmsg'), err.message); }
}
