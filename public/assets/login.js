// A new sign-in starts with fresh sidebar info (nav.js keeps it 5 minutes per tab)
try { sessionStorage.removeItem('well-me'); } catch { /* storage blocked */ }
import { $, api, say, busy } from './common.js';
import { langSwitch } from './i18n.js';
document.getElementById('lang').innerHTML = langSwitch();

const next = new URLSearchParams(location.search).get('next') || '';
$('#f').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.submitter; busy(btn, true); say($('#msg'), '');
  try {
    const r = await api('/api/auth/login', { method: 'POST', body: { email: $('#email').value, password: $('#password').value, next } });
    location.href = r.next || '/';
  } catch (err) { say($('#msg'), err.message); busy(btn, false); }
});
$('#forgot').addEventListener('click', async () => {
  const email = $('#email').value.trim();
  if (!email) { say($('#msg'), 'اكتب إيميلك فوق أول'); $('#email').focus(); return; }
  // ضغطة وحدة بس: كل إيميل جديد يلغي رابط اللي قبله
  const b = $('#forgot'); b.disabled = true;
  try {
    await api('/api/auth/forgot', { method: 'POST', body: { email } });
    say($('#msg'), 'انرسل الرابط. افتح آخر إيميل يوصلك بس، ولو ما لقيته شيّك على الـSpam.', true);
    setTimeout(() => { b.disabled = false; }, 60000);
  } catch (err) { say($('#msg'), err.message); b.disabled = false; }
});
