// اللغة: عربي (الافتراضي) أو إنجليزي. نفس المفتاح اللي تستخدمه اللوحات (well-ads-lang)، فالاختيار يمشي على كل الموقع.
// الترجمة تمسك النصوص الظاهرة والـplaceholder والـaria-label والـtooltip تلقائياً، حتى اللي ينرسم بعدين.
export const LANG = (() => {
  const q = new URLSearchParams(location.search).get('lang');
  if (q === 'en' || q === 'ar') { try { localStorage.setItem('well-ads-lang', q); } catch {} return q; }
  try { if (localStorage.getItem('well-ads-lang') === 'en') return 'en'; } catch {}
  return 'ar';
})();
document.documentElement.lang = LANG;
document.documentElement.dir = LANG === 'en' ? 'ltr' : 'rtl';
// The ClientRouter copies <html lang/dir> from each new page: put the chosen language back
document.addEventListener('astro:after-swap', () => { document.documentElement.lang = LANG; document.documentElement.dir = LANG === 'en' ? 'ltr' : 'rtl'; });

// The English strings (~60 KB) are fetched only for English; Arabic, the default, needs none of them
const { EN, PAT } = LANG === 'en'
  ? await import('./i18n-en.js').then(m => ({ EN: m.EN, PAT: m.pat(t) }))
  : { EN: {}, PAT: [] };

// Arabic-Indic digits (٠-٩ ٫ ٪ ٬) become the digits an English page uses
const latin = x => x.replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/٫/g, '.').replace(/٪/g, '%').replace(/٬/g, ',');
export function t(s) {
  if (LANG !== 'en' || s == null) return s;
  let str = String(s), k = str.trim();
  if (!k) return str;
  if (EN[k]) return str.replace(k, EN[k]);
  if (/[٠-٩٫٪٬]/.test(k)) { const n = latin(k); str = str.replace(k, n); k = n; if (EN[k]) return str.replace(k, EN[k]); }
  for (const [re, to] of PAT) if (re.test(k)) return str.replace(k, k.replace(re, to));
  return str;
}

const ATTRS = ['placeholder', 'aria-label', 'data-tip', 'title'];
function translate(root) {
  if (LANG !== 'en' || !root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.parentElement && /^(SCRIPT|STYLE|TEXTAREA)$/.test(n.parentElement.tagName)) continue;
    const v = t(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v;
  }
  const els = root.nodeType === 1 ? [root, ...root.querySelectorAll('*')] : [];
  for (const el of els) for (const a of ATTRS) { const v = el.getAttribute && el.getAttribute(a); if (v) { const w = t(v); if (w !== v) el.setAttribute(a, w); } }
}
if (LANG === 'en') {
  const go = () => {
    translate(document.body); document.title = t(document.title.replace(' · Well', '')) + ' · Well';
    OBS.observe(document.body, { childList: true, subtree: true, characterData: true });
  };
  const OBS = new MutationObserver(ms => { for (const m of ms) { if (m.type === 'characterData') { const v = t(m.target.nodeValue); if (v !== m.target.nodeValue) m.target.nodeValue = v; } else m.addedNodes.forEach(n => n.nodeType === 3 ? (n.nodeValue = t(n.nodeValue)) : translate(n)); } });
  // Astro's ClientRouter swaps in a new <body>: translate it and watch it too
  document.addEventListener('astro:after-swap', () => { OBS.disconnect(); go(); });
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', go) : go();
}

// زر اللغة: يحفظ الاختيار ويعيد تحميل الصفحة بنفس العنوان
export function langSwitch() {
  return `<span class="seg lang" role="group" aria-label="اللغة"><button data-lang="ar" aria-pressed="${LANG === 'ar'}">عربي</button><button data-lang="en" aria-pressed="${LANG === 'en'}">English</button></span>`;
}
// The switch reloads the page: what was typed on it is kept for the reload (shell() puts it back), and a page with
// results of its own (the design tab) gets 'well:before-lang' to keep them too
const DRAFT = 'well-draft:';
function saveDraft() {
  const fields = {};
  for (const el of document.querySelectorAll('#content input[id], #content textarea[id], #content select[id]')) {
    if (el.type === 'file' || el.type === 'password' || el.type === 'hidden') continue;
    fields[el.id] = el.type === 'checkbox' || el.type === 'radio' ? { c: el.checked } : { v: el.value };
  }
  try { sessionStorage.setItem(DRAFT + location.pathname, JSON.stringify({ at: Date.now(), fields })); } catch {}
  document.dispatchEvent(new CustomEvent('well:before-lang'));
}
// Once, within a minute of the switch: the fields the page has, as they were typed
export function restoreDraft() {
  let d = null;
  try { d = JSON.parse(sessionStorage.getItem(DRAFT + location.pathname) || 'null'); sessionStorage.removeItem(DRAFT + location.pathname); } catch {}
  if (!d || Date.now() - d.at > 60_000) return;
  for (const [id, f] of Object.entries(d.fields || {})) {
    const el = document.getElementById(id); if (!el) continue;
    if ('c' in f) el.checked = f.c;
    else if (el.tagName !== 'SELECT' || [...el.options].some(o => o.value === f.v)) el.value = f.v;
  }
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-lang]'); if (!b || b.dataset.lang === LANG) return;
  try { localStorage.setItem('well-ads-lang', b.dataset.lang); } catch {}
  saveDraft();
  const u = new URL(location.href); u.searchParams.delete('lang'); if (b.dataset.lang === 'en') u.searchParams.set('lang', 'en'); location.href = u.toString();
});
