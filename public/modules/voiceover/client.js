// الفويس أوفر: النص + الصوت واللهجة والنبرة والإيقاع (الافتراضي صوت العلامة)، فحص الامتثال، توليد، سماع، تنزيل WAV، وحفظ النص في المكتبة.
import { $, api, say, esc, shell, busy, failure, sectionTabs } from '/assets/common.js';

// The speech model answers with 16-bit mono PCM (24 kHz) as base64: wrapped in a WAV header it plays and downloads
function wav(b64, mime) {
  const rate = Number(/rate=(\d+)/.exec(mime || '')?.[1]) || 24000;
  const pcm = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const buf = new ArrayBuffer(44 + pcm.length), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, pcm.length, true);
  new Uint8Array(buf, 44).set(pcm);
  return { blob: new Blob([buf], { type: 'audio/wav' }), seconds: Math.round(pcm.length / (rate * 2)) };
}

// Runs on every visit of this page (assets/router.js calls it after each ClientRouter navigation).
export default async function mount() {
  let G = { voices: [], accents: {}, tones: {}, paces: {}, brand: {}, max_chars: 1500, ready: true, why: '' };
  let url = '';
  const fill = (id, entries, sel) => { $(id).innerHTML = entries.map(([k, v]) => `<option value="${esc(k)}"${k === sel ? ' selected' : ''}>${esc(v)}</option>`).join(''); };
  const count = () => { const n = $('#text').value.length; $('#count').textContent = `${n} من ${G.max_chars}`; $('#count').classList.toggle('over', n > G.max_chars); };
  const choice = () => ({ voice: $('#voice').value, accent: $('#accent').value, tone: $('#tone').value, pace: $('#pace').value });

  async function load() {
    try {
      G = await api('/api/voiceover/guide');
      fill('#voice', G.voices.map(v => [v.id, v.ar]), G.brand.voice); fill('#accent', Object.entries(G.accents), G.brand.accent);
      fill('#tone', Object.entries(G.tones), G.brand.tone); fill('#pace', Object.entries(G.paces), G.brand.pace);
      $('#notready').hidden = G.ready; $('#notready').textContent = G.why; $('#go').disabled = !G.ready; count();
    } catch (err) { failure($('#content'), err, load); }
  }

  const flags = hits => hits.map(h => `<div class="vo-flag${h.level === 'critical' ? ' bad' : ''}">امتثال: ${esc(h.title)} «${esc(h.match)}». ${esc(h.fix)}</div>`).join('');

  $('#text').addEventListener('input', count);
  $('#vf').addEventListener('submit', async e => {
    e.preventDefault();
    const text = $('#text').value.trim();
    if (!text) return say($('#msg'), 'اكتب النص أول');
    const b = e.submitter; busy(b, true); $('#flags').innerHTML = ''; say($('#msg'), 'يتولّد الصوت… ياخذ ثواني', true);
    try {
      // the compliance notices come first and stay on screen: they are notices, the script is still spoken
      const notes = api('/api/voiceover/check', { method: 'POST', body: { text } }).then(r => { $('#flags').innerHTML = flags(r.hits); }).catch(() => {});
      const r = await api('/api/voiceover/speak', { method: 'POST', body: { text, ...choice() } });
      await notes;
      const part = r.candidates?.[0]?.content?.parts?.find(p => p.inlineData || p.inline_data);
      const d = part?.inlineData || part?.inline_data;
      if (!d?.data) throw new Error('ما طلع صوت، جرّب مرة ثانية');
      const out = wav(d.data, d.mimeType || d.mime_type);
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(out.blob);
      $('#idle').hidden = true; $('#out').hidden = false;
      $('#out').innerHTML = `<audio controls src="${url}"></audio><p class="muted" style="margin:0;font-size:13px">المدة نحو ${out.seconds} ثانية. اسمعه قبل ما تستخدمه.</p>
        <div class="vo-act"><a class="btn sm secondary" href="${url}" download="voiceover.wav">نزّل WAV</a><button class="btn sm secondary" type="button" id="tolib">احفظ النص في المكتبة</button></div>`;
      say($('#msg'), '');
    } catch (err) { say($('#msg'), err.message); }
    busy(b, false);
  });

  $('#out').addEventListener('click', async e => {
    const b = e.target.closest('#tolib'); if (!b) return;
    busy(b, true);
    try {
      const text = $('#text').value.trim();
      await api('/api/library', { method: 'POST', body: { module: 'voiceover', kind: 'script', title: text.slice(0, 60), content: text, platform: '', service: '' } });
      b.outerHTML = 'انحفظ النص ✓ <a href="/library/">افتح المكتبة</a>';
    } catch (err) { say($('#msg'), err.message); busy(b, false); }
  });

  $('#brand').addEventListener('click', async e => {
    busy(e.target, true);
    try { await api('/api/voiceover/settings', { method: 'POST', body: choice() }); say($('#msg'), 'انحفظ صوت العلامة، ينطبق على كل توليد.', true); }
    catch (err) { say($('#msg'), err.message); }
    busy(e.target, false);
  });

  shell({ active: 'voice', section: 'voiceover', title: 'الصوت' }).then(me => { sectionTabs(me, 'voice', 'voiceover', ['فحص النص والصوت', 'Text & voice']); return load(); }).catch(err => say($('#msg'), err.message));
}
