// الصوت: دليل صوت العلامة، فاحص النص، مدة الفويس أوفر، إعادة كتابة بالذكاء الاصطناعي، وتوليد صوت بلهجة سعودية من Gemini (WAV).
import { $, $$, api, say, esc, shell, busy, fmt } from '/assets/common.js';

const DIALECT = { saudi: 'سعودي', msa: 'فصحى', mixed: 'خليط', neutral: 'محايد' };


// Gemini returns 16-bit PCM (audio/L16;rate=24000) as base64; wrap it in a WAV header so it plays and downloads.
export function wav(b64, mime) {
  const rate = +((/rate=(\d+)/.exec(mime || '') || [])[1] || 24000);
  const bin = atob(b64), n = bin.length, buf = new ArrayBuffer(44 + n), v = new DataView(buf), u8 = new Uint8Array(buf);
  const str = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) u8[44 + i] = bin.charCodeAt(i);
  return new Blob([buf], { type: 'audio/wav' });
}

export default async function mount() {
  let seconds = 30;

  function drawAnalysis(a) {
    const fit = a.seconds <= seconds;
    $('#res').innerHTML = `<div class="dg-sum"><div class="card"><b>${fmt(a.score)}%</b><span>مطابقة صوت العلامة</span></div><div class="card"><b>${esc(DIALECT[a.dialect] || a.dialect)}</b><span>اللهجة</span></div>
        <div class="card"><b>${fmt(a.words)}</b><span>كلمة</span></div><div class="card${fit ? '' : ' vc-over'}"><b>${fmt(a.seconds)} ث</b><span>${fit ? `يناسب ${seconds} ثانية` : `أطول من ${seconds} ثانية`}</span></div></div>
      <div class="dg-list">${a.checks.map(c => `<div class="card vc-c ${c.ok ? 'ok' : 'no'}"><b>${c.ok ? '✓' : '!'} ${esc(c.title)}</b><span class="muted">${esc(c.detail)}</span></div>`).join('')}</div>`;
  }

  async function run(btn) {
    busy(btn, true);
    try { drawAnalysis(await api('/api/voice/check', { method: 'POST', body: { text: $('#txt').value } })); say($('#msg'), 'انفحص.', true); }
    catch (err) { say($('#msg'), err.message); }
    busy(btn, false);
  }

  // Speech in the browser: Arabic voices installed on the device (Mac/iPhone ship Saudi Arabic voices). Free; no file to download.
  const synth = window.speechSynthesis;
  function voices() {
    const list = synth ? synth.getVoices().filter(v => /^ar/i.test(v.lang)).sort((a, b) => Number(/SA/i.test(b.lang)) - Number(/SA/i.test(a.lang))) : [];
    $('#voice').innerHTML = list.length ? list.map((v, i) => `<option value="${i}">${esc(v.name)} · ${esc(v.lang)}</option>`).join('') : '<option value="">ما فيه صوت عربي في هالجهاز</option>';
    $('#play').disabled = !list.length;
    return list;
  }
  let V = [];
  if (synth) { V = voices(); synth.onvoiceschanged = () => { V = voices(); }; } else { $('#voice').innerHTML = '<option value="">المتصفح ما يدعم القراءة بصوت</option>'; $('#play').disabled = true; }

  $('#f').addEventListener('submit', e => { e.preventDefault(); run(e.submitter); });
  $('#rw').addEventListener('click', async e => {
    const btn = e.currentTarget; busy(btn, true);
    try { const r = await api('/api/voice/rewrite', { method: 'POST', body: { text: $('#txt').value, seconds } }); $('#txt').value = r.text; drawAnalysis(r.analysis); say($('#msg'), 'انكتب بصوت العلامة. راجعه قبل ما تستخدمه.', true); }
    catch (err) { say($('#msg'), err.message); }
    busy(btn, false);
  });
  $$('[data-sec]').forEach(b => b.addEventListener('click', () => { seconds = +b.dataset.sec; $$('[data-sec]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); if ($('#txt').value.trim()) run(); }));
  $('#play').addEventListener('click', () => {
    if (!synth || !$('#txt').value.trim()) { say($('#msg'), 'اكتب النص أول'); return; }
    synth.cancel();
    const u = new SpeechSynthesisUtterance($('#txt').value); const v = V[+$('#voice').value];
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'ar-SA';
    u.rate = +$('#rate').value; synth.speak(u);
  });
  $('#stop').addEventListener('click', () => synth && synth.cancel());

  let url = null;
  $('#speak').addEventListener('click', async e => {
    const btn = e.currentTarget; if (!$('#txt').value.trim()) { say($('#msg'), 'اكتب النص أول'); return; }
    busy(btn, true); say($('#msg'), 'يتولّد الصوت… ياخذ ثواني', true);
    try {
      const r = await api('/api/voice/speak', { method: 'POST', body: { text: $('#txt').value, voice: $('#gv').value, accent: $('#ga').value, tone: $('#gt').value } });
      const part = (((r.candidates || [])[0] || {}).content || {}).parts?.find(p => p.inlineData) || {};
      if (!part.inlineData) throw new Error('ما رجع صوت، جرّب مرة ثانية');
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(wav(part.inlineData.data, part.inlineData.mimeType));
      $('#out').innerHTML = `<div class="vc-audio"><audio controls src="${url}"></audio><a class="btn sm secondary" href="${url}" download="well-voice.wav">نزّل WAV</a></div>`;
      say($('#msg'), 'جاهز. اسمعه قبل ما تستخدمه.', true);
    } catch (err) { say($('#msg'), err.message); }
    busy(btn, false);
  });

  await shell({ active: 'voice', title: 'الصوت' });
  try {
    const g = await api('/api/voice/guide');
    const t = g.tts || { voices: [], accents: {}, tones: {} };
    $('#gv').innerHTML = t.voices.map(v => `<option value="${esc(v.id)}">${esc(v.ar)}</option>`).join('');
    $('#ga').innerHTML = Object.entries(t.accents).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
    $('#gt').innerHTML = Object.entries(t.tones).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
    if (!t.ready) { $('#speak').disabled = true; $('#genNote').textContent = 'توليد الصوت يحتاج مفتاح Gemini (GEMINI_API_KEY) في إعدادات Cloudflare.'; }
    $('#guide').innerHTML = g.guide.map(x => `<div class="vc-g"><b>${esc(x.title)}</b><span><span class="vc-yes">نعم:</span> ${esc(x.do)}</span><span class="muted"><span class="vc-no">لا:</span> ${esc(x.dont)}</span></div>`).join('');
  } catch (err) { say($('#msg'), err.message); }
}
