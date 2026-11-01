// الإعدادات ← الموديولات: المالكة تقفل أو تشغّل موديولات شركتها.
import { $, $$, api, say, esc, shell, busy, settingsTabs, LANG } from './common.js';

// Runs on every visit of this page (assets/router.js calls it after each ClientRouter navigation).
export default async function mount() {
  const L = (ar, en) => (LANG === 'en' ? en : ar);
  const me = await shell({ active: 'settings', title: L('الإعدادات', 'Settings') });
  settingsTabs('modules', me);
  const r = await api('/api/admin/modules');
  $('#mods').innerHTML = r.modules.map(m => `<label class="mm"><svg class="i" viewBox="0 0 24 24" aria-hidden="true">${m.icon}</svg><b>${esc(L(m.ar, m.en))}</b>
    ${m.status === 'soon' ? `<span class="chip">${L('قريباً', 'Soon')}</span>` : ''}<span class="muted">${L('مفعّل', 'On')}</span>
    <input type="checkbox" name="mod" value="${esc(m.key)}"${m.on ? ' checked' : ''}></label>`).join('');
  $('#save').onclick = async e => {
    busy(e.target, true);
    try {
      await api('/api/admin/modules', { method: 'PATCH', body: { off: $$('input[name="mod"]').filter(x => !x.checked).map(x => x.value) } });
      try { sessionStorage.removeItem('well-me-2'); } catch { /* storage blocked */ }
      say($('#msg'), L('انحفظ. القائمة تتحدث خلال دقايق.', 'Saved. The sidebar updates within minutes.'), true);
    } catch (err) { say($('#msg'), err.message); }
    busy(e.target, false);
  };
}
