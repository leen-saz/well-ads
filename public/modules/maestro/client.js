// المايسترو: يكلّف الإيجنتس بمهام، ويعرض حالتها، والموافقات اللي تنتظر المالكة. التشغيل في Paperclip.
import { $, api, say, esc, shell, busy } from '/assets/common.js';

// Runs on every visit of this page (assets/router.js calls it after each ClientRouter navigation).
export default async function mount() {

  let S = {};
  const AG = { active: 'جاهز', idle: 'فاضي', running: 'يشتغل', paused: 'موقف', error: 'فيه خطأ', pending_approval: 'ينتظر موافقة', terminated: 'منتهي' };
  const APPR = { hire_agent: 'توظيف إيجنت', approve_ceo_strategy: 'خطة المدير', budget_override_required: 'تجاوز الميزانية', request_board_approval: 'طلب موافقة' };

  function draw() {
    const agents = S.agents || [], names = Object.fromEntries(agents.map(a => [a.id, a.name]));
    if (!$('#agent').dataset.done) { $('#agent').insertAdjacentHTML('beforeend', agents.map(a => `<option value="${esc(a.id)}">${esc(a.name)}${a.title ? ' · ' + esc(a.title) : ''}</option>`).join('')); $('#agent').dataset.done = '1'; }
    $('#agents').innerHTML = agents.map(a => `<div class="so-top"><b>${esc(a.name)}</b><span class="muted">${esc(a.title || a.role || '')}</span><span class="so-st so-chip">${AG[a.status] || esc(a.status)}</span></div>`).join('') || '<p class="muted">ما فيه إيجنتس. أضفهم من Paperclip.</p>';
    $('#approvals').innerHTML = (S.approvals || []).map(a => `<article class="card so-post" data-id="${esc(a.id)}"><div class="so-top"><b>${APPR[a.type] || esc(a.type)}</b><span class="so-st muted">${a.requestedByAgentId ? esc(names[a.requestedByAgentId] || 'إيجنت') : ''}</span></div>
        ${S.owner ? '<div class="bar"><button class="btn sm primary" data-act="approve">وافق</button><button class="btn sm ghost" data-act="reject">ارفض</button></div>' : '<p class="muted" style="margin:0">القرار للمالكة.</p>'}</article>`).join('') || '<p class="muted">ما فيه شي ينتظر.</p>';
    $('#issues').innerHTML = (S.issues || []).slice(0, 50).map(i => `<article class="card so-post"><div class="so-top"><span class="so-chip">${esc(i.identifier || '')}</span><b>${esc(i.title || '')}</b>
        <span class="so-st muted">${S.statuses[i.status] || esc(i.status)}${i.assigneeAgentId ? ' · ' + esc(names[i.assigneeAgentId] || '') : ''}</span></div></article>`).join('') || '<p class="muted">ما فيه مهام للحين.</p>';
  }

  async function load() {
    try { S = await api('/api/maestro/state'); }
    catch (err) { $('#setup').innerHTML = `<section class="card pad" style="max-width:640px"><h2>المايسترو</h2><p class="muted">${esc(err.message)}</p><p class="so-note">يشتغل على Paperclip في سيرفر Cloudflare (Containers). الإعداد مرة وحدة من المالكة: انظر docs/paperclip.md.</p></section>`; return; }
    if (!S.connected) {
      $('#setup').innerHTML = `<section class="card pad" style="max-width:640px"><h2>اربط شركتك بالمايسترو</h2><p class="muted">ينشئ لشركتك مساحة في Paperclip: إيجنتس، مهام، ميزانية، وموافقات.</p>
        ${S.owner ? '<button class="btn primary" id="connect">اربط</button>' : '<p class="muted">الربط من المالكة.</p>'}<div class="msg" id="cmsg" role="status"></div></section>`;
      $('#connect')?.addEventListener('click', async e => { busy(e.target, true); try { await api('/api/maestro/connect', { method: 'POST', body: {} }); await load(); } catch (err) { say($('#cmsg'), err.message); busy(e.target, false); } });
      return;
    }
    $('#setup').innerHTML = ''; $('#board').hidden = false; draw();
  }

  $('#f').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.submitter; busy(btn, true);
    try { await api('/api/maestro/task', { method: 'POST', body: { title: $('#title').value, description: $('#desc').value, assigneeAgentId: $('#agent').value, priority: $('#prio').value } });
      say($('#msg'), 'وصلت للمايسترو.', true); e.target.reset(); await load(); }
    catch (err) { say($('#msg'), err.message); }
    busy(btn, false);
  });
  $('#approvals').addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    busy(b, true);
    try { await api('/api/maestro/approval', { method: 'POST', body: { id: b.closest('[data-id]').dataset.id, action: b.dataset.act } }); await load(); }
    catch (err) { say($('#msg'), err.message); busy(b, false); }
  });

  shell({ active: 'maestro', title: 'المايسترو' }).then(load).catch(err => say($('#msg'), err.message));
}
