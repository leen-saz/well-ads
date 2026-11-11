// المدير: تبويبات (لوحة، الوارد، المهام، الإيجنتس، المحادثة) بالرابط، قائمة أو لوحة، فلاتر، بحث، ومهمة جديدة في نافذة.
// اختصارات: C مهمة جديدة، / بحث، 1-5 التبويبات.
import { LANG, $, $$, api, say, esc, fmt, shell, busy, pageSignal, failure, pageFailure, when, icon } from '/assets/common.js';
import { t } from '/assets/i18n.js';
import { mountPeriod } from '/assets/period.js';

// Runs on every visit of this page (assets/router.js calls it after each ClientRouter navigation).
export default async function mount() {

  let S = {};
  const AG = { active: 'جاهز', idle: 'فاضي', running: 'يشتغل', paused: 'موقف', error: 'فيه خطأ', pending_approval: 'ينتظر موافقة', terminated: 'منتهي' };
  const APPR = { hire_agent: 'توظيف إيجنت', approve_ceo_strategy: 'خطة المدير', budget_override_required: 'تجاوز الميزانية', request_board_approval: 'طلب موافقة' };
  const COLS = ['todo', 'in_progress', 'in_review', 'blocked', 'done'];
  const VIEWS = ['overview', 'inbox', 'tasks', 'agents', 'chat'];
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
  // Paperclip budgets are monthly, in US cents; 0 means no cap
  const usd = c => '$' + fmt((Number(c) || 0) / 100, 2);
  const spend = b => `<span class="mx-bud" title="صرف هالشهر">${usd(b.spentMonthlyCents)} من ${Number(b.budgetMonthlyCents) > 0 ? usd(b.budgetMonthlyCents) : 'بدون سقف'}${Number(b.budgetMonthlyCents) > 0 ? `<i style="--p:${Math.min(100, Math.round(100 * (Number(b.spentMonthlyCents) || 0) / Number(b.budgetMonthlyCents)))}%"></i>` : ''}</span>`;
  const tabName = i => { const k = (S.projectTabs || {})[i.projectId]; return k ? ((S.tabs || []).find(t => t.key === k)?.ar || k) : ''; };
  const tabsOf = id => [...new Set((S.issues || []).filter(i => i.assigneeAgentId === id).map(tabName).filter(Boolean))];
  const working = id => (S.issues || []).find(i => i.assigneeAgentId === id && i.status === 'in_progress');
  const matches = (...xs) => { const q = $('#q').value.trim().toLowerCase(); return !q || xs.some(x => String(x || '').toLowerCase().includes(q)); };

  // The same groups as the sidebar (S.groups, from the server): lists and the task picker are grouped by them
  const GEN = ['general', 'عام', 'General'];
  const glabel = g => (LANG === 'en' ? g.en : g.ar);
  const tabGroup = k => (S.tabs || []).find(t => t.key === k)?.group || GEN[0];
  const issueGroup = i => tabGroup((S.projectTabs || {})[i.projectId]);
  const agentGroup = id => issueGroup((S.issues || []).find(i => i.assigneeAgentId === id && (S.projectTabs || {})[i.projectId]) || {});
  const grouped = (items, keyOf, render) => {
    const gs = [...(S.groups || []), { key: GEN[0], ar: GEN[1], en: GEN[2] }];
    return gs.map(g => { const xs = items.filter(x => (gs.some(y => y.key === keyOf(x)) ? keyOf(x) : GEN[0]) === g.key);
      return xs.length ? `<section class="mx-grp"><h3 class="mx-gh">${esc(glabel(g))} <span class="muted">${xs.length}</span></h3><div class="mx-list">${xs.map(render).join('')}</div></section>` : ''; }).join('');
  };

  // ---- the views
  const taskRow = i => `<article class="card mx-item"><span class="mx-dot ${esc(i.status)}" title="${esc(S.statuses[i.status] || i.status)}"></span><span class="mx-id">${esc(i.identifier || '')}</span>
    <b>${esc(i.title || '')}</b>${tabName(i) ? `<span class="so-chip mx-tab">${esc(tabName(i))}</span>` : ''}<span class="muted">${esc(names()[i.assigneeAgentId] || '')}</span><span class="so-chip">${esc(S.statuses[i.status] || i.status)}</span></article>`;
  const approvalRow = a => `<article class="card mx-item" data-id="${esc(a.id)}"><span class="mx-dot in_review"></span><b>${APPR[a.type] || esc(a.type)}</b>
    <span class="muted">${esc(names()[a.requestedByAgentId] || '')}</span>${S.canApprove ? '<button class="btn sm primary" data-act="approve">وافق</button><button class="btn sm ghost" data-act="reject">ارفض</button>' : '<span class="muted">يحتاج صلاحية موافقة</span>'}</article>`;

  function overview() {
    const is = S.issues || [];
    const week = Date.now() - 7 * 864e5;
    const k = [[is.filter(i => i.status === 'in_progress').length, 'مهام شغالة'], [(S.approvals || []).length, 'تنتظر موافقة'],
      [is.filter(i => i.status === 'done' && Date.parse(i.updatedAt || i.completedAt || 0) > week).length, 'خلصت هالأسبوع'], [(S.agents || []).filter(a => a.status === 'running').length, 'إيجنتس يشتغلون الحين'],
      [S.budget ? usd(S.budget.spent) : '—', S.budget?.cap ? `صرف الإيجنتس هالشهر من ${usd(S.budget.cap)}` : 'صرف الإيجنتس هالشهر']];
    return `<div class="mx-kpis">${k.map(([n, t]) => `<div class="card mx-kpi"><b>${n}</b><span>${t}</span></div>`).join('')}</div>
      <h3 style="margin:0 0 8px">آخر المهام</h3>${is.length ? `<div class="mx-list">${is.slice(0, 8).map(taskRow).join('')}</div>` : empty('tasks', 'ما فيه مهام للحين.', 'أنشئ مهمة')}`;
  }
  function inbox() {
    const ap = filter === 'blocked' ? [] : (S.approvals || []).filter(a => matches(APPR[a.type], a.type));
    const bl = filter === 'approvals' ? [] : (S.issues || []).filter(i => i.status === 'blocked' && matches(i.title, i.identifier));
    return ap.length || bl.length ? `<div class="mx-list">${ap.map(approvalRow).join('')}${bl.map(taskRow).join('')}</div>` : empty('inbox', 'الوارد فاضي.');
  }
  function tasks() {
    const is = (S.issues || []).filter(i => (filter === 'all' || i.status === filter) && matches(i.title, i.identifier, names()[i.assigneeAgentId], tabName(i)));
    if (!is.length) return empty('tasks', 'ما فيه مهام تطابق الفلتر أو البحث.', 'أنشئ مهمة');
    if (layout === 'list') return grouped(is, issueGroup, taskRow);
    return `<div class="mx-cols">${COLS.map(c => { const col = is.filter(i => i.status === c || (c === 'todo' && i.status === 'backlog'));
      return `<section class="mx-col"><h3><span class="mx-dot ${c}"></span>${esc(S.statuses[c] || c)} <span class="muted">${col.length}</span></h3>${col.map(taskRow).join('')}</section>`; }).join('')}</div>`;
  }
  function agents() {
    const ok = a => (filter === 'all' || (filter === 'active' ? ['active', 'idle', 'running'].includes(a.status) : a.status === filter)) && matches(a.name, a.title, a.role);
    const as = (S.agents || []).filter(ok);
    if (!as.length) return empty('agents', 'ما فيه إيجنتس للحين.');
    const card = a => `<article class="card mx-item" data-agent="${esc(a.id)}"><span class="mx-dot ${a.status === 'running' ? 'in_progress' : a.status === 'error' ? 'blocked' : a.status === 'paused' ? 'cancelled' : 'done'}"></span>
      <b>${esc(a.name)}</b><span class="muted">${esc(a.title || a.role || '')}</span><span class="so-chip">${AG[a.status] || esc(a.status)}</span>
      ${spend(a)}${tabsOf(a.id).length ? `<span class="muted">التابات: ${esc(tabsOf(a.id).join('، '))}</span>` : ''}${working(a.id) ? `<span class="mx-now">يشتغل على: ${esc(working(a.id).identifier || '')} ${esc(working(a.id).title || '')}</span>` : ''}<button type="button" class="btn sm ghost" data-perf>الأداء</button></article>`;
    if (layout === 'list') return grouped(as, a => agentGroup(a.id), card);
    // Org chart: who reports to whom
    const ids = new Set(as.map(a => a.id));
    const tree = parent => { const kids = as.filter(a => (a.reportsTo && ids.has(a.reportsTo) ? a.reportsTo : null) === parent);
      return kids.length ? `<div class="mx-tree">${kids.map(a => card(a) + tree(a.id)).join('')}</div>` : ''; };
    return tree(null);
  }

  // ---- the chat with «المدير»: approvals and «وين وصلنا؟» answered here from Paperclip's data (no model);
  // free text goes to the CEO agent as a comment, and its reply shows up on the next refresh
  let lines = [], local = [], poll = 0;
  const bubble = l => `<div class="mx-msg${l.agent ? ' them' : ''}"><small class="muted">${esc(l.name)}</small><p>${l.html || esc(l.body)}</p></div>`;
  function statusNow() {
    const by = {};
    for (const i of S.issues || []) { if (!['in_progress', 'blocked', 'todo'].includes(i.status)) continue; const t = tabName(i) || 'عام'; (by[t] ||= { todo: 0, in_progress: 0, blocked: 0 })[i.status]++; }
    const rows = Object.entries(by).map(([t, c]) => `<li><b>${esc(t)}</b>: ${c.in_progress} شغالة، ${c.todo} جاهزة${c.blocked ? `، <b>${c.blocked} متوقفة</b>` : ''}</li>`).join('');
    return `${rows ? `<ul>${rows}</ul>` : 'ما فيه مهام مفتوحة.'}${(S.approvals || []).length ? `<br>${(S.approvals || []).length} موافقة تنتظرك، تحت.` : ''}`;
  }
  function chat() {
    const ap = S.approvals || [];
    return `<div class="mx-chat"><div class="mx-thread" id="thread">${[...lines, ...local].map(bubble).join('') || '<p class="muted">اكتب للمدير: يوزع مهمة، يرد على سؤال، أو يقول لك وين وصل الشغل.</p>'}</div>
      ${ap.length ? `<div class="mx-list">${ap.map(approvalRow).join('')}</div>` : ''}
      <div class="mx-quick"><button type="button" class="btn sm secondary" data-q="status">وين وصلنا؟</button>${S.canEdit ? '<button type="button" class="btn sm secondary" data-q="task">أسند مهمة</button>' : ''}</div>
      ${S.canEdit ? '<form class="mx-say" id="say"><textarea id="sayText" rows="2" placeholder="اكتب للمدير…" aria-label="رسالة للمدير"></textarea><button class="btn primary" type="submit">أرسل</button></form>' : ''}</div>`;
  }
  async function loadChat() {
    try { lines = (await api('/api/maestro/chat')).lines || []; } catch (err) { say($('#msg'), err.message); }
    if (view === 'chat' && !$('#sayText')?.value) { draw(); const t = $('#thread'); if (t) t.scrollTop = t.scrollHeight; }
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
    const draft = $('#sayText')?.value;
    $('#view').innerHTML = { overview, inbox, tasks, agents, chat }[view]();
    if (draft && $('#sayText')) $('#sayText').value = draft;
    clearInterval(poll);
    if (view === 'chat') poll = setInterval(() => { if (!document.hidden) loadChat(); }, 20000);
    const u = new URL(location.href);
    u.searchParams.set('view', view);
    if (filter === 'all') u.searchParams.delete('f'); else u.searchParams.set('f', filter);
    if (layout === 'list') u.searchParams.delete('layout'); else u.searchParams.set('layout', layout);
    history.replaceState(history.state, '', u);
  }


  // Connecting the company: a failure is an explained state with a retry that waits a little, never a bare line.
  // The engine's own reason stays in the server logs (routes.ts); the page only says what happened in plain words.
  let cool = 0;
  async function connect(e) {
    const btn = e.currentTarget; busy(btn, true); $('#cmsg').innerHTML = '';
    try { await api('/api/maestro/connect', { method: 'POST', body: {} }); await load(); }
    catch {
      busy(btn, false);
      const when_ = new Intl.DateTimeFormat(document.documentElement.lang === 'en' ? 'en-GB' : 'ar-SA-u-nu-latn', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Riyadh' }).format(new Date());
      $('#cmsg').innerHTML = `<div class="mr-err" role="alert">${icon('alert')}<div>
        <strong>ما قدرنا نجهز مساحة شركتك</strong>
        <p>صار خلل مؤقت عندنا وما انحفظ شي. جرّب مرة ثانية بعد لحظات.</p>
        <p class="muted">لو تكرر الخلل، تواصل مع الدعم وخبره بوقت المحاولة: <bdi dir="ltr">${esc(when_)}</bdi></p>
        <button class="btn sm secondary" type="button" id="cretry" disabled><span>أعد المحاولة</span> <span class="mr-cd" dir="ltr"></span></button></div></div>`;
      const rb = $('#cretry'), cd = rb.querySelector('.mr-cd'); cool = 20;
      const tick = () => { if (!rb.isConnected) return; if (cool > 0) { cd.textContent = '0:' + String(cool--).padStart(2, '0'); setTimeout(tick, 1000); } else { cd.textContent = ''; rb.disabled = false; } };
      tick(); rb.addEventListener('click', connect);
    }
  }

  async function load() {
    try { S = await api('/api/maestro/state'); }
    catch (err) { failure($('#setup'), err, load); return; }
    if (!S.connected) {
      $('#setup').innerHTML = `<section class="card pad" style="max-width:640px"><h2>اربط شركتك بالمدير</h2><p class="muted">يجهز لشركتك مساحة فيها إيجنتس، ومهام، وميزانية، وموافقات.</p>
        ${S.owner ? '<button class="btn primary" id="connect">اربط</button>' : '<p class="muted">الربط من المالك.</p>'}<div id="cmsg" aria-live="polite"></div></section>`;
      $('#connect')?.addEventListener('click', connect);
      return;
    }
    $('#setup').innerHTML = ''; $('#board').hidden = false;
    if (!$('#agent').dataset.done) { $('#agent').insertAdjacentHTML('beforeend', (S.agents || []).map(a => `<option value="${esc(a.id)}">${esc(a.name)}${a.title ? ' · ' + esc(a.title) : ''}</option>`).join('')); $('#agent').dataset.done = '1'; }
    if (!$('#tab').dataset.done) { $('#tab').insertAdjacentHTML('beforeend', (S.groups || []).map(g => { const ts = (S.tabs || []).filter(t => t.group === g.key); return ts.length ? `<optgroup label="${esc(glabel(g))}">${ts.map(t => `<option value="${esc(t.key)}">${esc(t.ar)}</option>`).join('')}</optgroup>` : ''; }).join('')); $('#tab').dataset.done = '1'; }
    draw();
  }

  // ---- interactions
  const openNew = () => { if (S.canEdit && $('#dlg') && !$('#dlg').open) { $('#dlg').showModal(); $('#title').focus(); } };
  $('.mx-tabs').addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) { view = b.dataset.view; filter = 'all'; draw(); if (view === 'chat') loadChat(); } });
  $('#view').addEventListener('click', e => {
    const q = e.target.closest('[data-q]'); if (!q) return;
    const text = $('#sayText')?.value.trim() || '';
    if (q.dataset.q === 'status') { local.push({ name: 'أنت', body: 'وين وصلنا؟' }, { agent: true, name: 'المدير', html: statusNow() }); draw(); }
    else { openNew(); if (text) $('#title').value = text.slice(0, 200); }
  });
  $('#view').addEventListener('submit', async e => {
    if (e.target.id !== 'say') return;
    e.preventDefault();
    const btn = e.submitter; busy(btn, true);
    try { await api('/api/maestro/chat', { method: 'POST', body: { text: $('#sayText').value } }); $('#sayText').value = ''; local = []; await loadChat(); say($('#msg'), 'وصلت للمدير، يرد في تشغيله الجاي.', true); }
    catch (err) { say($('#msg'), err.message); }
    busy(btn, false);
  });
  pageSignal().addEventListener('abort', () => clearInterval(poll));
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
  // ---- an agent's performance card (/api/maestro/agent): tasks done, spend, success rate, task time, last error
  let perfAgent = null, perfRange = null, perfBar = null, perfSeq = 0;
  const n = (v, unit = '') => v == null ? '—' : `${fmt(v)}${unit}`;
  async function perf() {
    const a = (S.agents || []).find(x => x.id === perfAgent); if (!a || !perfRange) return;
    $('#perfName').textContent = a.name + (a.title || a.role ? ' · ' + (a.title || a.role) : '');
    $('#perfBody').innerHTML = '<p class="muted">يحمّل…</p>';
    const mine = ++perfSeq; // a slower answer for an earlier period must not overwrite the newer one
    try {
      const p = await api(`/api/maestro/agent?id=${encodeURIComponent(a.id)}&from=${perfRange.from}&to=${perfRange.to}`);
      if (mine !== perfSeq) return;
      const k = [[n(p.done), 'مهام خلصت'], [p.spentCents == null ? '—' : usd(p.spentCents), 'الصرف'], [n(p.successRate, '%'), `نجاح التشغيلات (${n(p.runs)})`], [n(p.avgTaskMinutes, ' د'), 'متوسط وقت المهمة']];
      $('#perfBody').innerHTML = `<div class="mx-kpis">${k.map(([v, t]) => `<div class="card mx-kpi"><b>${esc(v)}</b><span>${t}</span></div>`).join('')}</div>
        ${spend(a)}<p class="muted">آخر تشغيل: ${p.lastRunAt ? esc(when(p.lastRunAt)) : '—'}</p>${p.lastError ? `<p class="so-note">آخر خطأ: ${esc(p.lastError)}</p>` : ''}`;
    } catch (err) { if (mine === perfSeq) failure($('#perfBody'), err, perf); }
  }
  $('#view').addEventListener('click', e => { const b = e.target.closest('[data-perf]'); if (!b) return; perfAgent = b.closest('[data-agent]').dataset.agent;
    // the same period bar as the other pages, made the first time the card opens; changing it reloads the card
    perfBar ||= mountPeriod($('#perfPeriod'), { id: 'maestro-agent', def: '30', url: false, onChange: r => { perfRange = r; if ($('#pdlg').open) perf(); } });
    $('#pdlg').showModal(); perf(); });
  $('#perfClose').onclick = () => $('#pdlg').close();
  $('#cancel').onclick = () => $('#dlg').close();
  $('#f').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.submitter; busy(btn, true);
    try {
      await api('/api/maestro/task', { method: 'POST', body: { title: $('#title').value, description: $('#desc').value, assigneeAgentId: $('#agent').value, tab: $('#tab').value, priority: $('#prio').value } });
      e.target.reset(); $('#dlg').close(); say($('#msg'), 'وصلت للمدير.', true); view = 'tasks'; await load();
    } catch (err) { say($('#dmsg'), err.message); }
    busy(btn, false);
  });
  // Keyboard shortcuts, ignored while typing
  document.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') || $('#dlg')?.open || $('#pdlg')?.open) return;
    if (e.key === 'c' || e.key === 'C') { e.preventDefault(); openNew(); }
    else if (e.key === '/') { e.preventDefault(); $('#q').focus(); }
    else if (/^[1-5]$/.test(e.key) && !$('#board').hidden) { view = VIEWS[Number(e.key) - 1]; filter = 'all'; draw(); if (view === 'chat') loadChat(); }
  }, { signal: pageSignal() });

  // ---- spend on the AI (owner only: the route answers 403 to anyone else and the section stays hidden)
  async function mountSpend(month = '') {
    let d;
    try { d = await api('/api/maestro/usage' + (month ? `?month=${encodeURIComponent(month)}` : '')); }
    catch (err) { if (/مشاهدة|صلاحية|مقفل/.test(err.message)) return; if (/الجدول ناقص/.test(err.message)) { $('#spend').hidden = false; $('#spendBody').innerHTML = `<p class="muted">${esc(err.message)}</p>`; } return; }
    $('#spend').hidden = false;
    const ms = d.months.map(m => `<option value="${esc(m.month)}"${m.month === d.month ? ' selected' : ''}>${esc(m.month)}</option>`).join('');
    $('#spendMonth').innerHTML = ms; $('#recMonth').innerHTML = ms;
    const hot = d.tabs.filter(t => t.level !== 'ok');
    $('#spendAlert').innerHTML = hot.map(t => `<div class="so-note"><b>${esc(t.ar)}</b>: ${t.level === 'capped' ? 'وصل السقف الشهري، والتاب الحين يكتب بالمجاني' : `وصل ${t.alert_pct}% من سقفه الشهري`}</div>`).join('');
    drawModels(d.models);
    const FLAG = { alert: 'قريب من السقف', capped: 'وصل السقف' };
    $('#spendBody').innerHTML = `<p class="sp-total">${fmt(d.total.sar, 2)} <small class="muted" style="font:500 14px var(--f-ar)">ريال، ${fmt(d.total.usd, 2)} دولار (سعر الصرف ${d.rate})</small></p>
      <div class="sp-tab sp-hd"><span>التاب</span><span>الطلبات</span><span>الصرف (ر.س)</span><span>السقف الشهري (ر.س)</span><span></span></div>
      ${d.tabs.map(t => `<form class="sp-tab" data-tab="${esc(t.tab)}" novalidate>
        <b>${esc(t.ar)}${t.unpriced ? ` <span class="sp-flag" title="سعر غير معروف انحسب بصفر">${t.unpriced} بدون سعر</span>` : ''}</b>
        <b class="n">${fmt(t.calls)}</b><b class="n">${fmt(t.sar, 2)}</b>
        <span><input type="number" name="cap" min="0" step="1" inputmode="decimal" dir="ltr" placeholder="بدون سقف" aria-label="السقف الشهري لتاب ${esc(t.ar)}" value="${t.cap_sar ?? ''}"${d.current ? '' : ' disabled'}>${t.level !== 'ok' ? ` <span class="sp-flag${t.level === 'capped' ? ' bad' : ''}">${FLAG[t.level]}</span>` : ''}</span>
        <button class="btn sm secondary" type="submit"${d.current ? '' : ' disabled'}>احفظ</button></form>`).join('')}`;
  }
  // recorded against expected (tokens priced from our table), per provider and model; the check against the real invoice is the form below
  function drawModels(rows) {
    const box = $('#spendModels');
    if (!rows) { box.innerHTML = ''; return; }
    if (!rows.length) { box.innerHTML = '<p class="muted">ما فيه طلبات مسجّلة هالشهر</p>'; return; }
    const usd = n => (n === null || n === undefined ? '—' : fmt(n, 4));
    box.innerHTML = `<h3 style="margin:18px 0 4px">المسجّل مقابل المتوقع</h3>
      <p class="so-note">المتوقع = التوكنز × جدول الأسعار. لو المزوّد يرجّع تكلفته بنفسه (OpenRouter) أو التسجيل تقديري (بحث، صور) يختلف الرقمان، وهذا طبيعي. الأسعار تبقى تقديرية لين تطابقها مع فاتورة.</p>
      <div class="sp-tab sp-hd"><span>المزوّد والموديل</span><span>الطلبات</span><span>المسجّل ($)</span><span>المتوقع ($)</span><span>الفرق</span></div>
      ${rows.map(r => `<div class="sp-tab"><b>${esc(PNAME[r.provider] || r.provider)} <span dir="ltr" data-user-text>${esc(r.model)}</span></b>
        <b class="n">${fmt(r.calls)}</b><b class="n">${usd(r.recorded_usd)}</b><b class="n">${usd(r.expected_usd)}</b>
        <span>${r.diff_pct === null ? '' : `<span dir="ltr">${r.diff_pct > 0 ? '+' : ''}${fmt(r.diff_pct, 1)}%</span> `}${!r.in_table ? '<span class="sp-flag">بدون سعر</span> ' : r.verified ? '' : '<span class="sp-flag">سعر غير مثبّت</span> '}${r.estimated ? '<span class="sp-flag">تقديري</span>' : ''}</span></div>`).join('')}`;
  }
  $('#spendMonth').addEventListener('change', e => mountSpend(e.target.value));
  $('#spendBody').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target.closest('[data-tab]'); if (!f) return;
    const b = e.submitter; busy(b, true);
    try { await api('/api/maestro/budgets', { method: 'POST', body: { tab: f.dataset.tab, cap_sar: f.elements.cap.value } }); say($('#spendMsg'), f.elements.cap.value ? 'انحفظ السقف' : 'شلت السقف، بدون حد', true); await mountSpend($('#spendMonth').value); }
    catch (err) { say($('#spendMsg'), err.message); }
    busy(b, false);
  });
  $('#recForm').addEventListener('submit', async e => {
    e.preventDefault();
    const b = e.submitter; busy(b, true); $('#recOut').innerHTML = '';
    try {
      const r = await api('/api/maestro/reconcile', { method: 'POST', body: { provider: $('#recProv').value, month: $('#recMonth').value, invoice_usd: $('#recUsd').value } });
      $('#recOut').innerHTML = `<div class="sp-res">المسجّل عندنا: <b>${fmt(r.recorded_usd, 2)}$</b> · الفاتورة: <b>${fmt(r.invoice_usd, 2)}$</b> · الفرق: <b>${r.diff_pct > 0 ? '+' : ''}${fmt(r.diff_pct, 2)}%</b><br>
        ${r.ok ? 'داخل الحد (5%)، التتبع مطابق للفاتورة' : 'خارج الحد (5%): ما نعتمد التتبع لين نعرف السبب'}<br><span class="muted">${r.notes.map(esc).join(' · ')}</span></div>`;
    } catch (err) { say($('#spendMsg'), err.message); }
    busy(b, false);
  });

  // ---- which provider and model each AI task runs on (owner only, like the spend above)
  const PNAME = { openai: 'OpenAI', xai: 'Grok', openrouter: 'OpenRouter', workers: 'المجاني', anthropic: 'Claude' };   // the free one is Cloudflare's Workers AI
  const FREE = new Set(['workers']);
  // A few sensible OpenRouter ids for the picker; any other id can still be typed
  const OR_PICKS = ['openai/gpt-5-mini', 'google/gemini-2.5-flash', 'anthropic/claude-haiku-5-5', 'meta-llama/llama-3.3-70b-instruct', 'deepseek/deepseek-chat'];
  const NEEDS_MODEL = new Set(['openrouter', 'openai', 'xai']);   // the other providers have one model each
  const MODEL_HINT = { openrouter: 'مثال: openai/gpt-5-mini', openai: 'فاضي = الموديل المعتاد', xai: 'فاضي = الموديل المعتاد' };
  const opt = (v, label, on = true, sel = '') => `<option value="${esc(v)}"${sel === v ? ' selected' : ''}${on ? '' : ' disabled'}>${esc(label)}</option>`;
  // The model id: always left-to-right, one line, cut with … and the whole id in the tooltip
  const idChip = m => m ? `<code class="mr-id" dir="ltr" title="${esc(m)}" data-user-text>${esc(m)}</code>` : '';
  const nowLine = r => {
    if (!r.using) return `<span class="mr-now off"><b>الحالي</b>: <span>غير متصل</span> <span class="muted">· المزوّد مو مفعّل</span></span>`;
    const free = FREE.has(r.using);
    return `<span class="mr-now"><b>الحالي</b>: <span>${esc(PNAME[r.using] || '')}</span> ${idChip(r.model)} <span class="mr-cost${free ? ' free' : ''}">${free ? 'مجاني' : 'مدفوع حسب الاستخدام'}</span> <span class="muted">· ${r.route ? 'اخترته أنت' : 'الافتراضي'}</span></span>`;
  };
  function modelRow(r, d) {
    const p = r.route?.provider || '', m = r.route?.model || '';
    return `<form class="mr-rt" data-task="${esc(r.task)}" data-p="${esc(p)}" data-m="${esc(m)}" novalidate>
      <b class="mr-task">${esc(r.ar)}</b>
      <div class="mr-f"><label class="mr-lbl" for="mp-${esc(r.task)}">المزوّد</label>
        <select id="mp-${esc(r.task)}" name="provider">${opt('', `الافتراضي (${PNAME[r.default] || ''})`, true, p)}${d.providers.map(x => opt(x.key, PNAME[x.key] || x.ar, x.on, p)).join('')}</select></div>
      <div class="mr-f"><label class="mr-lbl" for="mm-${esc(r.task)}">الموديل</label>
        <input id="mm-${esc(r.task)}" type="text" name="model" dir="ltr" autocomplete="off" spellcheck="false" data-user-text value="${esc(m)}"></div>
      <div class="mr-s"><button class="btn sm primary" type="submit" disabled>احفظ</button></div>
      <div class="mr-cur">${nowLine(r)}</div>
      <div class="mr-rmsg" role="status" aria-live="polite"><div class="msg"></div></div></form>`;
  }
  // The model box follows the provider: only providers with a choice of models take one, and only OpenRouter gets the picker
  function syncRow(f) {
    const p = f.elements.provider.value, inp = f.elements.model, need = NEEDS_MODEL.has(p);
    inp.disabled = !need;
    inp.placeholder = need ? t(MODEL_HINT[p]) : t(p === 'workers' ? 'ما يحتاج موديل' : 'ما يتغير');
    if (p === 'openrouter') inp.setAttribute('list', 'mxOr'); else inp.removeAttribute('list');
    if (!need) inp.value = '';
    inp.removeAttribute('aria-invalid');
    const same = p === f.dataset.p && (need ? inp.value.trim() : '') === (need ? f.dataset.m : '');
    f.querySelector('button[type=submit]').disabled = same;
  }
  async function mountModels(done) {
    let d;
    try { d = await api('/api/maestro/models'); }
    catch (err) { if (/الجدول ناقص/.test(err.message)) { $('#models').hidden = false; $('#modelsBody').innerHTML = `<p class="muted">${esc(err.message)}</p>`; } return; }
    $('#models').hidden = false;
    $('#modelsProv').innerHTML = d.providers.map(p => `<span class="sp-flag${p.on ? '' : ' bad'}"><span>${esc(PNAME[p.key] || p.ar)}</span> <span>${p.on ? 'مفعّل' : 'غير مفعّل'}</span></span>`).join('');
    $('#modelsBody').innerHTML = `<datalist id="mxOr">${OR_PICKS.map(x => `<option value="${esc(x)}"></option>`).join('')}</datalist>
      <div class="mr-hd" aria-hidden="true"><span>المهمة</span><span>المزوّد</span><span>الموديل</span><span></span></div>` + d.tasks.map(x => modelRow(x, d)).join('');
    $$('#modelsBody form').forEach(f => { syncRow(f); if (done && done.task === f.dataset.task) say(f.querySelector('.mr-rmsg .msg'), done.text, true); });
  }
  $('#modelsBody').addEventListener('input', e => { const f = e.target.closest('form'); if (f) { say(f.querySelector('.mr-rmsg .msg'), ''); syncRow(f); } });
  $('#modelsBody').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target.closest('[data-task]'); if (!f) return;
    const msg = f.querySelector('.mr-rmsg .msg'), p = f.elements.provider.value, m = f.elements.model.value.trim();
    if (p === 'openrouter' && !m) { f.elements.model.setAttribute('aria-invalid', 'true'); f.elements.model.focus(); say(msg, 'اكتب معرّف الموديل أو اختره من القائمة'); return; }
    const b = e.submitter || f.querySelector('button[type=submit]'); busy(b, true);
    try {
      await api('/api/maestro/models', { method: 'POST', body: { task: f.dataset.task, provider: p, model: m } });
      await mountModels({ task: f.dataset.task, text: p ? 'انحفظ الاختيار' : 'رجعت المهمة للافتراضي' });
    } catch (err) { say(msg, err.message); busy(b, false); }
  });

  shell({ active: 'maestro', title: 'المدير', tools: '' }).then(me => { if (me.role === 'owner') { $('#healthLink')?.removeAttribute('hidden'); $('#auditLink')?.removeAttribute('hidden'); mountModels(); } mountSpend(); return load(); }).catch(pageFailure);
}
