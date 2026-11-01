// Tabs that stay open: on a wide screen, a sidebar click shows the page in a same-origin frame that stays
// loaded, so going back to a tab you already opened is instant (no reload, filters and scroll kept).
// The page you landed on stays underneath. Phones keep normal navigation (the menu is a drawer there).
const FRAMED = window.top !== window;
const WIDE = matchMedia('(min-width: 901px)');

export const framed = () => FRAMED;

if (FRAMED) {
  // Inside a frame: no second sidebar, the page takes the whole frame
  document.documentElement.classList.add('in-frame');
  const s = document.createElement('style');
  s.textContent = `.in-frame .side,.in-frame .wl-side,.in-frame .wl-burger,.in-frame .wl-scrim,.in-frame .burger{display:none!important}
  .in-frame .app{grid-template-columns:1fr!important}.in-frame body{padding-inline-start:0!important}`;
  document.head.appendChild(s);
  // Session ended inside a frame: the login page takes the whole window
  if (location.pathname.startsWith('/login')) window.top.location.href = location.href;
}

const key = href => { const u = new URL(href, location.href); return u.pathname + u.search; };

export function keepTabs(side) {
  if (FRAMED || !side) return;
  const home = key(location.href), homeTitle = document.title;
  const frames = new Map();
  let box = null;

  const mark = k => side.querySelectorAll('a.navi[href], a.wl-navi[href]').forEach(a => {
    if (key(a.href) === k) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const place = () => { if (box) box.style.insetInlineStart = side.getBoundingClientRect().width + 'px'; };

  function show(k, push) {
    if (k === home) {
      if (box) box.hidden = true;
      document.title = homeTitle;
    } else {
      if (!box) {
        box = document.createElement('div');
        box.className = 'keep-box';
        box.style.cssText = 'position:fixed;inset-block:0;inset-inline-end:0;z-index:50;background:var(--bg,#F6F0E3)';
        document.body.appendChild(box);
        addEventListener('resize', place);
      }
      place();
      box.hidden = false;
      let f = frames.get(k);
      if (!f) {
        f = document.createElement('iframe');
        f.style.cssText = 'border:0;width:100%;height:100%;display:block';
        f.title = '';
        f.src = k;
        f.addEventListener('load', () => {
          try {
            const loc = f.contentWindow.location;
            if (loc.pathname.startsWith('/login')) { location.href = loc.href; return; }
            if (!f.hidden) document.title = f.contentDocument.title || homeTitle;
          } catch { /* not same-origin: leave it */ }
        });
        box.appendChild(f);
        frames.set(k, f);
      }
      for (const x of frames.values()) x.hidden = x !== f;
      try { document.title = f.contentDocument.title || homeTitle; } catch { /* still loading */ }
    }
    mark(k);
    if (push) history.pushState({ keep: k }, '', k);
  }

  side.addEventListener('click', e => {
    const a = e.target.closest('a[href]');
    if (!a || !WIDE.matches || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const u = new URL(a.href, location.href);
    if (u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
    e.preventDefault();
    show(key(u.href), true);
  });
  addEventListener('popstate', () => show(key(location.href), false));
  // Narrowed to a phone while a kept tab shows: open it as a normal page
  WIDE.addEventListener('change', () => { if (!WIDE.matches && key(location.href) !== home) location.reload(); });
  history.replaceState({ keep: home }, '', location.href);
}
