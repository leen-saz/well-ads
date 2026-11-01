// صفحة التاب اللي لسا ما جهز: اسمه، وتاق "قريباً"، ووش بيسوي لما يجهز.
import { $, esc, shell, LANG, api } from './common.js';

// Runs on every visit of this page (assets/router.js calls it after each ClientRouter navigation).
export default async function mount() {

  const en = LANG === 'en';
  const soon = ((await api('/api/account/password')).modules || []).filter(m => m.status === 'soon');
  const s = soon.find(x => x.key === new URLSearchParams(location.search).get('t')) || soon[0];
  if (!s) return;
  const name = en ? s.en : s.ar;
  document.title = name + ' · Well';
  await shell({ active: 'soon:' + s.key, title: name, badge: `<span class="chip brand">${en ? 'Coming soon' : 'قريباً'}</span>` });
  $('#content').innerHTML = `<section class="card sn">
    <h2>${en ? 'What this tab will do' : 'وش بيسوي هذا التاب'}</h2>
    <ul>${(en ? s.doesEn : s.does).map(d => `<li>${esc(d)}</li>`).join('')}</ul>
    <p class="muted sn-note">${en ? 'Still being built. It will open here once it is ready.' : 'لسا نشتغل عليه، وبينفتح هنا أول ما يجهز.'}</p>
  </section>`;
}
