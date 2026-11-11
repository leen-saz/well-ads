// الميديا باير: يقرأ التوصيات من /api/buyer/report ويعرضها مرتبة: وش يتغير، ليش، المخاطر، مقياس النجاح، ومن ينفّذ.
import { $, api, say, esc, shell, busy, fmt, when, failure } from '/assets/common.js';

const PLAT = { meta: 'ميتا', snapchat: 'سناب شات', tiktok: 'تيك توك', google: 'جوجل' };
const KIND = { pause: 'إيقاف', budget_down: 'تخفيض ميزانية', budget_up: 'توسيع ميزانية', refresh_creative: 'مادة جديدة', hold: 'انتظر', review: 'افحص', shift_budget: 'نقل ميزانية', schedule: 'جدولة', resume: 'تشغيل' };
const SEV = { fine: 'تمام', watch: 'انتبه', problem: 'مشكلة', disaster: 'كارثة', na: 'ما ينحكم' };
const OWNER = { media_buyer: 'المشتري الإعلامي', video_agent: 'إيجنت الفيديو الإعلاني', production: 'الإنتاج', landing: 'صفحة الهبوط' };

export default async function mount() {
  async function load(btn) {
    busy(btn, true);
    try {
      const r = await api('/api/buyer/report');
      const P = Object.entries(r.platforms || {});
      $('#sum').innerHTML = `<div class="card"><b>${fmt((r.recs || []).length)}</b><span>توصية</span></div>`
        + P.map(([p, v]) => `<div class="card"><b>${v.cpl == null ? '—' : fmt(Math.round(v.cpl))}</b><span>تكلفة الليد في ${esc(PLAT[p] || p)} · ${esc(SEV[v.judgeCpl] || '')}</span></div>`).join('');
      const R = r.recs || [];
      $('#list').innerHTML = R.length ? R.map(x => `<article class="card by-r ${esc(x.kind)}">
          <div class="by-tags"><span class="by-tag">${esc(KIND[x.kind] || '')}</span><span class="by-tag">${esc(PLAT[x.platform] || x.platform)}</span><span class="by-tag">ينفّذ: ${esc(OWNER[x.owner] || '')}</span>${x.judge ? `<span class="by-tag">الحكم: ${esc(SEV[x.judge.level] || '')}</span>` : ''}</div>
          <h3>${esc(x.title)}</h3>
          <div class="by-do"><b>وش يتغير:</b> ${esc(x.change)}</div>
          <dl><div><dt>ليش:</dt> <dd>${esc(x.why)}</dd></div><div><dt>المخاطر:</dt> <dd>${esc(x.risk)}</dd></div>
          <div><dt>مقياس النجاح:</dt> <dd>${esc(x.success.metric)}: ${esc(x.success.goal)}. نتحقق بعد ${esc(x.success.checkAfterDays.join(' و'))} أيام.</dd></div>
          ${x.followUp ? `<div><dt>مهمة متابعة:</dt> <dd>${esc(x.followUp)}</dd></div>` : ''}
          ${x.open ? `<div><dt>قرار مفتوح عند لين:</dt> <dd>${esc(x.open)}</dd></div>` : ''}</dl>
          <ul>${(x.evidence || []).map(e => `<li>${esc(e)}</li>`).join('')}</ul></article>`).join('')
        : `<div class="card pad" style="text-align:center"><b>${esc(r.note || 'ما فيه توصية الحين.')}</b><p class="muted" style="margin:6px 0 0">الأرقام ضمن القاعدة، وما فيه تغيير مطلوب.</p></div>`;
      const G = r.gated || [];
      $('#gated').hidden = !G.length;
      $('#gatedList').innerHTML = G.map(g => `<li>${esc(PLAT[g.platform] || g.platform)}${g.campaign ? ' · ' + esc(g.campaign) : ''}: ${esc(g.reason)}</li>`).join('');
      say($('#msg'), `آخر تحليل: ${when(r.checked_at)}`, true);
    } catch (err) { failure($('#list'), err, () => load()); }
    busy(btn, false);
  }
  await shell({ active: 'buyer', title: 'الميديا باير', tools: '<button class="btn sm secondary" type="button" id="again">حلّل من جديد</button>' });
  $('#again')?.addEventListener('click', e => load(e.currentTarget));
  await load();
}
