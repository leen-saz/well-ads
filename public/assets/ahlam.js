// احلم: المحادثة في الصفحة الرئيسية. تسأل بالعربي عن إعلاناتك وأرقامك، والمساعد يقرأ ويقترح بس، وما ينفّذ شي.
// الجواب يجي بثّ حي من /api/today/ask (src/lib/ahlam.ts)، وتحته المصادر اللي قرأها.
import { $, esc, apiStream, friendly } from './common.js';

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

// A request to RUN a campaign (not a question about one): «سوّ حملة …»، «ابغى حملة للقدم»، "start a campaign for …". The chat never starts it
// by itself: it offers the one-tap chip, and the plan and its cost come first.
const WANT = /(?:سو+ي?|سوّ?ي?|اسو+ي?|ابد[اأ]|ابغ[ىي]|أبغ[ىي]|ابي|أبي|نبي|نبغ[ىي]|جهّ?ز|اطلق|أطلق|شغّ?ل|اعمل|ابني|أبني|خطط|رتّ?ب|أحتاج|احتاج|أريد|اريد|أرغب|ودي|وددت)\s+(?:لي\s+|لنا\s+|عليّ\s+)?(?:\S+\s+){0,2}?حمل[ةه]|\b(?:start|launch|run|create|make|plan|set up|build)\b[^.?!]{0,30}\bcampaign\b/i;
const ASKING = /^\s*(?:وش|ايش|إيش|شو|كم|هل|متى|ليش|لماذا|كيف|what|how|why|when|which|is |are |did |does )/i;
export const wantsCampaign = text => WANT.test(String(text || '')) && !ASKING.test(String(text || ''));

