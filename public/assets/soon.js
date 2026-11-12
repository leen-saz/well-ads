// صفحة التاب اللي لسا ما جهز: اسمه، وتاق "قريباً"، ووش بيسوي لما يجهز.
import { $, esc, shell, LANG, api } from './common.js';

// Runs on every visit of this page (assets/router.js calls it after each ClientRouter navigation).
export default async function mount() {

  const en = LANG === 'en';
  const q = new URLSearchParams(location.search), why = q.get('why');
  const me = await api('/api/account/password');
  const mods = me.modules || [];
  if (why) return closed(me, mods.find(x => x.key === q.get('t')), why);
  const soon = mods.filter(m => m.status === 'soon');
  const s = soon.find(x => x.key === q.get('t')) || soon[0];
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

// A section that is off for the company, or that this user has no access to: what it is, why it is closed, and the way back
async function closed(me, m, why) {
  const en = LANG === 'en', owner = me.role === 'owner';
  const name = m ? (en ? m.en : m.ar) : (en ? 'This section' : 'هذا القسم');
  document.title = name + ' · Well';
  const label = why === 'noaccess' ? (en ? 'No access' : 'ما عندك صلاحية') : (en ? 'Not enabled' : 'غير مفعّل');
  await shell({ active: '', title: name, badge: `<span class="chip">${label}</span>` });
  const line = why === 'noaccess' ? (en ? 'You do not have access to this section.' : 'ما عندك صلاحية على هذا القسم.')
    : why === 'company' ? (en ? 'This section is not available for your company yet.' : 'هذا القسم مو متاح لشركتك للحين.')
    : (en ? 'This section is not enabled for your company right now.' : 'هذا القسم مو مفعّل لشركتك الحين.');
  const next = owner ? (why === 'locked' ? (en ? 'You can enable it from the sections page.' : 'تقدر تفعّله من صفحة الأقسام.') : '')
    : (en ? 'Ask the account owner if you need it.' : 'تواصل مع مالك الحساب لو تحتاجه.');
  $('#content').innerHTML = `<section class="card sn" role="status">
    <h2>${esc(line)}</h2>${next ? `<p class="muted" style="margin:0">${esc(next)}</p>` : ''}
    ${m && (en ? m.doesEn : m.does)?.length ? `<h3 style="margin:18px 0 0;font-size:14px">${en ? 'What it does' : 'وش يسوي'}</h3><ul>${(en ? m.doesEn : m.does).map(d => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
    <div class="bar" style="margin-top:20px"><a class="btn primary" href="/today/">${en ? 'Back to Today' : 'رجوع لملخص اليوم'}</a>${owner && why === 'locked' ? `<a class="btn secondary" href="/admin/modules/">${en ? 'Sections' : 'الأقسام'}</a>` : ''}</div>
  </section>`;
}
