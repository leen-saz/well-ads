// احلم: المحادثة في الصفحة الرئيسية. تسأل بالعربي عن إعلاناتك وأرقامك، والمساعد يقرأ ويقترح بس، وما ينفّذ شي.
// الجواب يجي بثّ حي من /api/today/ask (src/lib/ahlam.ts)، وتحته المصادر اللي قرأها.
import { $, esc, apiStream } from './common.js';

const MAX_TURNS = 6;

// نص بسيط آمن: يهرّب كل شي، وبعدها **غامق** والقوائم والفقرات
export function render(text) {
  const inline = s => esc(s).replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  const out = []; let list = false;
  for (const line of String(text).split('\n')) {
    const li = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inline(li[1])}</li>`); continue; }
    if (list) { out.push('</ul>'); list = false; }
    const h = /^#{1,4}\s+(.*)$/.exec(line);
    if (h) out.push(`<p><b>${inline(h[1])}</b></p>`); else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push('</ul>');
  return out.join('');
}

export function mountAhlam(root, me, L) {
  if (!root || root.dataset.ready) return;
  root.dataset.ready = '1';
  const ASK = [
    [L('وش وضع الإعلانات هالأسبوع؟', 'How are the ads doing this week?')],
    [L('أي إعلان أفضل نتيجة وأي واحد أضعف؟', 'Which ad is doing best and which is weakest?')],
    [L('وش القرارات اللي تنتظرني؟', 'What decisions are waiting for me?')],
    [L('لخّص لي معرفة الشركة عن الخدمات والأسعار', 'Summarize what the company taught the AI about services and prices')],
  ];
  root.innerHTML = `<div class="card ah-card">
    <p class="ah-note muted">${esc(L('اسألني عن إعلاناتك وأرقامك. أقرأ من اللي تقدر تشوفه أنت بس، وأقترح عليك، وما أنفّذ شي بنفسي. القرار لك.', 'Ask me about your ads and numbers. I read only what you can see, I suggest, and I never act on my own. The decision is yours.'))}</p>
    <div class="ah-chips" id="ahChips">${ASK.map(([q]) => `<button type="button">${esc(q)}</button>`).join('')}</div>
    <div class="ah-log" id="ahLog" role="log" aria-live="polite" aria-label="${esc(L('المحادثة', 'Conversation'))}"></div>
    <form class="ah-form" id="ahForm">
      <textarea id="ahQ" rows="2" maxlength="600" aria-label="${esc(L('سؤالك', 'Your question'))}" placeholder="${esc(L('اكتب سؤالك هنا…', 'Type your question…'))}"></textarea>
      <button class="btn primary" id="ahSend" type="submit"><span>${esc(L('اسأل', 'Ask'))}</span></button>
      <button class="btn" id="ahStop" type="button" hidden><span>${esc(L('إيقاف', 'Stop'))}</span></button>
    </form></div>`;
  const log = $('#ahLog', root), q = $('#ahQ', root), send = $('#ahSend', root), stop = $('#ahStop', root);
  const history = [];
  let ctl = null;

  const add = (cls, html) => { const d = document.createElement('div'); d.className = 'ah-m ' + cls; d.innerHTML = html; log.append(d); log.scrollTop = log.scrollHeight; return d; };
  const run = async text => {
    text = text.trim();
    if (!text || ctl) return;
    q.value = ''; $('#ahChips', root).hidden = true;
    add('me', `<p>${esc(text)}</p>`);
    const bot = add('bot', `<p class="muted">${esc(L('أفكّر…', 'Thinking…'))}</p>`);
    ctl = new AbortController(); send.disabled = true; stop.hidden = false;
    try {
      const res = await apiStream('/api/today/ask', { q: text, history: history.slice(-MAX_TURNS), lang: L('ar', 'en') }, { signal: ctl.signal, onText: t => { bot.innerHTML = render(t); log.scrollTop = log.scrollHeight; } });
      if (res?.answer) {
        bot.innerHTML = render(res.answer);
        const src = (res.sources || []).map(s => `<span class="p">${esc(L(s.ar, s.en))}</span>`).join('');
        bot.insertAdjacentHTML('beforeend', `<div class="ah-src"><span>${esc(src ? L('المصادر:', 'Sources:') : L('ما قرأت أي بيانات لهذا السؤال.', 'No data was read for this question.'))}</span>${src}</div>`);
        history.push({ role: 'user', content: text }, { role: 'assistant', content: res.answer });
      } else if (!res) bot.innerHTML = `<p class="muted">${esc(L('أوقفت الجواب.', 'Stopped.'))}</p>`;
    } catch (err) {
      bot.innerHTML = `<p>${esc(err?.message || L('ما قدرت أكمل الحين، جرّب مرة ثانية.', 'I could not finish. Please try again.'))}</p>`;
    } finally { ctl = null; send.disabled = false; stop.hidden = true; q.focus(); }
  };
  $('#ahForm', root).addEventListener('submit', ev => { ev.preventDefault(); run(q.value); });
  q.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); run(q.value); } });
  stop.addEventListener('click', () => ctl?.abort());
  $('#ahChips', root).addEventListener('click', ev => { const b = ev.target.closest('button'); if (b) run(b.textContent); });
}
