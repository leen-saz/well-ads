// أقسام القائمة الجانبية، نفسها في common.js (صفحات Astro) و nav.js (لوحات التحليلات والكرييتف).
// مجموعات بعناوين صغيرة مثل Paperclip. الموديولات تجي من السيرفر (me.modules ← src/modules/registry.ts).
// state: ok = يفتح، noaccess = ما عندك صلاحية، locked = مقفل لشركتك، soon = قريباً.
export function sections(me, L) {
  const has = k => me.dashboards.includes(k);
  const core = (href, ar, en, ic, key) => ({ href, text: L(ar, en), ic, key, state: has(key) ? 'ok' : 'noaccess' });
  const mod = m => ({ href: m.status === 'soon' ? `/soon/?t=${m.key}` : `/${m.key}/`, text: L(m.ar, m.en), svg: m.icon, key: m.status === 'soon' ? 'soon:' + m.key : m.key,
    state: m.locked ? 'locked' : m.status === 'soon' ? 'soon' : m.ok ? 'ok' : 'noaccess' });
  const mods = g => (me.modules || []).filter(m => m.group === g).map(mod);
  return [
    { label: L('الإعلانات', 'Ads'), items: [core('/', 'التحليلات', 'Analytics', 'chart', 'ceo'), core('/?view=creative', 'الكرييتف', 'Creative', 'image', 'creative'), core('/control/', 'لوحة القرارات', 'Decision board', 'gavel', 'control')] },
    { label: L('الإيجنتس', 'Agents'), items: mods('agents') },
    { label: L('النمو', 'Growth'), items: mods('growth') },
    { label: L('النظام', 'System'), items: [core('/connectors/', 'الربط', 'Connectors', 'plug', 'connectors')] },
  ].filter(s => s.items.length);
}
export const TIP = { noaccess: ['ما عندك صلاحية', 'No access'], locked: ['مقفل لشركتك', 'Locked for your company'] };
