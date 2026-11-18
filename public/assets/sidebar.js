// أقسام القائمة الجانبية، نفسها في common.js (صفحات Astro) و nav.js (لوحات التحليلات والمواد الإعلانية).
// ستة أقسام على ترتيب العمل: الرئيسية ← الإنتاج ← النشر ← القياس ← القرارات ← النظام. القسم اللي فيه أدوات كثيرة يتمدد في القائمة وتحته أدواته (groupNav، navHtml)، والقسم اللي فيه أداة وحدة سطر عادي. الموديولات تجي من السيرفر (me.modules ← src/modules/registry.ts)
// وكل موديول يحدد قسمه بـ group. HUBS (src/lib/gate.ts) تبقى للروابط القديمة /performance و/create و/review و/system.
// state: ok = يفتح، noaccess = ما عندك صلاحية، locked = مقفل لشركتك، soon = قريباً.
const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
const FOLDER = '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>';
const SHIELD = '<path d="M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1Z"/><path d="m9 12 2 2 4-4"/>';

export const GROUPS = [
  ['home', 'الرئيسية', 'Home'],
  ['produce', 'الإنتاج', 'Create'],
  ['distribute', 'النشر', 'Publish'],
  ['measure', 'القياس', 'Measure'],
  ['optimize', 'القرارات', 'Decide'],
  ['system', 'النظام', 'System'],
];

// A tab that hosts sections is named for all of them in the sidebar (module.ts keeps the module's own name)
const HOST_NAME = { content: ['نص', 'Text'], voice: ['صوت وفيديو', 'Voice & video'] };

// An entry is the open page when its key is the page, or one of the other keys it stands for (the folded «أقسام قادمة» row)
export const isHere = (it, active) => it.key === active || (it.also || []).includes(active);

// One sidebar entry per group. A group with several tools the user may open is an accordion: the entry expands and lists its tools
// under it (sub-items). A group with one tool is a plain entry that opens it. Both shells (common.js, nav.js) draw from here.
const GI = {
  home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  produce: '<path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2Z"/><path d="M19 16v4M17 18h4"/>',
  distribute: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  measure: '<path d="M3 3v18h18"/><path d="M8 17v-5M13 17V8M18 17v-9"/>',
  optimize: '<path d="m14 13-7.5 7.5a2.1 2.1 0 0 1-3-3L11 10"/><path d="m16 16 6-6"/><path d="m8 8 6-6"/><path d="m9 7 8 8"/><path d="m21 11-8-8"/>',
  system: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
};
export function groupNav(secs, active) {
  const cur = secs.find(s => s.items.some(it => isHere(it, active)));
  const first = s => (s.items.find(it => it.state === 'ok') || s.items[0]);
  return {
    cur,
    entries: secs.map(s => ({
      key: s.key, label: s.label, svg: GI[s.key] || GI.system, href: first(s).href, on: s === cur, multi: s.items.length > 1, ks: s.items.map(it => it.key),
      items: s.items.map(it => ({ key: it.key, text: it.text, href: it.href, soon: it.state === 'soon', on: isHere(it, active), also: it.also || [] })),
    })),
  };
}

// Which sidebar item the board (/, built by the pipeline) is showing: its view is in the address (?p=channels, ?p=depts, ?view=creative)
export function boardActive(pathname, search) {
  const q = new URLSearchParams(search), p = q.get('p');
  if (q.get('view') === 'creative' || p === 'creative' || /^\/(creative|c)\/?$/.test(pathname)) return 'creative';
  if (p === 'channels') return 'board:channels';
  if (p === 'depts' || p === 'dept') return 'board:depts';
  return 'ceo';
}

