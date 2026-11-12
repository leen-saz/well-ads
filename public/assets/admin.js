import { $, $$, api, say, esc, shell, when, busy, settingsTabs, pageSignal } from './common.js';
import { mountPeriod } from './period.js';

// Runs on every visit of this page (assets/router.js calls it after each ClientRouter navigation).
export default async function mount() {

  let DASH = {}, DEPT = {}, USERS = {};
  const ACT = { login: 'دخول', login_failed: 'دخول فاشل', login_blocked: 'دخول مرفوض (حساب موقوف)', password_changed: 'غيّر الباسوورد', password_set: 'حدد باسوورد جديد',
    password_reset_requested: 'طلب استعادة الباسوورد', user_invited: 'أضاف مستخدم', user_added_direct: 'أضاف مستخدم مباشرة', user_profile_created: 'أعطى حساب موجود ملف وصلاحيات', user_password_set: 'حدد باسوورد لمستخدم', user_updated: 'عدّل صلاحيات مستخدم', mode_changed: 'غيّر الوضع',
    suggestion_approved: 'وافق على اقتراح', suggestion_rejected: 'رفض اقتراح', suggestion_modified: 'وافق بتعديل',
    kill_on: 'شغّل الطوارئ', kill_off: 'أوقف الطوارئ', critic_run: 'المراجع راجع الاقتراحات',
    modules_changed: 'غيّر الموديولات', content_plan: 'حلّل الموقع (المحتوى)', content_approve: 'وافق على بند محتوى', content_reject: 'رفض بند محتوى', content_done: 'نشر بند محتوى', content_draft: 'كتب مسودة محتوى',
    social_scheduled: 'جدول منشور', social_approved: 'وافق على منشور', social_cancelled: 'ألغى منشور', journey_saved: 'حفظ رحلة', journey_started: 'شغّل رحلة لعميل',
    maestro_connected: 'ربط المدير', maestro_task: 'كلّف المدير بمهمة', maestro_approve: 'وافق في المدير', maestro_reject: 'رفض في المدير',
    connector_saved: 'ربط منصة', connector_removed: 'فك ربط منصة', suggestion_revert: 'تراجع عن تنفيذ', campaign_requested: 'طلب حملة جديدة', canary_changed: 'غيّر حملات التجربة' };
  let LEVELS = ['view', 'edit', 'approve'];
  const LV = { '': 'بدون', view: 'مشاهدة', edit: 'تعديل', approve: 'موافقة' };
  // Presets: one click fills every tab, then each tab can still be changed alone
  const PRESETS = [['view', 'مشاهد'], ['edit', 'محرر'], ['approve', 'مدير'], ['', 'امسح']];
  const grid = (name, acc = {}) => Object.entries(DASH).map(([k, t]) => `<label class="acc-row"><span>${esc(t)}</span><select name="${name}" data-k="${k}">${['', ...LEVELS].map(l => `<option value="${l}"${(acc[k] || '') === l ? ' selected' : ''}>${LV[l]}</option>`).join('')}</select></label>`).join('');
  const readGrid = (name, root = document) => Object.fromEntries($$(`select[name="${name}"]`, root).filter(x => x.value).map(x => [x.dataset.k, x.value]));
  const presets = name => PRESETS.map(([l, t]) => `<button type="button" class="btn sm ghost" data-preset="${l}" data-for="${name}">${t}</button>`).join('');
  const summary = acc => Object.keys(acc).length ? `<div class="acc-sum">${Object.entries(acc).map(([k, l]) => `<span class="chip${l === 'approve' ? ' solid' : l === 'view' ? ' line' : ''}">${esc(DASH[k] || k)} · ${LV[l]}</span>`).join('')}</div>` : '<span class="muted">بدون</span>';
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-preset]'); if (!b) return;
    $$(`select[name="${b.dataset.for}"]`, b.closest('form, tr') || document).forEach(x => { x.value = b.dataset.preset; });
  }, { signal: pageSignal() });
  const checks = (name, on = [], map = DASH) => Object.entries(map).map(([k, t]) => `<label><input type="checkbox" name="${name}" value="${k}" ${on.includes(k) ? 'checked' : ''}> ${t}</label>`).join('');

  async function loadUsers() {
    const r = await api('/api/admin/users');
    USERS = Object.fromEntries(r.users.map(u => [u.id, u]));
    DASH = r.dashboards; DEPT = r.departments || {}; LEVELS = r.levels || LEVELS;
    if (!$('#dashChecks').innerHTML) { $('#dashChecks').innerHTML = grid('d'); $('#presets').innerHTML = presets('d'); }
    if (!$('#deptChecks').innerHTML) $('#deptChecks').innerHTML = checks('p', [], DEPT);
    if (!$('#dDashChecks').innerHTML) { $('#dDashChecks').innerHTML = grid('dd'); $('#dPresets').innerHTML = presets('dd'); $('#dDeptChecks').innerHTML = checks('dp', [], DEPT); }
    $('#users').innerHTML = `<table><thead><tr><th>الاسم</th><th>الإيميل</th><th>الصلاحيات</th><th>الأقسام المسموحة</th><th>الحالة</th><th></th></tr></thead><tbody>${r.users.map(u => `
      <tr data-id="${u.id}" style="cursor:default"><td>${esc(u.name || '')}${u.role === 'owner' ? ' <span class="chip solid">المالكة</span>' : ''}</td><td>${esc(u.email)}</td>
      <td>${u.role === 'owner' ? 'كل التابات · موافقة' : summary(u.access || {})}</td>
      <td>${u.role === 'owner' ? 'كل الأقسام' : `<div class="checks">${checks('q' + u.id, u.departments || [], DEPT)}</div>`}</td>
      <td>${u.active ? '<span class="chip">مفعّل</span>' : '<span class="chip line">موقوف</span>'}</td>
      <td>${u.role === 'owner' ? '' : `<div class="acts"><button class="btn sm secondary" data-act="edit">عدّل الصلاحيات</button><button class="btn sm ghost" data-act="toggle" data-active="${u.active}">${u.active ? 'أوقف' : 'فعّل'}</button><button class="btn sm ghost" data-act="pw">عيّن باسوورد جديد</button></div>`}</td></tr>`).join('')}</tbody></table>`;
    await loadOrphans();
  }
  const ALPHA = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  // A strong password made in this browser only; it is never stored, and it stays on screen only until it is sent
  const strong = () => [...crypto.getRandomValues(new Uint32Array(16))].map(x => ALPHA[x % ALPHA.length]).join('');
  // Accounts with no profile: given a profile and levels here, so no SQL is ever needed
  async function loadOrphans() {
    let r;
    try { r = await api('/api/admin/orphans'); } catch (err) { say($('#orphanMsg'), err.message); return; }
    $('#orphanCard').hidden = !r.accounts.length;
    $('#orphans').innerHTML = r.accounts.length ? `<table><thead><tr><th>الإيميل</th><th>الاسم</th><th></th></tr></thead><tbody>${r.accounts.map(a => `
      <tr data-oid="${a.id}" style="cursor:default"><td>${esc(a.email)}</td><td>${esc(a.name || '')}</td><td><button class="btn sm secondary" data-oact="open" data-id="${a.id}">أعطه صلاحيات</button></td></tr>`).join('')}</tbody></table>` : '';
  }
  $('#orphans').addEventListener('click', async e => {
    const b = e.target.closest('button[data-oact]'); if (!b) return;
    const id = b.dataset.id, tr = $(`tr[data-oid="${id}"]`, $('#orphans'));
    if (b.dataset.oact === 'open') {
      $$('.acc-edit', $('#orphans')).forEach(x => x.remove());
      tr.insertAdjacentHTML('afterend', `<tr class="acc-edit" style="cursor:default"><td colspan="3"><div class="acc-presets">${presets('o' + id)}</div><div class="acc">${grid('o' + id, {})}</div>
        <label>الأقسام المسموحة <span class="muted">(بدون تحديد = كل الأقسام)</span></label><div class="checks">${checks('od' + id, [], DEPT)}</div>
        <div class="bar" style="margin-top:10px"><button class="btn sm primary" data-oact="save" data-id="${id}">احفظ</button></div></td></tr>`);
      return;
    }
    busy(b, true);
    try {
      await api('/api/admin/orphans', { method: 'POST', body: { id, access: readGrid('o' + id, b.closest('tr')), departments: $$(`input[name="od${id}"]:checked`, b.closest('tr')).map(x => x.value) } });
      say($('#orphanMsg'), 'انضاف للقائمة.', true); await loadUsers(); await loadLog();
    } catch (err) { say($('#orphanMsg'), err.message); busy(b, false); }
  });
  $('#dGen').addEventListener('click', () => { $('#dPass').value = strong(); $('#dPassNote').textContent = 'انسخه الحين وسلّمه له. ما ينعرض مرة ثانية.'; });
  $('#addDirect').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.submitter; busy(btn, true);
    try {
      await api('/api/admin/direct', { method: 'POST', body: { email: $('#dEmail').value, name: $('#dName').value, password: $('#dPass').value, access: readGrid('dd', e.target), departments: $$('input[name=dp]:checked', e.target).map(x => x.value) } });
      say($('#dMsg'), 'انضاف المستخدم. سلّمه الباسوورد المؤقت.', true); e.target.reset(); $('#dPassNote').textContent = ''; await loadUsers(); await loadLog();
    } catch (err) { say($('#dMsg'), err.message); }
    busy(btn, false);
  });
  // Dates go to the server (whole Riyadh days, up to 500 rows); the search box filters what came back, so it also
  // matches the Arabic action names shown in the table
  let LOG = [], logRange = null, logReady = false;
  async function loadLog() {
    // «كل الفترة» = no dates: the latest 200 actions
    const dated = logRange && logRange.key !== 'all', from = dated ? logRange.from : '', to = dated ? logRange.to : '';
    const qs = new URLSearchParams({ limit: from || to ? '500' : '200', ...(from ? { from } : {}), ...(to ? { to } : {}) });
    LOG = (await api('/api/admin/log?' + qs)).log;
    showLog();
  }
  function showLog() {
    const q = $('#logQ').value.trim().toLowerCase();
    // The log keeps emails only: the person's name (from the users list) is searchable too
    const nameOf = Object.fromEntries(Object.values(USERS).map(u => [String(u.email || '').toLowerCase(), u.name || '']));
    const r = { log: q ? LOG.filter(x => [x.email, nameOf[String(x.email || '').toLowerCase()], x.action, ACT[x.action], JSON.stringify(x.target || {}), x.note].join(' ').toLowerCase().includes(q)) : LOG };
    $('#logN').textContent = `${r.log.length} فعل`;
    $('#log').innerHTML = r.log.length ? `<table><thead><tr><th>الوقت</th><th>مين</th><th>الفعل</th><th>على</th><th>ملاحظة</th></tr></thead><tbody>${r.log.map(x => `
      <tr style="cursor:default"><td class="num">${esc(when(x.at))}</td><td>${esc(x.email || '')}</td><td>${esc(ACT[x.action] || x.action)}</td><td>${esc(x.target ? (x.target.target_name || x.target.email || x.target.platform || '') : '')}</td><td>${esc(x.note || '')}</td></tr>`).join('')}</tbody></table>` : `<div class="empty">${LOG.length ? 'ما فيه نتائج لهالبحث' : logRange && logRange.key !== 'all' ? 'ما فيه أفعال في هالفترة' : 'ما فيه أفعال لين الحين'}</div>`;
  }
  // The same period bar as the other pages (saved in this browser); a change reloads the log
  mountPeriod($('#logPeriod'), { id: 'admin-log', def: 'all', url: false, onChange: r => { logRange = r; if (logReady) loadLog().catch(err => say($('#usersMsg'), err.message)); } });
  $('#logQ').addEventListener('input', showLog);
  $('#add').addEventListener('submit', async e => {
    e.preventDefault();
    const access = readGrid('d', e.target);
    const departments = $$('input[name=p]:checked').map(x => x.value);
    const btn = e.submitter; busy(btn, true);
    try {
      await api('/api/admin/users', { method: 'POST', body: { email: $('#email').value, name: $('#name').value, access, departments } });
      say($('#addMsg'), 'انرسلت الدعوة.', true); e.target.reset(); await loadUsers(); await loadLog();
    } catch (err) { say($('#addMsg'), err.message); }
    busy(btn, false);
  });
  $('#users').addEventListener('click', async e => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const id = b.dataset.id || b.closest('tr[data-id]')?.dataset.id, tr = $(`tr[data-id="${id}"]`, $('#users'));
    if (!tr) return;
    if (b.dataset.act === 'edit') {
      // Inline editor under the user's row: a level per tab, with presets
      $$('.acc-edit', $('#users')).forEach(x => x.remove());
      tr.insertAdjacentHTML('afterend', `<tr class="acc-edit" style="cursor:default"><td colspan="6"><div class="acc-presets">${presets('u' + id)}</div><div class="acc">${grid('u' + id, USERS[id]?.access)}</div>
        <div class="bar" style="margin-top:10px"><button class="btn sm primary" data-act="save" data-id="${id}">احفظ</button></div></td></tr>`);
      return;
    }
    if (b.dataset.act === 'pw') {
      $$('.acc-edit', $('#users')).forEach(x => x.remove());
      tr.insertAdjacentHTML('afterend', `<tr class="acc-edit" style="cursor:default"><td colspan="6"><div class="bar" style="align-items:flex-end"><div style="flex:1;min-width:220px"><label>باسوورد جديد</label><input type="text" name="npw" autocomplete="off" spellcheck="false" dir="ltr"></div>
        <button class="btn sm secondary" data-act="gen">ولّد باسوورد قوي</button><button class="btn sm primary" data-act="pwsave" data-id="${id}">احفظ الباسوورد</button></div></td></tr>`);
      return;
    }
    if (b.dataset.act === 'gen') { $('input[name=npw]', b.closest('tr')).value = strong(); say($('#usersMsg'), 'انسخه الحين وسلّمه له. ما ينعرض مرة ثانية.', true); return; }
    if (b.dataset.act === 'pwsave') {
      busy(b, true);
      try { await api('/api/admin/password', { method: 'POST', body: { id, password: $('input[name=npw]', b.closest('tr')).value } }); say($('#usersMsg'), 'تغيّر الباسوورد.', true); await loadUsers(); await loadLog(); }
      catch (err) { say($('#usersMsg'), err.message); busy(b, false); }
      return;
    }
    const body = b.dataset.act === 'save' ? { id, access: readGrid('u' + id, b.closest('tr')), departments: $$(`input[name="q${id}"]:checked`, tr).map(x => x.value) } : { id, active: b.dataset.active !== 'true' };
    busy(b, true);
    try { await api('/api/admin/users', { method: 'PATCH', body }); say($('#usersMsg'), 'انحفظ.', true); await loadUsers(); await loadLog(); }
    catch (err) { say($('#usersMsg'), err.message); busy(b, false); }
  });
  shell({ active: 'settings', title: 'الإعدادات' }).then(me => settingsTabs('admin', me)).then(loadUsers).then(loadLog).then(() => { logReady = true; }).catch(err => say($('#usersMsg'), err.message));
}
