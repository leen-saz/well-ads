// The command palette and keyboard shortcuts (docs/PRD.md §4.5, milestone M4). On every page, Astro and pipeline alike.
//   Ctrl/⌘+K or «/» : open the palette (search pages and actions this user may open, Arabic or English)
//   ?               : the list of shortcuts
//   g then a/h/c/s/p: go to approvals / Ahlam / decisions board / social / the performance overview
// Nothing here changes data: every entry only opens a page. Money or publishing steps keep their own confirmation there.
// Keys are ignored while the user types in a field (the palette's own box aside) and while another dialog is open.
const STATE = { me: null, L: (a) => a, sections: () => [] };
let dlg = null, help = null, gAt = 0;

// Arabic search: no diacritics or tatweel, one alef, ya and ta marbuta folded, Latin lower-cased
export const fold = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[ً-ٰٟـ]/g, '')
  .replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/\s+/g, ' ').trim();

/** Every entry this user may open: the sidebar's pages (as the sidebar shows them) plus a few actions. */
export function entries(me, L, sections) {
  const out = [], seen = new Set();
  const add = (e) => { if (!e.href || seen.has(e.href)) return; seen.add(e.href); out.push(e); };
  if (me?.approver) add({ label: L('الاعتمادات', 'Approvals'), hint: L('ينتظر اعتمادك', 'Waiting for you'), href: '/approvals/', kind: 'page' });
  for (const sec of (me ? sections(me, L) : []) || []) {
    for (const it of sec.items || []) {
      if (it.state !== 'ok') continue;
      add({ label: it.text, hint: sec.label, href: it.href, kind: 'page' });
    }
  }
  const has = k => me?.role === 'owner' || (me?.dashboards || []).includes(k);
  if (has('social')) add({ label: L('منشور جديد', 'New post'), hint: L('النشر', 'Publishing'), href: '/social/?new=1', kind: 'action' });
  if (has('control')) add({ label: L('حملة جديدة', 'New campaign'), hint: L('القرارات', 'Decisions'), href: '/control/new/', kind: 'action' });
  add({ label: L('الإعدادات', 'Settings'), hint: '', href: '/settings/', kind: 'page' });
  add({ label: L('حسابي', 'My account'), hint: '', href: '/account/', kind: 'page' });
  return out;
}

/** Entries matching the query: every word must appear (folded); entries whose label starts with the query come first. */
export function search(list, q) {
  const words = fold(q).split(' ').filter(Boolean);
  if (!words.length) return list.slice();
  const scored = [];
  for (const e of list) {
    const hay = fold(`${e.label} ${e.hint}`);
    if (!words.every(w => hay.includes(w))) continue;
    scored.push([fold(e.label).startsWith(words[0]) ? 0 : 1, e]);
  }
  return scored.sort((a, b) => a[0] - b[0]).map(x => x[1]);
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const typing = el => !!el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable=true]');
const otherDialog = () => [...document.querySelectorAll('dialog[open], [role=dialog]:not([hidden]), [role=alertdialog]')].some(d => d !== dlg && d !== help && d.offsetParent !== null);

