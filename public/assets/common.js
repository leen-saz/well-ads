// أدوات مشتركة: الطلبات، والأيقونات، والتواريخ، وهيكل التطبيق (القائمة الجانبية والشريط العلوي)
import { LANG, t, langSwitch, restoreDraft } from './i18n.js';
import { sections, TIP } from './sidebar.js';
export { LANG, t, langSwitch };
// Pages switch with Astro's ClientRouter: listeners on document/window of one page are removed when it leaves
let PAGE = new AbortController();
document.addEventListener('astro:before-swap', () => { PAGE.abort(); PAGE = new AbortController(); });
export const pageSignal = () => PAGE.signal;
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  let data = {};
  try { data = await res.json(); } catch {}
  if (res.status === 401 && !path.startsWith('/api/auth/')) { location.href = '/login/?next=' + encodeURIComponent(location.pathname + location.search); throw new Error(data.error || 'سجّل الدخول'); }
  if (!res.ok) throw new Error(data.error || 'صار خطأ');
  return data;
}

// Lucide (خط 1.75)
const P = {
  plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  gavel: '<path d="m14 13-7.5 7.5a2.1 2.1 0 0 1-3-3L11 10"/><path d="m16 16 6-6"/><path d="m8 8 6-6"/><path d="m9 7 8 8"/><path d="m21 11-8-8"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  route: '<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
  pen: '<path d="M12 20h9"/><path d="M16.4 3.6a2 2 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  star: '<path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2Z"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  panel: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  pen: '<path d="M12 20h9"/><path d="M16.4 3.6a2 2 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>',
  gear: '<path d="M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.5a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.5a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2Z"/><circle cx="12" cy="12" r="3"/>',
  ext: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1Z"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M8 16H3v5"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
};
export const icon = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[n] || ''}</svg>`;

// التواريخ بالعربي وأرقام لاتينية والتقويم الميلادي، بتوقيت الرياض
const LOC = LANG === 'en' ? 'en-GB' : 'ar-SA-u-nu-latn-ca-gregory';
const DT = new Intl.DateTimeFormat(LOC, { timeZone: 'Asia/Riyadh', day: 'numeric', month: LANG === 'en' ? 'short' : 'long', hour: '2-digit', minute: '2-digit', hour12: false });
const DD = new Intl.DateTimeFormat(LOC, { timeZone: 'Asia/Riyadh', day: 'numeric', month: LANG === 'en' ? 'short' : 'long' });
export const when = iso => iso ? DT.format(new Date(iso)).replace(' في ', '، ') : '—';
export const day = iso => iso ? DD.format(new Date(iso)) : '—';
export const fmt = (n, d = 0) => n == null || !isFinite(n) ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
export const sar = n => n == null || !isFinite(n) ? '—' : fmt(n, Math.abs(n) < 100 ? 2 : 0);

export function say(el, text, ok = false) {
  el.className = 'msg ' + (text ? (ok ? 'ok' : 'err') : '');
  el.innerHTML = text ? (ok ? icon('check') : icon('alert')) + `<span>${esc(text)}</span>` : '';
}
export function toast(text) {
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status');
  t.innerHTML = icon('check') + `<span>${esc(text)}</span>`; document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
export function busy(btn, on) { if (!btn) return; btn.classList.toggle('loading', on); btn.disabled = on; }

// The user's name and dashboards. Shared with nav.js (same key) so a full page load draws the sidebar at once
// from this tab's last copy; a copy older than 5 minutes is refreshed in the background.
const ME_KEY = 'well-me-2', FRESH = 5 * 60 * 1000;
let ME = null;
try { ME = JSON.parse(sessionStorage.getItem(ME_KEY) || 'null'); } catch { /* storage blocked */ }
const fetchMe = () => api('/api/account/password').then(v => {
  ME = { t: Date.now(), v };
  try { sessionStorage.setItem(ME_KEY, JSON.stringify(ME)); } catch { /* storage blocked */ }
  return v;
});
// The dashboards (/ and /?view=…) are pipeline-built pages outside Astro: open them with a full load
const FULL = h => (h === '/' || h.startsWith('/?')) ? ' data-astro-reload' : '';

// The sidebar persists across tab changes (transition:persist): draw it only when the user or language changed,
// otherwise just move the highlight, so a click does not rebuild it.
function drawSide(side, me, active) {
  const L = (ar, en) => (LANG === 'en' ? en : ar);
  const sig = LANG + JSON.stringify(me);
  if (side.dataset.sig === sig) {
    side.querySelectorAll('[data-k]').forEach(a => a.dataset.k === active ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
    return;
  }
  side.dataset.sig = sig;
  const initials = (me.name || me.email).trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  // كل الأقسام تطلع للكل: اللي ما له صلاحية عليه أو مقفل لشركته يطلع بقفل
  // Quick create (shadcn dashboard-01 'Quick Create'): only what this user can open
  const NEW = [['control', '/control/new/', 'قرار جديد', 'gavel'], ['social', '/social/', 'منشور جديد', 'calendar'], ['design', '/design/', 'تصميم جديد', 'image'], ['copy', '/copy/', 'نص إعلان جديد', 'pen']];
  const can = new Set(sections(me, L).flatMap(sec => sec.items).filter(it => it.state === 'ok').map(it => it.key));
  const quick = NEW.filter(([k]) => can.has(k));
  side.innerHTML = `<div class="side-top"><a class="brand mark" href="/" data-astro-reload aria-label="Well">Well<i>.</i></a>
    <button type="button" class="btn icon ghost side-fold" id="sideFold" aria-label="${L('طي القائمة', 'Collapse menu')}" aria-pressed="false">${icon('panel')}</button></div>
    ${quick.length ? `<div class="qc"><button type="button" class="btn primary qc-btn" id="qcBtn" aria-haspopup="menu" aria-expanded="false">${icon('plus')}<span>${L('جديد', 'New')}</span></button>
      <div class="menu qc-menu" id="qcMenu" role="menu" hidden>${quick.map(([, href, t, ic]) => `<a href="${href}" role="menuitem">${icon(ic)}${t}</a>`).join('')}</div></div>` : ''}
    ${sections(me, L).map(sec => `<div class="side-sec"><small class="side-h">${esc(sec.label)}</small>${sec.items.map(it => {
      const ic = it.svg ? `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${it.svg}</svg>` : icon(it.ic);
      if (it.state === 'ok' || it.state === 'soon') return `<a class="navi${it.state === 'soon' ? ' soon' : ''}" href="${it.href}" data-k="${esc(it.key)}"${FULL(it.href)}${it.key === active ? ' aria-current="page"' : ''}>${ic}<span>${esc(it.text)}</span>${it.state === 'soon' ? `<small class="tag">${L('قريباً', 'Soon')}</small>` : ''}</a>`;
      return `<span class="navi locked" aria-disabled="true" data-tip="${L(...TIP[it.state])}">${ic}<span>${esc(it.text)}</span>${icon('lock', 'lk')}</span>`;
    }).join('')}</div>`).join('')}
    <div class="grow"></div>
    <a class="navi" href="/settings/" data-k="settings"${active === 'settings' ? ' aria-current="page"' : ''}>${icon('settings')}<span>الإعدادات</span></a>
    <button class="me" id="meBtn" aria-haspopup="menu" aria-expanded="false"><span class="avatar">${esc(initials)}</span>
      <span class="who"><b>${esc(me.name || me.email)}</b><span class="muted">${me.role === 'owner' ? 'المالكة' : (me.departments || []).length ? 'مدير قسم' : 'عضو'}</span></span></button>
    <div class="menu" id="meMenu" role="menu" hidden><a href="/account/" role="menuitem">${icon('user')}حسابي</a><form method="post" action="/api/auth/logout" style="margin:0"><button type="submit" role="menuitem">${icon('out')}خروج</button></form></div>`;
  side.querySelector('form')?.addEventListener('submit', () => { try { sessionStorage.removeItem(ME_KEY); } catch { /* storage blocked */ } });
  // Navigation labels as tooltips, used when the menu is folded to icons
  side.querySelectorAll('.navi').forEach(a => { const t = a.querySelector('span')?.textContent; if (t && !a.title) a.title = t; });
  const qb = $('#qcBtn', side), qm = $('#qcMenu', side);
  if (qb) qb.onclick = e => { e.stopPropagation(); qm.hidden = !qm.hidden; qb.setAttribute('aria-expanded', String(!qm.hidden)); };
  $('#sideFold', side).onclick = () => fold(!document.getElementById('app')?.classList.contains('mini'));
}

// Folded menu (icons only), remembered on this device
function fold(on) {
  const app = document.getElementById('app'); if (!app) return;
  app.classList.toggle('mini', on);
  $('#sideFold')?.setAttribute('aria-pressed', String(on));
  try { localStorage.setItem('wl-mini', on ? '1' : '0'); } catch { /* storage blocked */ }
}

function bindMe() {
  const menu = $('#meMenu'), btn = $('#meBtn');
  if (!menu || !btn) return;
  btn.onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute('aria-expanded', String(!menu.hidden)); };
  document.addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target)) { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); } }, { signal: pageSignal() });
}

// الهيكل: قائمة جانبية بأيقونات + شريط علوي. tools = HTML لأدوات الشريط.
export async function shell({ active, title, badge = '', tools = '' }) {
  const app = $('#app'), side = $('#side', app);
  let me;
  if (!ME?.v) me = await fetchMe();
  else {
    me = ME.v;
    if (Date.now() - ME.t > FRESH) fetchMe().then(v => { if (JSON.stringify(v) !== JSON.stringify(me)) { drawSide(side, v, active); bindMe(); } }).catch(() => {});
  }
  drawSide(side, me, active);
  let mini = false; try { mini = localStorage.getItem('wl-mini') === '1'; } catch { /* storage blocked */ }
  app.classList.toggle('mini', mini); $('#sideFold')?.setAttribute('aria-pressed', String(mini));
  document.addEventListener('click', e => { const m = $('#qcMenu'); if (m && !m.hidden && !e.target.closest('.qc')) { m.hidden = true; $('#qcBtn')?.setAttribute('aria-expanded', 'false'); } }, { signal: pageSignal() });
  $('#top', app).innerHTML = `<div class="t"><button class="btn icon ghost burger" id="burger" aria-label="القائمة">${icon('menu')}</button><h1>${esc(title)}</h1>${badge}</div><div class="tools"><span id="tools">${tools}</span>${langSwitch()}</div>`;
  bindMe();
  // Phone menu: Escape closes it too, and the keyboard goes back to the menu button
  const close = () => { if (!app.classList.contains('open')) return; app.classList.remove('open'); $('#burger')?.focus(); };
  $('#burger').onclick = () => { app.classList.add('open'); $('a, button', side)?.focus(); };
  $('.scrim', app).onclick = close;
  app.onkeydown = e => { if (e.key === 'Escape') close(); };
  restoreDraft();
  warmAnalytics(app);
  import('./vitals.js').then(m => m.measure()).catch(() => {});
  // Every live tab ends with its lessons card (learning loop, docs/learning-loops.md)
  if ((me.modules || []).some(m => m.key === active && m.status === 'live' && m.ok && !m.locked)) import('./lessons.js').then(m => m.lessonsCard(active)).catch(() => {});
  return me;
}

// The analytics page lives outside the app shell (built by the pipeline). Once this page is idle, fetch it and
// its data into the browser cache, once per tab session, so opening Analytics from the sidebar is near instant.
function warmAnalytics(app) {
  try {
    if (!app.querySelector('.navi[href="/"]') || sessionStorage.getItem('wl-warm') === '1') return;
    sessionStorage.setItem('wl-warm', '1');
  } catch { return; }
  const go = () => { for (const u of ['/', '/dash.json']) fetch(u, { credentials: 'same-origin', priority: 'low' }).catch(() => {}); };
  ('requestIdleCallback' in window) ? requestIdleCallback(go, { timeout: 4000 }) : setTimeout(go, 1500);
}

// تبويبات الإعدادات فوق المحتوى: حسابي للكل، والصلاحيات والدخول للمالكة بس
export function settingsTabs(current, me) {
  const tabs = [['/account/', 'حسابي', 'user', 'account', true], ['/admin/', 'الصلاحيات والدخول', 'users', 'admin', me.role === 'owner'],
    ['/admin/modules/', 'الموديولات', 'grid', 'modules', me.role === 'owner']];
  const nav = document.createElement('nav');
  nav.className = 'tabs settings-tabs'; nav.setAttribute('aria-label', 'الإعدادات');
  nav.innerHTML = tabs.filter(x => x[4]).map(([h, t, ic, k]) => `<a href="${h}"${k === current ? ' aria-current="page"' : ''}>${icon(ic)}<span>${t}</span></a>`).join('');
  $('#content').prepend(nav);
}
