// One script for every Astro page: after each navigation (and the first load) it runs the page's own
// module, named by <body data-page>. Modules load once; their default export mount() runs on every visit.
// After a deploy, a tab moving between pages gets this script from a new versioned path: the old copy is still
// listening, so the newest one reloads the page once instead of two routers mounting every page
const ME = import.meta.url;
if (window.__wlRouter && window.__wlRouter !== ME) location.reload();
window.__wlRouter = ME;
async function run() {
  if (window.__wlRouter !== ME) return;
  const name = document.body.dataset.page;
  if (!name || !/^[a-z]+$/.test(name)) return;
  // Tabs built as modules keep their script in public/modules/<name>/client.js (src/modules/README.md)
  const mod = await import('module' in document.body.dataset ? `/modules/${name}/client.js` : `/assets/${name}.js`);
  await mod.default();
}
document.addEventListener('astro:page-load', run);
