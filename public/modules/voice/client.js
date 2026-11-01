// الصوت: دليل صوت العلامة، فاحص النص، مدة الفويس أوفر، إعادة كتابة بالذكاء الاصطناعي، واستماع بصوت عربي من المتصفح (مجاني).
import { $, $$, api, say, esc, shell, busy, fmt } from '/assets/common.js';

const DIALECT = { saudi: 'سعودي', msa: 'فصحى', mixed: 'خليط', neutral: 'محايد' };

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

  await shell({ active: 'voice', title: 'الصوت' });
  try {
    const g = await api('/api/voice/guide');
    $('#guide').innerHTML = g.guide.map(x => `<div class="vc-g"><b>${esc(x.title)}</b><span><span class="vc-yes">نعم:</span> ${esc(x.do)}</span><span class="muted"><span class="vc-no">لا:</span> ${esc(x.dont)}</span></div>`).join('');
  } catch (err) { say($('#msg'), err.message); }
}
