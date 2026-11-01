// صفحة التاب اللي لسا ما جهز: اسمه، وتاق "قريباً"، ووش بيسوي لما يجهز.
import { $, esc, shell, LANG } from './common.js';
import { SOON } from './tabs.js';

const en = LANG === 'en';
const s = SOON.find(x => x.key === new URLSearchParams(location.search).get('t')) || SOON[0];
const name = en ? s.en : s.ar;
document.title = name + ' · Well';
await shell({ active: 'soon:' + s.key, title: name, badge: `<span class="chip brand">${en ? 'Coming soon' : 'قريباً'}</span>` });
$('#content').innerHTML = `<section class="card sn">
  <h2>${en ? 'What this tab will do' : 'وش بيسوي هذا التاب'}</h2>
  <ul>${(en ? s.doesEn : s.does).map(d => `<li>${esc(d)}</li>`).join('')}</ul>
  <p class="muted sn-note">${en ? 'Still being built. It will open here once it is ready.' : 'لسا نشتغل عليه، وبينفتح هنا أول ما يجهز.'}</p>
</section>`;
