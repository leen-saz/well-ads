// أقسام القائمة الجانبية، نفسها في common.js (صفحات Astro) و nav.js (لوحات التحليلات والمواد الإعلانية).
// ستة أقسام على ترتيب العمل: الرئيسية ← الإنتاج ← النشر ← القياس ← القرارات ← النظام. كل قسم تاب واحد في القائمة، وأدواته تاب فرعي فوق الصفحة (groupNav). الموديولات تجي من السيرفر (me.modules ← src/modules/registry.ts)
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

// One sidebar entry per group, and the group's tools as a strip of sub-tabs above the page (the shells draw both from this).
// A group opens its first tool the user may open. The group is lit while any of its tools is the open page.
// A group with one tool has no strip: its entry opens that tool directly.
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
    entries: secs.map(s => ({ key: s.key, label: s.label, svg: GI[s.key] || GI.system, href: first(s).href, on: s === cur, ks: s.items.map(it => it.key) })),
    strip: cur && cur.items.length > 1 ? cur : null,
  };
}
// The sub-tab strip: links (each tab is its own page), the open one marked aria-current. `extra(href)` adds shell-specific attributes.
export function stripHtml(sec, active, L, esc, extra = () => '') {
  return `<nav class="gtabs" aria-label="${esc(sec.label)}" data-gtabs>${sec.items.map(it =>
    `<a class="gtab${it.state === 'soon' ? ' soon' : ''}" href="${it.href}" data-k="${esc(it.key)}"${extra(it.href)}${isHere(it, active) ? ' aria-current="page"' : ''}><span>${esc(it.text)}</span>${it.state === 'soon' ? `<small class="tag">${L('قريباً', 'Soon')}</small>` : ''}</a>`).join('')}</nav>`;
}
// Arrow keys move between the tabs (Home/End jump); in right-to-left the arrows follow the reading direction. The open tab scrolls into view.
export function wireStrip(nav) {
  if (!nav) return;
  const tabs = () => [...nav.querySelectorAll('a.gtab')];
  nav.addEventListener('keydown', e => {
    const rtl = getComputedStyle(nav).direction === 'rtl', list = tabs(), i = list.indexOf(document.activeElement);
    if (i < 0) return;
    const step = e.key === 'ArrowRight' ? (rtl ? -1 : 1) : e.key === 'ArrowLeft' ? (rtl ? 1 : -1) : 0;
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : step ? (i + step + list.length) % list.length : -1;
    if (to >= 0) { e.preventDefault(); list[to].focus(); }
  });
  const cur = nav.querySelector('[aria-current]');
  cur?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
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
  // One entry per place. The performance summary and the creatives exist twice (the Overview module's new pages and
  // the dashboard's): the entry opens the new page when Overview is on for this company and this user may open it,
  // else the dashboard. Overview's other numbers are reached from its own page, not from a second sidebar entry.
  const ov = (me.modules || []).find(m => m.key === 'overview' && m.status === 'live' && m.ok && !m.locked);
  const one = (useNew, newer, older) => (useNew ? newer : older);
  const items = {
    home: [core('/today/', 'احلم', 'Ahlam', SUN, 'today', true), ...mods('home')],
    // نص، تصميم، صوت وفيديو (كل واحد يحمل أقسامه)، ثم المكتبة: كل ما تحفظه من أي تاب
    produce: [...mods('produce'), core('/library/', 'المكتبة', 'Library', FOLDER, 'library', true)],
    distribute: mods('distribute'),
    // ملخص الأداء (موديول overview وصفحاته) أول، بعده المواد الإعلانية، بعدها الرصد
    measure: [
      one(ov, core('/overview/', 'ملخص الأداء', 'Performance summary', 'chart', 'overview', true), core('/', 'ملخص الأداء', 'Performance summary', 'chart', 'ceo')),
      one(ov, core('/overview/creative/', 'المواد الإعلانية', 'Creatives', 'image', 'overview:creative', true), core('/?view=creative', 'المواد الإعلانية', 'Creatives', 'image', 'creative')),
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

// Whether the page being opened will probably have a strip (every page of a group with several tools): the shell holds its space
// before the profile arrives, so the page does not jump when the strip appears. Today, settings and the coming-soon pages have none.
export const stripLikely = active => !(['', 'today', 'settings'].includes(active) || String(active).startsWith('soon:'));