// ---- the accordion: markup, open/closed memory, keys
const OPEN_KEY = 'wl-nav-open';
const readOpen = () => { try { const v = JSON.parse(localStorage.getItem(OPEN_KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
const saveOpen = m => { try { localStorage.setItem(OPEN_KEY, JSON.stringify(m)); } catch { /* storage blocked */ } };
const CHEV = '<svg class="nv-c" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
// o = { item: 'navi' | 'wl-navi', icon: 'i' | 'wl-i', L, esc, extra(href) }. Every entry has data-grp; a plain entry opens its one tool.
export function navHtml(entries, o) {
  const open = readOpen(), { item, icon, L, esc } = o, ex = o.extra || (() => '');
  const ico = g => `<svg class="${icon}" viewBox="0 0 24 24" aria-hidden="true">${g.svg}</svg>`;
  return entries.map(g => {
    if (!g.multi) return `<a class="${item} nv-p" href="${g.href}" data-k="${esc('g:' + g.key)}" data-grp="${g.key}" data-ks="${esc(g.ks.join(','))}"${ex(g.href)}${g.on ? ' aria-current="page"' : ''}>${ico(g)}<span>${esc(g.label)}</span></a>`;
    const isOpen = open[g.key] || g.on;
    return `<div class="nv-g" data-g="${g.key}"${isOpen ? ' data-open' : ''}>
      <button type="button" class="${item} nv-h" data-k="${esc('g:' + g.key)}" data-grp="${g.key}" data-ks="${esc(g.ks.join(','))}" aria-expanded="${isOpen ? 'true' : 'false'}" aria-controls="nv-${g.key}"${g.on ? ' data-cur' : ''}>${ico(g)}<span>${esc(g.label)}</span>${CHEV}</button>
      <div class="nv-s" id="nv-${g.key}" role="group" aria-label="${esc(g.label)}">${g.items.map(it =>
        `<a class="${item} nv-i" href="${it.href}" data-k="${esc(it.key)}" data-also="${esc(it.also.join(','))}" data-grp="${g.key}"${ex(it.href)}${it.on ? ' aria-current="page"' : ''}><span>${esc(it.text)}</span>${it.soon ? `<small class="tag">${L('قريباً', 'Soon')}</small>` : ''}</a>`).join('')}</div>
    </div>`;
  }).join('');
}
const setG = (g, on) => { g.toggleAttribute('data-open', on); g.querySelector('.nv-h')?.setAttribute('aria-expanded', String(on)); };
// After navigation (or any redraw): mark the open page and its group; open the group that holds the open page.
export function syncNav(root, active, curKey) {
  if (!root) return;
  root.querySelectorAll('.nv-i').forEach(a => { const on = a.dataset.k === active || (a.dataset.also || '').split(',').includes(active); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  root.querySelectorAll('.nv-p').forEach(a => { if (a.dataset.grp === curKey) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  root.querySelectorAll('.nv-h').forEach(h => h.toggleAttribute('data-cur', h.dataset.grp === curKey));
  if (curKey && root.dataset.curg !== curKey) { const m = readOpen(); if (!m[curKey]) { m[curKey] = true; saveOpen(m); } }
  root.dataset.curg = curKey || '';
  const m = readOpen();
  root.querySelectorAll('.nv-g').forEach(g => setG(g, !!m[g.dataset.g]));
}
// Click toggles a group (remembered on this device). Arrow keys: up/down move through the visible entries, the key that points
// toward the sub-items opens a group (and the opposite one closes it, or moves from a sub-item back to its group); Home/End jump.
export function wireNav(root) {
  if (!root || root._nv) return;
  root._nv = true;
  const toggle = (g, on) => { setG(g, on); const m = readOpen(); m[g.dataset.g] = on; saveOpen(m); };
  root.addEventListener('click', e => { const h = e.target.closest('.nv-h'); if (h && root.contains(h)) toggle(h.parentElement, !h.parentElement.hasAttribute('data-open')); });
  root.addEventListener('keydown', e => {
    const list = [...root.querySelectorAll('.nv-h, .nv-p, .nv-i')].filter(x => x.getClientRects().length), i = list.indexOf(document.activeElement);
    if (i < 0 || e.altKey || e.ctrlKey || e.metaKey) return;
    const rtl = getComputedStyle(root).direction === 'rtl', fwd = rtl ? 'ArrowLeft' : 'ArrowRight', back = rtl ? 'ArrowRight' : 'ArrowLeft', cur = list[i];
    let to = -1;
    if (e.key === 'ArrowDown') to = (i + 1) % list.length;
    else if (e.key === 'ArrowUp') to = (i - 1 + list.length) % list.length;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = list.length - 1;
    else if (e.key === fwd && cur.matches('.nv-h')) { e.preventDefault(); const g = cur.parentElement; if (!g.hasAttribute('data-open')) toggle(g, true); else cur.parentElement.querySelector('.nv-i')?.focus(); return; }
    else if (e.key === back && cur.matches('.nv-h')) { e.preventDefault(); toggle(cur.parentElement, false); return; }
    else if (e.key === back && cur.matches('.nv-i')) { e.preventDefault(); cur.closest('.nv-g')?.querySelector('.nv-h')?.focus(); return; }
    if (to >= 0) { e.preventDefault(); list[to].focus(); }
  });
}

export function sections(me, L) {
  const has = k => me.dashboards.includes(k) || me.role === 'owner';
  const core = (href, ar, en, ic, key, ok = has(key)) => ({ href, text: L(ar, en), ...(ic.startsWith('<') ? { svg: ic } : { ic }), key, state: ok ? 'ok' : 'noaccess' });
  const mod = m => ({ href: m.status === 'soon' ? `/soon/?t=${m.key}` : `/${m.key}/`, text: L(m.ar, m.en), svg: m.icon, key: m.status === 'soon' ? 'soon:' + m.key : m.key,
    state: m.locked ? 'locked' : m.status === 'soon' ? 'soon' : m.ok ? 'ok' : 'noaccess' });
  // A live module's extra pages sit right under it, with the module's own access
  const sub = m => m.status === 'soon' ? [] : (m.pages || []).map(p => ({ ...mod(m), href: `/${m.key}/${p.path}/`, text: L(p.ar, p.en), svg: p.icon, key: `${m.key}:${p.path}` }));
  // A tab shown as a section of another (voiceover in voice, copy in content) has no entry of its own. When the user
  // may open only the section, the tab's entry opens it.
  const kids = k => (me.modules || []).filter(m => m.into === k);
  const host = m => {
    const e = mod(m), c = kids(m.key).find(x => x.ok && !x.locked && x.status === 'live');
    const named = HOST_NAME[m.key] && kids(m.key).length ? { ...e, text: L(...HOST_NAME[m.key]) } : e;
    return e.state === 'noaccess' && c ? { ...named, href: `/${m.key}/?tab=${c.key}`, state: 'ok' } : named;
  };
  const mods = (g, keep = () => true) => (me.modules || []).filter(m => m.group === g && !m.into && keep(m)).flatMap(m => [host(m), ...sub(m)]);
  // Measure: one tab, five pages, all reached from the sidebar only: overview, platforms and campaigns, departments, creatives, listening.
  // Overview is the performance summary (/overview/) when that module is on for this company and this user may use it (it needs overview AND
  // ceo, and its numbers are for all departments, so a department manager gets the board's overview instead); else the board's own first view.
  // Platforms, departments and creatives are views of the board (/): ?p=channels, ?p=depts, ?view=creative. The board's own tab row is hidden.
  // Each page shows only when this user can open it (board: ceo, creatives: creative, listening: listening), so the sidebar never offers a 403.
  // The permission rules themselves are unchanged.
  const ov = (me.modules || []).find(m => m.key === 'overview' && m.status === 'live' && m.ok && !m.locked);
  const ovOk = !!ov && has('ceo') && !(me.role !== 'owner' && (me.departments || []).length);
  const items = {
    home: [core('/today/', 'احلم', 'Ahlam', SUN, 'today', true), ...mods('home')],
    // نص، تصميم، صوت وفيديو (كل واحد يحمل أقسامه)، ثم المكتبة: كل ما تحفظه من أي تاب
    produce: [...mods('produce'), core('/library/', 'المكتبة', 'Library', FOLDER, 'library', true)],
    distribute: mods('distribute'),
    // نظرة عامة، المنصات والحملات، الأقسام، المواد الإعلانية، الرصد
    measure: [
      { ...(ovOk ? core('/overview/', 'نظرة عامة', 'Overview', 'chart', 'overview') : core('/', 'نظرة عامة', 'Overview', 'chart', 'ceo')), also: ['ceo'] },
      core('/?p=channels', 'المنصات والحملات', 'Platforms and campaigns', 'chart', 'board:channels', has('ceo')),
      core('/?p=depts', 'الأقسام', 'Departments', 'users', 'board:depts', has('ceo')),
      { ...core('/?view=creative', 'المواد الإعلانية', 'Creatives', 'image', 'creative'), also: ['overview:creative'] },
      ...mods('measure', m => m.key !== 'overview')],
    optimize: [core('/control/', 'لوحة القرارات', 'Decision board', 'gavel', 'control'), ...mods('optimize')],
    // المعرفة، الامتثال، الربط، السجل، المستخدمون (للمالك)
    system: [...mods('system'), core('/connectors/', 'الربط', 'Connectors', 'plug', 'connectors'),
      core('/control/?tab=log', 'السجل', 'History', 'clock', 'control:log', has('control')),
      ...(me.role === 'owner' ? [core('/admin/', 'المستخدمون', 'Users', SHIELD, 'admin', true)] : [])],
  };
  // What this user cannot open is not shown. What is off for the company or not built yet folds into one quiet row
  // (it opens the page that explains why), so the sidebar holds no locked rows. The gate still refuses the pages themselves.
  const folded = [];
  for (const k of Object.keys(items)) items[k] = items[k].filter(it => { if (it.state === 'noaccess') return false; if (it.state === 'locked' || it.state === 'soon') { folded.push(it); return false; } return true; });
  if (folded.length) {
    const f = folded[0], why = f.state === 'locked' ? '&why=locked' : '';
    const key = String(f.key).replace(/^soon:/, '');
    items.system.push({ href: `/soon/?t=${key}${why}`, text: L('أقسام قادمة', 'More sections'), ic: 'clock', key: 'soon:' + key, state: 'soon', also: folded.map(x => x.key) });
  }
  return GROUPS.map(([k, ar, en]) => ({ key: k, label: L(ar, en), items: items[k] })).filter(s => s.items.length);
}
export const TIP = { noaccess: ['ما عندك صلاحية', 'No access'], locked: ['مقفل لشركتك', 'Locked for your company'] };