function build() {
  const { L } = STATE;
  dlg = document.createElement('dialog');
  dlg.className = 'cmdk';
  dlg.setAttribute('aria-label', L('ابحث وانتقل', 'Search and go'));
  dlg.innerHTML = `<div class="cmdk-box"><input class="cmdk-in" type="text" role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls="cmdkList" autocomplete="off" spellcheck="false" placeholder="${esc(L('اكتب اسم صفحة أو إجراء…', 'Type a page or an action…'))}">
    <ul class="cmdk-list" id="cmdkList" role="listbox" aria-label="${esc(L('النتائج', 'Results'))}"></ul>
    <p class="cmdk-foot"><kbd>↑</kbd><kbd>↓</kbd> ${esc(L('للتنقل', 'move'))} · <kbd>Enter</kbd> ${esc(L('افتح', 'open'))} · <kbd>Esc</kbd> ${esc(L('سكّر', 'close'))} · <kbd>?</kbd> ${esc(L('الاختصارات', 'shortcuts'))}</p></div>`;
  document.body.appendChild(dlg);
  const input = dlg.querySelector('input'), list = dlg.querySelector('ul');
  let shown = [], cur = 0;
  const draw = () => {
    shown = search(entries(STATE.me, L, STATE.sections), input.value).slice(0, 30);
    cur = Math.min(cur, Math.max(0, shown.length - 1));
    list.innerHTML = shown.length ? shown.map((e, i) => `<li role="option" id="cmdk-${i}" data-i="${i}" aria-selected="${i === cur}"><span>${esc(e.label)}</span>${e.hint ? `<small>${esc(e.hint)}</small>` : ''}</li>`).join('')
      : `<li class="cmdk-none" role="presentation">${esc(L('ما لقينا شي بهالاسم', 'Nothing matches'))}</li>`;
    if (shown.length) input.setAttribute('aria-activedescendant', `cmdk-${cur}`); else input.removeAttribute('aria-activedescendant');
    list.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' });
  };
  const go = (e) => { if (!e) return; dlg.close(); window.location.assign(e.href); };
  input.addEventListener('input', () => { cur = 0; draw(); });
  input.addEventListener('keydown', ev => {
    if (ev.key === 'ArrowDown') { ev.preventDefault(); cur = Math.min(cur + 1, shown.length - 1); draw(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); cur = Math.max(cur - 1, 0); draw(); }
    else if (ev.key === 'Enter') { ev.preventDefault(); go(shown[cur]); }
  });
  list.addEventListener('click', ev => { const li = ev.target.closest('li[data-i]'); if (li) go(shown[+li.dataset.i]); });
  dlg.addEventListener('click', ev => { if (ev.target === dlg) dlg.close(); });   // a click on the backdrop
  dlg._open = () => { input.value = ''; cur = 0; draw(); dlg.showModal(); input.focus(); };
}

function buildHelp() {
  const { L } = STATE;
  help = document.createElement('dialog');
  help.className = 'cmdk cmdk-help';
  help.setAttribute('aria-label', L('اختصارات لوحة المفاتيح', 'Keyboard shortcuts'));
  const rows = [
    [['Ctrl', 'K'], L('ابحث وانتقل لأي صفحة', 'Search and go to any page')],
    [['/'], L('نفس البحث', 'The same search')],
    [['G', 'A'], L('الاعتمادات', 'Approvals')],
    [['G', 'H'], L('أحلم', 'Ahlam')],
    [['G', 'C'], L('لوحة القرارات', 'Decision board')],
    [['G', 'S'], L('النشر', 'Publishing')],
    [['G', 'P'], L('نظرة عامة على الأداء', 'Performance overview')],
    [['J', 'K'], L('التنقل في القوائم (الاعتمادات ولوحة القرارات)', 'Move in lists (approvals, decisions)')],
    [['?'], L('هذي القائمة', 'This list')],
  ];
  help.innerHTML = `<div class="cmdk-box"><h2>${esc(L('اختصارات لوحة المفاتيح', 'Keyboard shortcuts'))}</h2><dl class="cmdk-keys">${rows.map(([k, t]) => `<div><dt>${k.map(x => `<kbd>${esc(x)}</kbd>`).join(' ')}</dt><dd>${esc(t)}</dd></div>`).join('')}</dl>
    <p class="cmdk-foot">${esc(L('ما فيه اختصار ينفّذ اعتماد أو نشر أو صرف مباشرة: كلها تفتح التأكيد بس.', 'No shortcut approves, publishes or spends directly: each opens the confirmation.'))}</p>
    <form method="dialog"><button class="btn secondary" type="submit">${esc(L('سكّر', 'Close'))}</button></form></div>`;
  document.body.appendChild(help);
  help.addEventListener('click', ev => { if (ev.target === help) help.close(); });
}

