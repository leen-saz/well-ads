// التتبع: يقرأ تقرير صحة التتبع من /api/debugger/report ويعرض المشاكل مرتبة حسب الخطورة، ولكل وحدة حلها.
import { $, api, say, esc, shell, busy, fmt, when } from '/assets/common.js';

const LEVEL = { critical: 'خطير', warn: 'تنبيه', info: 'معلومة' };
const PLAT = { meta: 'ميتا', snapchat: 'سناب شات', tiktok: 'تيك توك', google: 'جوجل' };

export default async function mount() {
  async function load(btn) {
    busy(btn, true);
    try {
      const r = await api('/api/debugger/report');
      const s = r.summary || {};
      $('#sum').innerHTML = [['critical', 'خطير'], ['warn', 'تنبيه'], ['info', 'معلومة']].map(([k, l]) => `<div class="card"><b>${fmt(s[k] || 0)}</b><span>${l}</span></div>`).join('')
        + `<div class="card"><b>${fmt(r.counts?.leads || 0)}</b><span>ليد في الـ CRM آخر 30 يوم</span></div>`;
      const P = Object.entries(r.platforms || {});
      $('#plat').innerHTML = P.length ? `<thead><tr><th>المنصة</th><th>الصرف</th><th>ليدز المنصة</th><th>ليدز الـ CRM</th><th>آخر يوم فيه أرقام</th></tr></thead><tbody>`
        + P.map(([p, v]) => `<tr><td>${esc(PLAT[p] || p)}</td><td class="n">${fmt(v.spend7)}</td><td class="n">${fmt(v.leads7)}</td><td class="n">${fmt(v.crm7)}</td><td class="n">${esc(v.lastDay || '—')}</td></tr>`).join('') + '</tbody>'
        : '<tbody><tr><td class="muted">ما فيه أرقام آخر 14 يوم.</td></tr></tbody>';
      const F = r.findings || [];
      $('#list').innerHTML = F.length ? F.map(f => `<article class="card dg-f ${f.level}"><span class="dg-tag">${LEVEL[f.level] || ''}</span>
          <h3>${esc(f.title)}</h3><p class="muted">${esc(f.detail)}</p><div class="dg-fix"><b>الحل:</b> ${esc(f.fix)}</div></article>`).join('')
        : '<div class="card dg-ok"><b>ما لقيت مشاكل في التتبع.</b><p class="muted" style="margin:6px 0 0">الأرقام توصل من كل المنصات والليدز مربوطة بإعلاناتها.</p></div>';
      say($('#msg'), `آخر فحص: ${when(r.checked_at)}`, true);
    } catch (err) { $('#list').innerHTML = ''; say($('#msg'), err.message); }
    busy(btn, false);
  }
  await shell({ active: 'debugger', title: 'التتبع', tools: '<button class="btn sm secondary" type="button" id="again">افحص من جديد</button>' });
  $('#again')?.addEventListener('click', e => load(e.currentTarget));
  await load();
}
