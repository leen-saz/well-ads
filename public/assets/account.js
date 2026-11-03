import { $, api, say, esc, shell, busy, settingsTabs, freshMe } from './common.js';

// Runs on every visit of this page (assets/router.js calls it after each ClientRouter navigation).
export default async function mount() {

  // The sidebar's stored copy has no email: the line under the title takes it from the server
  shell({ active: 'settings', title: 'الإعدادات' }).then(me => { settingsTabs('account', me); return freshMe(); }).then(me => { $('#who').textContent = `${me.name ? me.name + ' · ' : ''}${me.email}`; }).catch(() => {});
  $('#f').addEventListener('submit', async e => {
    e.preventDefault();
    if ($('#p1').value !== $('#p2').value) { say($('#msg'), 'الباسووردين مو نفس بعض'); return; }
    const btn = e.submitter; busy(btn, true);
    try {
      await api('/api/account/password', { method: 'POST', body: { current: $('#cur').value, password: $('#p1').value } });
      say($('#msg'), 'تغيّر الباسوورد.', true); e.target.reset();
    } catch (err) { say($('#msg'), err.message); }
    busy(btn, false);
  });
}
