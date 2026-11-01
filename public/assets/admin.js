import { $, $$, api, say, esc, shell, when, busy, settingsTabs, pageSignal } from './common.js';

// Runs on every visit of this page (assets/router.js calls it after each ClientRouter navigation).
export default async function mount() {

  let DASH = {}, DEPT = {}, USERS = {};
  const ACT = { login: 'دخول', login_failed: 'دخول فاشل', login_blocked: 'دخول مرفوض (حساب موقوف)', password_changed: 'غيّر الباسوورد', password_set: 'حدد باسوورد جديد',
    password_reset_requested: 'طلب استعادة الباسوورد', user_invited: 'أضاف مستخدم', user_updated: 'عدّل صلاحيات مستخدم', mode_changed: 'غيّر الوضع',
    suggestion_approved: 'وافق على اقتراح', suggestion_rejected: 'رفض اقتراح', suggestion_modified: 'وافق بتعديل',
    kill_on: 'شغّل الطوارئ', kill_off: 'أوقف الطوارئ', critic_run: 'المراجع راجع الاقتراحات' };
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
    $('#users').innerHTML = `<table><thead><tr><th>الاسم</th><th>الإيميل</th><th>الصلاحيات</th><th>الأقسام المسموحة</th><th>الحالة</th><th></th></tr></thead><tbody>${r.users.map(u => `
      <tr data-id="${u.id}" style="cursor:default"><td>${esc(u.name || '')}${u.role === 'owner' ? ' <span class="chip solid">المالكة</span>' : ''}</td><td>${esc(u.email)}</td>
      <td>${u.role === 'owner' ? 'كل التابات · موافقة' : summary(u.access || {})}</td>
      <td>${u.role === 'owner' ? 'كل الأقسام' : `<div class="checks">${checks('q' + u.id, u.departments || [], DEPT)}</div>`}</td>
      <td>${u.active ? '<span class="chip">مفعّل</span>' : '<span class="chip line">موقوف</span>'}</td>
      <td>${u.role === 'owner' ? '' : `<div class="acts"><button class="btn sm secondary" data-act="edit">عدّل الصلاحيات</button><button class="btn sm ghost" data-act="toggle" data-active="${u.active}">${u.active ? 'أوقف' : 'فعّل'}</button></div>`}</td></tr>`).join('')}</tbody></table>`;
  }
  async function loadLog() {
    const r = await api('/api/admin/log');
    $('#log').innerHTML = r.log.length ? `<table><thead><tr><th>الوقت</th><th>مين</th><th>الفعل</th><th>على</th><th>ملاحظة</th></tr></thead><tbody>${r.log.map(x => `
      <tr style="cursor:default"><td class="num">${esc(when(x.at))}</td><td>${esc(x.email || '')}</td><td>${esc(ACT[x.action] || x.action)}</td><td>${esc(x.target ? (x.target.target_name || x.target.email || x.target.platform || '') : '')}</td><td>${esc(x.note || '')}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">ما فيه أفعال لين الحين</div>';
  }
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
    const body = b.dataset.act === 'save' ? { id, access: readGrid('u' + id, b.closest('tr')), departments: $$(`input[name="q${id}"]:checked`, tr).map(x => x.value) } : { id, active: b.dataset.active !== 'true' };
    busy(b, true);
    try { await api('/api/admin/users', { method: 'PATCH', body }); say($('#usersMsg'), 'انحفظ.', true); await loadUsers(); await loadLog(); }
    catch (err) { say($('#usersMsg'), err.message); busy(b, false); }
  });
  shell({ active: 'settings', title: 'الإعدادات' }).then(me => settingsTabs('admin', me)).then(loadUsers).then(loadLog).catch(err => say($('#usersMsg'), err.message));
}
