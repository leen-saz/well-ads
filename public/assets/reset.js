import { $, api, say } from './common.js';
import { langSwitch } from './i18n.js';
document.getElementById('lang').innerHTML = langSwitch();

// رابط الإيميل يحط التوكن بعد # في العنوان، ونشيله من العنوان فوراً
const h = new URLSearchParams(location.hash.slice(1));
const token = h.get('access_token');
history.replaceState(null, '', location.pathname);
// بدون توكن: الرابط قديم (انرسل بعده إيميل أحدث) أو انستخدم. نقفل النموذج ونوضح وش تسوي.
if (!token) {
  const expired = h.get('error_code') === 'otp_expired' || /expired|invalid/i.test(h.get('error_description') || '');
  $('#f').querySelectorAll('input,button').forEach(x => { x.disabled = true; });
  $('#msg').className = 'msg err';
  $('#msg').innerHTML = `<span>${expired ? 'هذا الرابط انتهى.' : 'هذي الصفحة تنفتح من رابط الإيميل بس.'}</span> <span>إذا وصلك أكثر من إيميل، افتح آخر واحد بس.</span> <a href="/login/">اطلب رابط جديد</a>`;
}
$('#f').addEventListener('submit', async e => {
  e.preventDefault();
  if ($('#p1').value !== $('#p2').value) { say($('#msg'), 'الباسووردين مو نفس بعض'); return; }
  const btn = e.submitter; btn.disabled = true;
  try {
    await api('/api/auth/reset', { method: 'POST', body: { access_token: token, password: $('#p1').value } });
    say($('#msg'), 'انحفظ. ادخل الحين بالباسوورد الجديد.', true);
    setTimeout(() => { location.href = '/login/'; }, 1500);
  } catch (err) { say($('#msg'), err.message); btn.disabled = false; }
});
