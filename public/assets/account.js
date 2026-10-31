import { $, api, say, esc, shell, busy } from './common.js';

shell({ active: 'account', title: 'حسابي' }).then(me => { $('#who').textContent = `${me.name ? me.name + ' · ' : ''}${me.email}`; }).catch(() => {});
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
