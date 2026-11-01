// المايسترو بأسلوب Paperclip: تبويبات (لوحة، الوارد، المهام، الإيجنتس) بالرابط، قائمة أو لوحة، فلاتر، بحث، ومهمة جديدة في نافذة.
// اختصارات: C مهمة جديدة، / بحث، 1-4 التبويبات. التشغيل نفسه في Paperclip.
import { $, $$, api, say, esc, shell, busy, pageSignal } from '/assets/common.js';

// Runs on every visit of this page (assets/router.js calls it after each ClientRouter navigation).
export default async function mount() {

  let S = {};
  const AG = { active: 'جاهز', idle: 'فاضي', running: 'يشتغل', paused: 'موقف', error: 'فيه خطأ', pending_approval: 'ينتظر موافقة', terminated: 'منتهي' };
  const APPR = { hire_agent: 'توظيف إيجنت', approve_ceo_strategy: 'خطة المدير', budget_override_required: 'تجاوز الميزانية', request_board_approval: 'طلب موافقة' };
  const COLS = ['todo', 'in_progress', 'in_review', 'blocked', 'done'];
  const VIEWS = ['overview', 'inbox', 'tasks', 'agents'];
  const FILTERS = {
    inbox: [['all', 'الكل'], ['approvals', 'موافقات'], ['blocked', 'متوقفة']],
    tasks: [['all', 'الكل'], ['todo', 'جاهزة'], ['in_progress', 'شغالة'], ['in_review', 'للمراجعة'], ['blocked', 'متوقفة'], ['done', 'خلصت']],
    agents: [['all', 'الكل'], ['active', 'شغالين'], ['paused', 'موقفين'], ['error', 'فيهم خطأ']],
  };
  const ICON = {
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1Z"/>',
    tasks: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    agents: '<rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4M8 16h.01M16 16h.01"/>',
  };
  const url = new URL(location.href);
  let view = VIEWS.includes(url.searchParams.get('view')) ? url.searchParams.get('view') : 'overview';
  let filter = url.searchParams.get('f') || 'all';
  let layout = url.searchParams.get('layout') === 'board' ? 'board' : 'list';
  const names = () => Object.fromEntries((S.agents || []).map(a => [a.id, a.name]));
  const svg = d => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;
  const empty = (kind, text, cta) => `<div class="mx-empty">${svg(ICON[kind])}<p>${text}</p>${cta ? `<button class="btn sm secondary" data-new>${cta}</button>` : ''}</div>`;
  const matches = (...xs) => { const q = $('#q').value.trim().toLowerCase(); return !q || xs.some(x => String(x || '').toLowerCase().includes(q)); };

  // ---- the views
  const taskRow = i => `<article class="card mx-item"><span class="mx-dot ${esc(i.status)}" title="${esc(S.statuses[i.status] || i.status)}"></span><span class="mx-id">${esc(i.identifier || '')}</span>
    <b>${esc(i.title || '')}</b><span class="muted">${esc(names()[i.assigneeAgentId] || '')}</span><span class="so-chip">${esc(S.statuses[i.status] || i.status)}</span></article>`;
  const approvalRow = a => `<article class="card mx-item" data-id="${esc(a.id)}"><span class="mx-dot in_review"></span><b>${APPR[a.type] || esc(a.type)}</b>
    <span class="muted">${esc(names()[a.requestedByAgentId] || '')}</span>${S.canApprove ? '<button class="btn sm primary" data-act="approve">وافق</button><button class="btn sm ghost" data-act="reject">ارفض</button>' : '<span class="muted">يحتاج صلاحية موافقة</span>'}</article>`;

  function overview() {
    const is = S.issues || [];
    const week = Date.now() - 7 * 864e5;
    const k = [[is.filter(i => i.status === 'in_progress').length, 'مهام شغالة'], [(S.approvals || []).length, 'تنتظر موافقة'],
      [is.filter(i => i.status === 'done' && Date.parse(i.updatedAt || i.completedAt || 0) > week).length, 'خلصت هالأسبوع'], [(S.agents || []).filter(a => a.status === 'running').length, 'إيجنتس يشتغلون الحين']];
    return `<div class="mx-kpis">${k.map(([n, t]) => `<div class="card mx-kpi"><b>${n}</b><span>${t}</span></div>`).join('')}</div>
      <h3 style="margin:0 0 8px">آخر المهام</h3>${is.length ? `<div class="mx-list">${is.slice(0, 8).map(taskRow).join('')}</div>` : empty('tasks', 'ما فيه مهام للحين.', 'أنشئ مهمة')}`;
  }
  function inbox() {
    const ap = filter === 'blocked' ? [] : (S.approvals || []).filter(a => matches(APPR[a.type], a.type));
    const bl = filter === 'approvals' ? [] : (S.issues || []).filter(i => i.status === 'blocked' && matches(i.title, i.identifier));
    return ap.length || bl.length ? `<div class="mx-list">${ap.map(approvalRow).join('')}${bl.map(taskRow).join('')}</div>` : empty('inbox', 'الوارد فاضي.');
  }
  function tasks() {
    const is = (S.issues || []).filter(i => (filter === 'all' || i.status === filter) && matches(i.title, i.identifier, names()[i.assigneeAgentId]));
    if (!is.length) return empty('tasks', 'ما فيه مهام تطابق الفلتر أو البحث.', 'أنشئ مهمة');
    if (layout === 'list') return `<div class="mx-list">${is.map(taskRow).join('')}</div>`;
    return `<div class="mx-cols">${COLS.map(c => { const col = is.filter(i => i.status === c || (c === 'todo' && i.status === 'backlog'));
      return `<section class="mx-col"><h3><span class="mx-dot ${c}"></span>${esc(S.statuses[c] || c)} <span class="muted">${col.length}</span></h3>${col.map(taskRow).join('')}</section>`; }).join('')}</div>`;
  }
  function agents() {
    const ok = a => (filter === 'all' || (filter === 'active' ? ['active', 'idle', 'running'].includes(a.status) : a.status === filter)) && matches(a.name, a.title, a.role);
    const as = (S.agents || []).filter(ok);
    if (!as.length) return empty('agents', 'ما فيه إيجنتس. أضفهم من Paperclip.');
    const card = a => `<article class="card mx-item"><span class="mx-dot ${a.status === 'running' ? 'in_progress' : a.status === 'error' ? 'blocked' : a.status === 'paused' ? 'cancelled' : 'done'}"></span>
      <b>${esc(a.name)}</b><span class="muted">${esc(a.title || a.role || '')}</span><span class="so-chip">${AG[a.status] || esc(a.status)}</span></article>`;
    if (layout === 'list') return `<div class="mx-list">${as.map(card).join('')}</div>`;
    // Org chart: who reports to whom
    const ids = new Set(as.map(a => a.id));
    const tree = parent => { const kids = as.filter(a => (a.reportsTo && ids.has(a.reportsTo) ? a.reportsTo : null) === parent);
      return kids.length ? `<div class="mx-tree">${kids.map(a => card(a) + tree(a.id)).join('')}</div>` : ''; };
    return tree(null);
  }

  function draw() {
    $$('.mx-tabs [data-view]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === view)));
    $('#inboxCnt').textContent = ((S.approvals || []).length + (S.issues || []).filter(i => i.status === 'blocked').length) || '';
    const fs = FILTERS[view] || [];
    if (!fs.some(([k]) => k === filter)) filter = 'all';
    $('#filters').innerHTML = fs.map(([k, t]) => `<button type="button" data-filter="${k}" aria-pressed="${k === filter}">${t}</button>`).join('');
    $('#filters').hidden = !fs.length;
    $('.mx-layout').hidden = !['tasks', 'agents'].includes(view);
    $$('.mx-layout [data-layout]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.layout === layout)));
    $('#newTask').hidden = !S.canEdit;
    $('#view').innerHTML = { overview, inbox, tasks, agents }[view]();
    const u = new URL(location.href);
    u.searchParams.set('view', view);
    if (filter === 'all') u.searchParams.delete('f'); else u.searchParams.set('f', filter);
    if (layout === 'list') u.searchParams.delete('layout'); else u.searchParams.set('layout', layout);
    history.replaceState(history.state, '', u);
  }

  async function load() {
    try { S = await api('/api/maestro/state'); }
    catch (err) { $('#setup').innerHTML = `<section class="card pad" style="max-width:640px"><h2>المايسترو</h2><p class="muted">${esc(err.message)}</p><p class="so-note">يشتغل على Paperclip. الإعداد مرة وحدة من المالكة: انظر docs/paperclip.md.</p></section>`; return; }
    if (!S.connected) {
      $('#setup').innerHTML = `<section class="card pad" style="max-width:640px"><h2>اربط شركتك بالمايسترو</h2><p class="muted">ينشئ لشركتك مساحة في Paperclip: إيجنتس، مهام، ميزانية، وموافقات.</p>
        ${S.owner ? '<button class="btn primary" id="connect">اربط</button>' : '<p class="muted">الربط من المالكة.</p>'}<div class="msg" id="cmsg" role="status"></div></section>`;
      $('#connect')?.addEventListener('click', async e => { busy(e.target, true); try { await api('/api/maestro/connect', { method: 'POST', body: {} }); await load(); } catch (err) { say($('#cmsg'), err.message); busy(e.target, false); } });
      return;
    }
    $('#setup').innerHTML = ''; $('#board').hidden = false;
    if (!$('#agent').dataset.done) { $('#agent').insertAdjacentHTML('beforeend', (S.agents || []).map(a => `<option value="${esc(a.id)}">${esc(a.name)}${a.title ? ' · ' + esc(a.title) : ''}</option>`).join('')); $('#agent').dataset.done = '1'; }
    draw();
  }

  // ---- interactions
  const openNew = () => { if (S.canEdit && $('#dlg') && !$('#dlg').open) { $('#dlg').showModal(); $('#title').focus(); } };
  $('.mx-tabs').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) { view = b.dataset.view; filter = 'all'; draw(); } });
  $('#filters').addEventListener('click', e => { const b = e.target.closest('[data-filter]'); if (b) { filter = b.dataset.filter; draw(); } });
  $('.mx-layout').addEventListener('click', e => { const b = e.target.closest('[data-layout]'); if (b) { layout = b.dataset.layout; draw(); } });
  $('#q').addEventListener('input', () => draw());
  $('#newTask').onclick = openNew;
  $('#view').addEventListener('click', async e => {
    if (e.target.closest('[data-new]')) return openNew();
    const b = e.target.closest('[data-act]'); if (!b) return;
    busy(b, true);
    try { await api('/api/maestro/approval', { method: 'POST', body: { id: b.closest('[data-id]').dataset.id, action: b.dataset.act } }); await load(); }
    catch (err) { say($('#msg'), err.message); busy(b, false); }
  });
  $('#cancel').onclick = () => $('#dlg').close();
  $('#f').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.submitter; busy(btn, true);
    try {
      await api('/api/maestro/task', { method: 'POST', body: { title: $('#title').value, description: $('#desc').value, assigneeAgentId: $('#agent').value, priority: $('#prio').value } });
      e.target.reset(); $('#dlg').close(); say($('#msg'), 'وصلت للمايسترو.', true); view = 'tasks'; await load();
    } catch (err) { say($('#dmsg'), err.message); }
    busy(btn, false);
  });
  // Paperclip-style shortcuts, ignored while typing
  document.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') || $('#dlg')?.open) return;
    if (e.key === 'c' || e.key === 'C') { e.preventDefault(); openNew(); }
    else if (e.key === '/') { e.preventDefault(); $('#q').focus(); }
    else if (/^[1-4]$/.test(e.key) && !$('#board').hidden) { view = VIEWS[Number(e.key) - 1]; filter = 'all'; draw(); }
  }, { signal: pageSignal() });

  shell({ active: 'maestro', title: 'المايسترو' }).then(load).catch(err => say($('#msg'), err.message));
}
