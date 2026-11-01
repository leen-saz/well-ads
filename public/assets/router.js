// One script for every Astro page: after each navigation (and the first load) it runs the page's own
// module, named by <body data-page>. Modules load once; their default export mount() runs on every visit.
async function run() {
  const name = document.body.dataset.page;
  if (!name || !/^[a-z]+$/.test(name)) return;
  const mod = await import(`/assets/${name}.js`);
  await mod.default();
}
document.addEventListener('astro:page-load', run);
