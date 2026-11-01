import { $, $$, api, say, esc, shell, when, busy, settingsTabs } from './common.js';

// Runs on every visit of this page (assets/router.js calls it after each ClientRouter navigation).
export default async function mount() {

  let DASH = {}, DEPT = {};
  const ACT = { login: 'دخول', login_failed: 'دخول فاشل', login_blocked: 'دخول مرفوض (حساب موقوف)', password_changed: 'غيّر الباسوورد', password_set: 'حدد باسوورد جديد',
    password_reset_requested: 'طلب استعادة الباسوورد', user_invited: 'أضاف مستخدم', user_updated: 'عدّل صلاحيات مستخدم', mode_changed: 'غيّر الوضع',
    suggestion_approved: 'وافق على اقتراح', suggestion_rejected: 'رفض اقتراح', suggestion_modified: 'وافق بتعديل',
    kill_on: 'شغّل الطوارئ', kill_off: 'أوقف الطوارئ', critic_run: 'المراجع راجع الاقتراحات' };
  const checks = (name, on = [], map = DASH) => Object.entries(map).map(([k, t]) => `<label><input type="checkbox" name="${name}" value="${k}" ${on.includes(k) ? 'checked' : ''}> ${t}</label>`).join('');

  async function loadUsers() {
    const r = await api('/api/admin/users');
    DASH = r.dashboards; DEPT = r.departments || {};
    if (!$('#dashChecks').innerHTML) $('#dashChecks').innerHTML = checks('d');
    if (!$('#deptChecks').innerHTML) $('#deptChecks').innerHTML = checks('p', [], DEPT);
    $('#users').innerHTML = `<table><thead><tr><th>الاسم</th><th>الإيميل</th><th>اللوحات المسموحة</th><th>الأقسام المسموحة</th><th>الحالة</th><th></th></tr></thead><tbody>${r.users.map(u => `
      <tr data-id="${u.id}" style="cursor:default"><td>${esc(u.name || '')}${u.role === 'owner' ? ' <span class="chip solid">المالكة</span>' : ''}</td><td>${esc(u.email)}</td>
      <td>${u.role === 'owner' ? 'كل اللوحات' : `<div class="checks">${checks('u' + u.id, u.dashboards)}</div>`}</td>
      <td>${u.role === 'owner' ? 'كل الأقسام' : `<div class="checks">${checks('q' + u.id, u.departments || [], DEPT)}</div>`}</td>
      <td>${u.active ? '<span class="chip">مفعّل</span>' : '<span class="chip line">موقوف</span>'}</td>
      <td>${u.role === 'owner' ? '' : `<div class="acts"><button class="btn sm secondary" data-act="save">احفظ الصلاحيات</button><button class="btn sm ghost" data-act="toggle" data-active="${u.active}">${u.active ? 'أوقف' : 'فعّل'}</button></div>`}</td></tr>`).join('')}</tbody></table>`;
  }
  async function loadLog() {
    const r = await api('/api/admin/log');
    $('#log').innerHTML = r.log.length ? `<table><thead><tr><th>الوقت</th><th>مين</th><th>الفعل</th><th>على</th><th>ملاحظة</th></tr></thead><tbody>${r.log.map(x => `
      <tr style="cursor:default"><td class="num">${esc(when(x.at))}</td><td>${esc(x.email || '')}</td><td>${esc(ACT[x.action] || x.action)}</td><td>${esc(x.target ? (x.target.target_name || x.target.email || x.target.platform || '') : '')}</td><td>${esc(x.note || '')}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">ما فيه أفعال لين الحين</div>';
  }
  $('#add').addEventListener('submit', async e => {
    e.preventDefault();
    const dashboards = $$('input[name=d]:checked').map(x => x.value);
    const departments = $$('input[name=p]:checked').map(x => x.value);
    const btn = e.submitter; busy(btn, true);
    try {
      await api('/api/admin/users', { method: 'POST', body: { email: $('#email').value, name: $('#name').value, dashboards, departments } });
      say($('#addMsg'), 'انرسلت الدعوة.', true); e.target.reset(); await loadUsers(); await loadLog();
    } catch (err) { say($('#addMsg'), err.message); }
    busy(btn, false);
  });
  $('#users').addEventListener('click', async e => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const tr = b.closest('tr'), id = tr.dataset.id;
    const body = b.dataset.act === 'save' ? { id, dashboards: $$(`input[name="u${id}"]:checked`, tr).map(x => x.value), departments: $$(`input[name="q${id}"]:checked`, tr).map(x => x.value) } : { id, active: b.dataset.active !== 'true' };
    busy(b, true);
    try { await api('/api/admin/users', { method: 'PATCH', body }); say($('#usersMsg'), 'انحفظ.', true); await loadUsers(); await loadLog(); }
    catch (err) { say($('#usersMsg'), err.message); busy(b, false); }
  });
  shell({ active: 'settings', title: 'الإعدادات' }).then(me => settingsTabs('admin', me)).then(loadUsers).then(loadLog).catch(err => say($('#usersMsg'), err.message));
}
