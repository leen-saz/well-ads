// أقسام القائمة الجانبية، نفسها في common.js (صفحات Astro) و nav.js (لوحات التحليلات والمواد الإعلانية).
// ثمانية أقسام على ترتيب التسويق: الرئيسية ← التخطيط ← الإنتاج ← النشر ← القياس ← التحسين ← الحوكمة ← النظام. تحت كل قسم أدواته. الموديولات تجي من السيرفر (me.modules ← src/modules/registry.ts)
// وكل موديول يحدد قسمه بـ group. HUBS (src/lib/gate.ts) تبقى للروابط القديمة /performance و/create و/review و/system.
// state: ok = يفتح، noaccess = ما عندك صلاحية، locked = مقفل لشركتك، soon = قريباً.
const SUN = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>';
const SHIELD = '<path d="M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1Z"/><path d="m9 12 2 2 4-4"/>';

export const GROUPS = [
  ['home', 'الرئيسية', 'Home'],
  ['plan', 'التخطيط والمعرفة', 'Plan & knowledge'],
  ['produce', 'الإنتاج', 'Create'],
  ['distribute', 'النشر والتوزيع', 'Publish & distribute'],
  ['measure', 'القياس والتحليل', 'Measure & analyze'],
  ['optimize', 'التحسين والقرارات', 'Optimize & decide'],
  ['govern', 'الحوكمة', 'Governance'],
  ['system', 'النظام', 'System'],
];

// Which groups the user folded, remembered on this device (storage may be blocked: then every group stays open)
const FOLD_KEY = 'wl-side-shut';
const shut = () => { try { const v = JSON.parse(localStorage.getItem(FOLD_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
export const isShut = key => shut().includes(key);
export function setShut(key, on) {
  try { localStorage.setItem(FOLD_KEY, JSON.stringify([...shut().filter(k => k !== key), ...(on ? [key] : [])])); } catch { /* storage blocked */ }
}
// A group stays open while it holds the page the user is on, so the highlight is never hidden
export const startsShut = (sec, active) => isShut(sec.key) && !sec.items.some(it => it.key === active);
// Wires every [data-g] header inside root: a click folds or opens its group (the .shut class on the section, aria-expanded on the header)
export function wireGroups(root) {
  root.querySelectorAll('[data-g]').forEach(h => {
    h.onclick = () => {
      const sec = h.parentElement, on = !sec.classList.contains('shut');
      sec.classList.toggle('shut', on); h.setAttribute('aria-expanded', String(!on)); setShut(h.dataset.g, on);
    };
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
    return e.state === 'noaccess' && c ? { ...e, href: `/${m.key}/?tab=${c.key}`, state: 'ok' } : e;
  };
  const mods = (g, keep = () => true) => (me.modules || []).filter(m => m.group === g && !m.into && keep(m)).flatMap(m => [host(m), ...sub(m)]);
  // One entry per place. The performance summary and the creatives exist twice (the Overview module's new pages and
  // the dashboard's): the entry opens the new page when Overview is on for this company and this user may open it,
  // else the dashboard. Overview's other numbers are reached from its own page, not from a second sidebar entry.
  const ov = (me.modules || []).find(m => m.key === 'overview' && m.status === 'live' && m.ok && !m.locked);
  const one = (useNew, newer, older) => (useNew ? newer : older);
  const items = {
    home: [core('/today/', 'ملخص اليوم', 'Today', SUN, 'today', true), ...mods('home')],
    plan: mods('plan'),
    produce: mods('produce'),
    distribute: mods('distribute'),
    // ملخص الأداء (موديول overview وصفحاته) أول، بعده المواد الإعلانية، بعدها أدوات القياس (التتبع)
    measure: [
      one(ov, core('/overview/', 'ملخص الأداء', 'Performance summary', 'chart', 'overview', true), core('/', 'ملخص الأداء', 'Performance summary', 'chart', 'ceo')),
      one(ov, core('/overview/creative/', 'المواد الإعلانية', 'Creatives', 'image', 'overview:creative', true), core('/?view=creative', 'المواد الإعلانية', 'Creatives', 'image', 'creative')),
      ...mods('measure', m => m.key !== 'overview')],
    optimize: [core('/control/', 'لوحة القرارات', 'Decision board', 'gavel', 'control'), ...mods('optimize')],
    govern: [...mods('govern'), core('/control/?tab=log', 'السجل', 'History', 'clock', 'control:log', has('control')),
      ...(me.role === 'owner' ? [core('/admin/', 'الصلاحيات', 'Permissions', SHIELD, 'admin', true)] : [])],
    system: [core('/connectors/', 'الربط', 'Connectors', 'plug', 'connectors'), ...mods('system')],
  };
  return GROUPS.map(([k, ar, en]) => ({ key: k, label: L(ar, en), items: items[k] })).filter(s => s.items.length);
}
export const TIP = { noaccess: ['ما عندك صلاحية', 'No access'], locked: ['مقفل لشركتك', 'Locked for your company'] };
