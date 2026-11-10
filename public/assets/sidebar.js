// أقسام القائمة الجانبية، نفسها في common.js (صفحات Astro) و nav.js (لوحات التحليلات والمواد الإعلانية).
// خمس وجهات رئيسية، وتحت كل وحدة أدواتها. الموديولات تجي من السيرفر (me.modules ← src/modules/registry.ts)
// وكل موديول يحدد وجهته بـ group. نفس الترتيب في HUBS (src/lib/gate.ts) عشان روابط الوجهات تفتح أول أداة مسموحة.
// state: ok = يفتح، noaccess = ما عندك صلاحية، locked = مقفل لشركتك، soon = قريباً.
const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
const SHIELD = '<path d="M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1Z"/><path d="m9 12 2 2 4-4"/>';

export const GROUPS = [
  ['today', 'اليوم', 'Today'],
  ['performance', 'الأداء', 'Performance'],
  ['create', 'إنشاء المحتوى', 'Content creation'],
  ['review', 'المراجعة والتنفيذ', 'Review & execution'],
  ['system', 'إدارة النظام', 'System'],
];

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
    return e.state === 'noaccess' && c ? { ...e, href: `/${m.key}/?tab=${c.key}`, state: 'ok' } : e;
  };
  const mods = (g, keep = () => true) => (me.modules || []).filter(m => m.group === g && !m.into && keep(m)).flatMap(m => [host(m), ...sub(m)]);
  // One entry per place. The performance summary and the creatives exist twice (the Overview module's new pages and
  // the dashboard's): the entry opens the new page when Overview is on for this company and this user may open it,
  // else the dashboard. Overview's other numbers are reached from its own page, not from a second sidebar entry.
  const ov = (me.modules || []).find(m => m.key === 'overview' && m.status === 'live' && m.ok && !m.locked);
  const one = (useNew, newer, older) => (useNew ? newer : older);
  const items = {
    today: [core('/today/', 'ملخص اليوم', 'Today', SUN, 'today', true), ...mods('today')],
    // ملخص الأداء (موديول overview وصفحاته) أول، بعده اللوحة الكاملة بتبويباتها، بعدها المواد الإعلانية والرصد
    performance: [
      one(ov, core('/overview/', 'ملخص الأداء', 'Performance summary', 'chart', 'overview', true), core('/', 'ملخص الأداء', 'Performance summary', 'chart', 'ceo')),
      one(ov, core('/overview/creative/', 'المواد الإعلانية', 'Creatives', 'image', 'overview:creative', true), core('/?view=creative', 'المواد الإعلانية', 'Creatives', 'image', 'creative')),
      ...mods('performance', m => m.key !== 'overview')],
    create: mods('create'),
    review: [core('/control/', 'لوحة القرارات', 'Decision board', 'gavel', 'control'), ...mods('review'),
      core('/control/?tab=log', 'السجل', 'History', 'clock', 'control:log', has('control'))],
    system: [core('/connectors/', 'الربط', 'Connectors', 'plug', 'connectors'), ...mods('system'),
      ...(me.role === 'owner' ? [core('/admin/', 'الصلاحيات', 'Permissions', SHIELD, 'admin', true)] : [])],
  };
  return GROUPS.map(([k, ar, en]) => ({ key: k, label: L(ar, en), items: items[k] })).filter(s => s.items.length);
}
export const TIP = { noaccess: ['ما عندك صلاحية', 'No access'], locked: ['مقفل لشركتك', 'Locked for your company'] };
