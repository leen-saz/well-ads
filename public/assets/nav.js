// نفس القائمة الجانبية حق لوحة القرارات، فوق اللوحات (/ و/creative): موقع واحد.
// كل الأقسام تطلع للكل، واللي ما له صلاحية عليه يطلع مقفل. في الجوال: زر قائمة يفتح درج.
const EN = (() => { try { return new URLSearchParams(location.search).get('lang') === 'en' || localStorage.getItem('well-ads-lang') === 'en'; } catch { return false; } })();
const L = (ar, en) => EN ? en : ar;
const P = {
  plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  gavel: '<path d="m14 13-7.5 7.5a2.1 2.1 0 0 1-3-3L11 10"/><path d="m16 16 6-6"/><path d="m8 8 6-6"/><path d="m9 7 8 8"/><path d="m21 11-8-8"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
};
const I = n => `<svg class="wl-i" viewBox="0 0 24 24" aria-hidden="true">${P[n]}</svg>`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const me = await fetch('/api/account/password', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).catch(() => null);
if (me) {
  const creative = /view=creative/.test(location.search) || location.pathname.startsWith('/creative');
  const has = k => me.dashboards.includes(k), owner = me.role === 'owner';
  const items = [['/', L('التحليلات', 'Analytics'), 'chart', !creative, has('ceo')], ['/?view=creative', L('الكرييتف', 'Creative'), 'image', creative, has('creative')],
    ['/control/', L('لوحة القرارات', 'Decision board'), 'gavel', false, has('control')],
    ['/connectors/', L('الربط', 'Connectors'), 'plug', false, has('connectors')], ['/admin/', L('الصلاحيات والدخول', 'Access & sign-in'), 'users', false, owner]];
  const initials = (me.name || me.email).trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const role = owner ? L('المالكة', 'Owner') : (me.departments || []).length ? L('مدير قسم', 'Department manager') : L('عضو', 'Member');
  const side = document.createElement('aside');
  side.className = 'wl-side'; side.setAttribute('aria-label', L('القائمة', 'Menu'));
  side.innerHTML = `<a class="wl-mark" href="/">Well<i>.</i></a>
    ${items.map(([h, t, ic, on, ok]) => ok ? `<a class="wl-navi" href="${h}"${on ? ' aria-current="page"' : ''}>${I(ic)}<span>${t}</span></a>`
      : `<span class="wl-navi wl-locked" aria-disabled="true" title="${L('ما عندك صلاحية', 'No access')}">${I(ic)}<span>${t}</span>${I('lock')}</span>`).join('')}
    <div class="wl-grow"></div>
    <a class="wl-navi" href="/account/">${I('user')}<span>${L('حسابي', 'My account')}</span></a>
    <form method="post" action="/api/auth/logout" class="wl-out"><button type="submit" class="wl-navi">${I('out')}<span>${L('خروج', 'Sign out')}</span></button></form>
    <div class="wl-me"><span class="wl-av">${esc(initials)}</span><span><b>${esc(me.name || me.email)}</b><small>${role}</small></span></div>`;
  const burger = document.createElement('button');
  burger.className = 'wl-burger'; burger.setAttribute('aria-label', L('القائمة', 'Menu')); burger.innerHTML = I('menu');
  const scrim = document.createElement('div'); scrim.className = 'wl-scrim';
  burger.setAttribute('aria-expanded', 'false'); burger.setAttribute('aria-controls', 'wlSide'); side.id = 'wlSide';
  const mobile = matchMedia('(max-width:900px)');
  const setOpen = open => { document.body.classList.toggle('wl-open', open); burger.setAttribute('aria-expanded', String(open)); side.inert = mobile.matches && !open; if (open) side.querySelector('a,button')?.focus(); };
  burger.onclick = () => setOpen(true);
  scrim.onclick = () => setOpen(false);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('wl-open')) { setOpen(false); burger.focus(); } });
  mobile.addEventListener('change', () => setOpen(false));
  side.inert = mobile.matches;
  const css = document.createElement('style');
  css.textContent = `
  body{padding-inline-start:256px}
  .brand .mark{display:none}
  .wl-side{position:fixed;inset-block:0;inset-inline-start:0;width:256px;z-index:60;display:flex;flex-direction:column;gap:4px;padding:24px 16px;
    background:rgba(255,255,255,.62);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);font:400 15px/1.4 "Thmanyah Sans",system-ui,sans-serif;color:#1D1069}
  .wl-mark{font:900 26px/1 "Playfair Display",Georgia,serif;color:#1D1069;text-decoration:none;padding:4px 16px 22px;direction:ltr;text-align:start}
  .wl-mark i{color:#7E57FD;font-style:normal}
  .wl-navi{display:flex;align-items:center;gap:12px;height:44px;padding:0 16px;border-radius:999px;color:rgba(29,16,105,.62);text-decoration:none;transition:background .2s,color .2s}
  .wl-out{margin:0}.wl-out .wl-navi{width:100%;border:0;background:none;font:inherit;cursor:pointer;text-align:start}
  .wl-navi:hover{background:rgba(126,87,253,.07);color:#1D1069}
  .wl-navi:focus-visible{outline:2px solid #7E57FD;outline-offset:2px}
  .wl-navi[aria-current]{background:#7E57FD;color:#FFFFFF;font-weight:500;box-shadow:0 6px 18px rgba(126,87,253,.28)}
  .wl-locked{opacity:.45;cursor:not-allowed}.wl-locked:hover{background:transparent}.wl-locked .wl-i:last-child{width:14px;height:14px;margin-inline-start:auto}
  .wl-i{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round;flex:none}
  .wl-grow{flex:1}
  .wl-me{display:flex;align-items:center;gap:10px;padding:10px 8px 0;border-top:1px solid rgba(172,166,225,.35);margin-top:6px}
  .wl-me b{display:block;font-size:14px;font-weight:700;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wl-me small{color:rgba(29,16,105,.62);font-size:12px}
  .wl-av{width:34px;height:34px;border-radius:50%;background:#1D1069;color:#FFFFFF;display:grid;place-items:center;font-size:13px;font-weight:700;flex:none}
  .wl-burger{display:none}
  .wl-scrim{display:none}
  @media (max-width:900px){
    body{padding-inline-start:0}
    .wl-side{width:280px;transform:translateX(100%);transition:transform .2s ease-out;box-shadow:0 24px 60px rgba(126,87,253,.22);background:#FFFFFF}
    [dir=ltr] .wl-side,html[lang=en] .wl-side{transform:translateX(-100%)}
    body.wl-open .wl-side{transform:none}
    body.wl-open .wl-scrim{display:block;position:fixed;inset:0;background:rgba(29,16,105,.3);z-index:59}
    .wl-burger{display:grid;place-items:center;position:fixed;inset-block-start:14px;inset-inline-start:14px;z-index:58;width:44px;height:44px;border-radius:999px;border:0;
      background:rgba(255,255,255,.86);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);color:#1D1069;box-shadow:0 6px 18px rgba(126,87,253,.18);cursor:pointer}
    .brand{padding-inline-start:52px}
  }`;
  document.head.appendChild(css);
  document.body.append(side, scrim, burger);
}
