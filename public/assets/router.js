// One script for every Astro page: after each navigation (and the first load) it runs the page's own
// module, named by <body data-page>. Modules load once; their default export mount() runs on every visit.
// After a deploy, a tab moving between pages gets this script from a new versioned path: the old copy is still
// listening, so the newest one reloads the page once instead of two routers mounting every page
const ME = import.meta.url;
if (window.__wlRouter && window.__wlRouter !== ME) location.reload();
window.__wlRouter = ME;
// WCAG 2.4.1 Bypass Blocks: the first Tab stop on a page jumps over the sidebar to the main content. It is drawn only
// while focused (app.css .skip-link); the body is replaced on every navigation, so it is added again each time.
const en = () => { try { const q = new URLSearchParams(location.search).get('lang'); return q ? q === 'en' : localStorage.getItem('well-ads-lang') === 'en'; } catch { return false; } };
function skipLink() {
  const main = document.getElementById('content');
  if (!main || document.querySelector('.skip-link')) return;
  main.tabIndex = -1;
  const a = document.createElement('a');
  a.className = 'skip-link'; a.href = '#content';
  // same rule as i18n.js (?lang=en, else the saved choice); <html lang> is still the server's "ar" when this runs
  a.textContent = en() ? 'Skip to main content' : 'انتقل إلى المحتوى';
  document.body.prepend(a);
}
async function run() {
  if (window.__wlRouter !== ME) return;
  skipLink();
  const name = document.body.dataset.page;
  if (!name || !/^[a-z]+$/.test(name)) return;
  // Tabs built as modules keep their script in public/modules/<name>/client.js (src/modules/README.md)
  const mod = await import('module' in document.body.dataset ? `/modules/${name}/client.js` : `/assets/${name}.js`);
  await mod.default();
}
document.addEventListener('astro:page-load', run);
