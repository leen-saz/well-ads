// "وش تعلّمت": the lessons card at the bottom of every live tab (docs/learning-loops.md, L1).
// Reads /api/lessons/list?module=<tab>; whoever has the tab's approve level approves or ignores each lesson.
import { $, api, esc, say, busy } from './common.js';

const ST = { new: 'جديد', reviewed: 'راجعه المايسترو', approved: 'معتمد' };
const when = s => new Intl.DateTimeFormat('ar-SA-u-nu-latn', { day: 'numeric', month: 'short', timeZone: 'Asia/Riyadh' }).format(new Date(s));
const pct = n => Number.isFinite(Number(n)) && Number(n) > 0 ? `${Math.round(Number(n) * 100)}%` : '';

export async function lessonsCard(module) {
  const content = $('#content');
  if (!content || $('#learned', content)) return;
  const card = document.createElement('details');
  card.className = 'card learned'; card.id = 'learned';
  card.innerHTML = '<summary class="pad"><h2>وش تعلّمت</h2><span class="muted" id="learnedN"></span></summary><div class="pad" id="learnedBody"></div>';
  content.append(card);
  async function load() {
    const r = await api(`/api/lessons/list?module=${encodeURIComponent(module)}`);
    const n = r.lessons.filter(l => l.status !== 'approved').length;
    $('#learnedN', card).textContent = r.lessons.length ? `${r.lessons.length} درس${n ? ` · ${n} ينتظر` : ''}` : '';
    $('#learnedBody', card).innerHTML = r.lessons.length ? `<ul class="lessons">${r.lessons.map(l => `<li data-id="${l.id}">
        <span class="chip ${l.status === 'approved' ? 'solid' : 'line'}">${esc(ST[l.status] || l.status)}</span>
        <span><b>${esc(l.lesson)}</b></span>
        <span class="muted">${esc(when(l.created_at))}${l.source ? ` · ${esc(l.source)}` : ''}${pct(l.confidence) ? ` · ثقة ${pct(l.confidence)}` : ''}${l.decided_by ? ` · ${esc(l.decided_by)}` : ''}</span>
        ${r.canDecide && l.status !== 'approved' ? `<span class="bar"><button class="btn sm primary" data-act="approve">اعتمد</button><button class="btn sm ghost" data-act="ignore">تجاهل</button></span>` : ''}
      </li>`).join('')}</ul><div class="msg" id="learnedMsg" role="status"></div>`
      : '<p class="muted" style="margin:0">ما فيه دروس للحين. اللوب اليومي يكتبها هنا من بيانات هالتاب، ويرسلها للمايسترو يراجعها.</p>';
  }
  card.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    busy(b, true);
    try { await api('/api/lessons/list', { method: 'PATCH', body: { module, id: b.closest('[data-id]').dataset.id, action: b.dataset.act } }); await load(); }
    catch (err) { say($('#learnedMsg', card), err.message); busy(b, false); }
  });
  await load();
}