// Own styles, from the shared tokens: the pipeline pages do not load app.css
function style() {
  if (document.getElementById('cmdk-css')) return;
  const st = document.createElement('style');
  st.id = 'cmdk-css';
  st.textContent = `
.cmdk{border:0;padding:0;background:transparent;max-width:min(640px,calc(100vw - 32px));width:100%;margin:12vh auto auto;color:var(--foreground,#1D1069)}
.cmdk::backdrop{background:color-mix(in srgb,var(--brand-indigo,#1D1069) 35%,transparent)}
.cmdk-box{background:var(--paper,#fff);border-radius:16px;box-shadow:0 24px 60px rgba(29,16,105,.28);overflow:hidden;font:400 15px/1.5 "Thmanyah Sans",system-ui,sans-serif}
.cmdk-in{width:100%;min-height:56px;border:0;border-bottom:1px solid color-mix(in srgb,var(--brand-soft,#ACA6E1) 45%,transparent);padding:0 20px;font:inherit;font-size:17px;background:transparent;color:inherit;outline:none}
.cmdk-list{list-style:none;margin:0;padding:6px;max-height:min(52vh,420px);overflow:auto}
.cmdk-list li{display:flex;align-items:center;gap:12px;min-height:44px;padding:0 14px;border-radius:10px;cursor:pointer}
.cmdk-list li small{margin-inline-start:auto;color:color-mix(in srgb,var(--foreground,#1D1069) 60%,transparent);font-size:12px}
.cmdk-list li[aria-selected=true]{background:var(--primary,#7E57FD);color:var(--on-primary,#fff)}
.cmdk-list li[aria-selected=true] small{color:inherit;opacity:.8}
.cmdk-none{color:color-mix(in srgb,var(--foreground,#1D1069) 60%,transparent);cursor:default}
.cmdk-foot{margin:0;padding:10px 16px;font-size:12px;color:color-mix(in srgb,var(--foreground,#1D1069) 62%,transparent);border-top:1px solid color-mix(in srgb,var(--brand-soft,#ACA6E1) 35%,transparent)}
.cmdk kbd{display:inline-grid;place-items:center;min-width:1.6em;padding:0 .35em;border:1px solid color-mix(in srgb,var(--brand-soft,#ACA6E1) 60%,transparent);border-bottom-width:2px;border-radius:6px;font:600 11px/1.6 "Thmanyah Sans",system-ui,sans-serif}
.cmdk-help .cmdk-box{padding:20px}.cmdk-help h2{margin:0 0 12px;font-size:18px}
.cmdk-keys{display:grid;gap:8px;margin:0 0 12px}.cmdk-keys div{display:flex;gap:14px;align-items:center}.cmdk-keys dt{min-width:84px}.cmdk-keys dd{margin:0}
.cmdk-help .cmdk-foot{border:0;padding:0 0 12px}
@media (prefers-reduced-motion:no-preference){.cmdk[open] .cmdk-box{animation:cmdk-in .14s ease-out}@keyframes cmdk-in{from{opacity:0;transform:translateY(-6px)}}}`;
  document.head.appendChild(st);
}

export function openPalette() { if (!dlg || !dlg.isConnected) build(); if (!dlg.open) dlg._open(); }
export function openHelp() { if (!help || !help.isConnected) buildHelp(); if (!help.open) help.showModal(); }

// By physical key (e.code), so the shortcuts work the same on an Arabic keyboard layout
const G = { KeyA: '/approvals/', KeyH: '/today/', KeyC: '/control/', KeyS: '/social/', KeyP: '/overview/' };

function onKey(e) {
  const c = e.code;
  const take = () => { e.preventDefault(); e.stopPropagation(); };   // a key we use never reaches the page's own shortcuts
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && c === 'KeyK') { take(); openPalette(); return; }
  if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || dlg?.open || help?.open || otherDialog()) return;
  if (c === 'Slash' && !e.shiftKey) { take(); openPalette(); return; }
  if (e.key === '?' || e.key === '؟' || (c === 'Slash' && e.shiftKey)) { take(); openHelp(); return; }
  if (c === 'KeyG') { take(); gAt = Date.now(); return; }
  if (gAt && Date.now() - gAt < 1200) {
    gAt = 0;
    const to = G[c];
    if (to && (to !== '/approvals/' || STATE.me?.approver)) { take(); window.location.assign(to); }
    else if (to) take();
  }
}

/** Called by every page's shell with the signed-in user. The listener is added once per document. */
export function installPalette(me, L, sections) {
  STATE.me = me; STATE.L = L; STATE.sections = sections;
  if (dlg && !dlg.isConnected) dlg = null;
  if (help && !help.isConnected) help = null;
  if (window.__wlPalette) return;
  window.__wlPalette = true;
  // Capture on window: runs before the pages' own key handlers (J/K/A/R on the boards), which it can then hold back
  window.addEventListener('keydown', onKey, true);
  style();
}