export function mountAhlam(root, me, L, onStart) {
  if (!root || root.dataset.ready) return;
  root.dataset.ready = '1';
  const ASK = [
    [L('وش وضع الإعلانات هالأسبوع؟', 'How are the ads doing this week?')],
    [L('أي إعلان أفضل نتيجة وأي واحد أضعف؟', 'Which ad is doing best and which is weakest?')],
    [L('وش القرارات اللي تنتظرني؟', 'What decisions are waiting for me?')],
    [L('لخّص لي معرفة الشركة عن الخدمات والأسعار', 'Summarize what the company taught the AI about services and prices')],
  ];
  root.innerHTML = `<div class="card ah-card">
    <div class="ah-run"><div><b>${esc(L('تبي تشغّل حملة كاملة؟', 'Want to run a whole campaign?'))}</b><p class="ah-note muted">${esc(L('اكتب هدفك بجملة وأجهّز لك خطة لكل الإيجنتس مع تكلفتها. ما يشتغل شي ولا ينصرف ريال قبل ما تعتمد، وبعدها يكمل لوحده لين تجهز الحزمة.', 'Write your goal in one sentence and I will build a plan for all the agents with its cost. Nothing runs and nothing is spent before you approve; then it carries on by itself until the pack is ready.'))}</p></div>
      <button class="btn primary" id="ahStart" type="button">${esc(L('ابدأ حملة', 'Start a campaign'))}</button></div>
    <form class="ah-go" id="ahGo" hidden>
      <label for="ahGoal">${esc(L('وش تبي من الحملة؟', 'What do you want from the campaign?'))}</label>
      <textarea id="ahGoal" rows="3" maxlength="400" placeholder="${esc(L('مثلاً: سوّ حملة لتقويم القدم للأطفال في الرياض', 'For example: start a campaign for children\'s foot alignment in Riyadh'))}"></textarea>
      <div class="cm-actions"><button class="btn primary" id="ahPlan" type="submit">${esc(L('جهّز الخطة والتكلفة', 'Build the plan and cost'))}</button><button class="btn" id="ahGoX" type="button">${esc(L('إلغاء', 'Cancel'))}</button></div>
    </form>
    <p class="ah-note muted">${esc(L('اسألني عن إعلاناتك وأرقامك. أقرأ من اللي تقدر تشوفه أنت بس، وأقترح عليك، وما أنفّذ شي بنفسي. القرار لك.', 'Ask me about your ads and numbers. I read only what you can see, I suggest, and I never act on my own. The decision is yours.'))}</p>
    <div class="ah-chips" id="ahChips">${ASK.map(([q]) => `<button type="button">${esc(q)}</button>`).join('')}</div>
    <div class="ah-log" id="ahLog" role="log" aria-live="off" aria-label="${esc(L('المحادثة', 'Conversation'))}"></div>
    <div id="ahLive" role="status" aria-live="polite" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap"></div>
    <form class="ah-form" id="ahForm">
      <textarea id="ahQ" rows="2" maxlength="600" aria-label="${esc(L('سؤالك', 'Your question'))}" placeholder="${esc(L('اكتب سؤالك هنا…', 'Type your question…'))}"></textarea>
      <button class="btn primary" id="ahSend" type="submit"><span>${esc(L('اسأل', 'Ask'))}</span></button>
      <button class="btn" id="ahStop" type="button" hidden><span>${esc(L('إيقاف', 'Stop'))}</span></button>
    </form></div>`;
  const go = $('#ahGo', root), goal = $('#ahGoal', root);
  const plan = text => { text = String(text || '').trim(); if (!text) return; go.hidden = true; goal.value = ''; if (onStart) onStart(text); };
  $('#ahStart', root).addEventListener('click', () => { go.hidden = false; goal.value = goal.value || ($('#ahQ', root).value || '').trim(); goal.focus(); });
  $('#ahGoX', root).addEventListener('click', () => { go.hidden = true; });
  go.addEventListener('submit', ev => { ev.preventDefault(); plan(goal.value); });
  const log = $('#ahLog', root), q = $('#ahQ', root), send = $('#ahSend', root), stop = $('#ahStop', root);
  const history = [];
  let ctl = null;

  const add = (cls, html) => { const d = document.createElement('div'); d.className = 'ah-m ' + cls; d.innerHTML = html; log.append(d); log.scrollTop = log.scrollHeight; return d; };
  const run = async text => {
    text = text.trim();
    if (!text || ctl) return;
    q.value = ''; $('#ahChips', root).hidden = true;
    add('me', `<p>${esc(text)}</p>`);
    if (onStart && wantsCampaign(text)) {
      // not a question: offer the campaign as one tap, answer nothing from the model (no cost), and start nothing by itself
      const m = add('bot', `<p>${esc(L('هذا طلب حملة. أجهّز لك خطة من جملتك مع التكلفة المتوقعة، وما يشتغل شي ولا ينصرف ريال إلا بعد ما تعتمد.', 'That sounds like a campaign request. I can build a plan from your sentence with the expected cost; nothing runs and nothing is spent until you approve.'))}</p><div class="ah-chips"><button type="button" data-plan>${esc(L('ابدأ حملة بهذا الطلب', 'Start a campaign from this request'))}</button></div>`);
      m.querySelector('[data-plan]').addEventListener('click', ev => { ev.currentTarget.disabled = true; plan(text); }, { once: true });
      return;
    }
    // The thinking indicator: pulsing dots and the steps as they happen (what is being read, which tool); it is replaced by the answer
    const steps = [];
    const think = () => `<div class="ah-think" role="status"><span class="ah-dots" aria-hidden="true"><i></i><i></i><i></i></span><ul>${steps.length ? steps.map((x, i) => `<li class="${i === steps.length - 1 ? 'now' : 'done'}">${esc(x)}</li>`).join('') : `<li class="now">${esc(L('أفكّر…', 'Thinking…'))}</li>`}</ul></div>`;
    const bot = add('bot', think());
    ctl = new AbortController(); send.disabled = true; stop.hidden = false;
    try {
      const res = await apiStream('/api/today/ask', { q: text, history: history.slice(-MAX_TURNS), lang: L('ar', 'en') }, { signal: ctl.signal, onStep: ev => { steps.push(L(ev.ar, ev.en)); if (!bot.dataset.text) bot.innerHTML = think(); }, onText: t => { bot.dataset.text = '1'; bot.innerHTML = render(t); log.scrollTop = log.scrollHeight; } });
      if (res?.answer) {
        bot.innerHTML = render(res.answer);
        $('#ahLive', root).textContent = bot.textContent;
        const src = (res.sources || []).map(s => `<span class="p">${esc(L(s.ar, s.en))}</span>`).join('');
        bot.insertAdjacentHTML('beforeend', `<div class="ah-src"><span>${esc(src ? L('المصادر:', 'Sources:') : L('ما قرأت أي بيانات لهذا السؤال.', 'No data was read for this question.'))}</span>${src}</div>`);
        history.push({ role: 'user', content: text }, { role: 'assistant', content: res.answer });
      } else if (!res) bot.innerHTML = `<p class="muted">${esc(L('أوقفت الجواب.', 'Stopped.'))}</p>`;
    } catch (err) {
      bot.innerHTML = `<p>${esc(friendly(err?.message || L('ما قدرت أكمل الحين، جرّب مرة ثانية.', 'I could not finish. Please try again.'), L('ما قدرت أكمل الحين، جرّب مرة ثانية.', 'I could not finish. Please try again.')))}</p>`;
    } finally { ctl = null; send.disabled = false; stop.hidden = true; q.focus(); }
  };
  $('#ahForm', root).addEventListener('submit', ev => { ev.preventDefault(); run(q.value); });
  q.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); run(q.value); } });
  stop.addEventListener('click', () => ctl?.abort());
  $('#ahChips', root).addEventListener('click', ev => { const b = ev.target.closest('button'); if (b) run(b.textContent); });
}
