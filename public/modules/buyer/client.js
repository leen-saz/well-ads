// الميديا باير: يقرأ التوصيات من /api/buyer/report ويعرضها مرتبة: وش يتغير، ليش، المخاطر، مقياس النجاح، ومن ينفّذ.
import { $, api, say, esc, shell, busy, fmt, when, failure } from '/assets/common.js';
import { mountExec, proposeOne } from '/modules/buyer/exec.js';

const PLAT = { meta: 'ميتا', snapchat: 'سناب شات', tiktok: 'تيك توك', google: 'جوجل' };
const KIND = { pause: 'إيقاف', budget_down: 'تخفيض ميزانية', budget_up: 'توسيع ميزانية', refresh_creative: 'مادة جديدة', hold: 'انتظر', review: 'افحص', shift_budget: 'نقل ميزانية', schedule: 'جدولة', resume: 'تشغيل' };
const SEV = { fine: 'تمام', watch: 'انتبه', problem: 'مشكلة', disaster: 'كارثة', na: 'ما ينحكم' };
const KINDS = { scale: 'رفع ميزانية', stop_idle: 'إيقاف بلا نتائج', resume: 'تشغيل', reduce: 'تقليل', replace_creative: 'مادة جديدة', alert_stalled: 'تنبيه توقف الصرف' };
const LIMIT = r => [r.maxCpl != null && `تكلفة الليد ≤ ${r.maxCpl}`, r.minCtr != null && `النقر ≥ ${r.minCtr}%`, r.stepPct != null && `خطوة ${r.stepPct}%`, r.everyDays != null && `كل ${r.everyDays} أيام`, r.minIdleDays != null && `${r.minIdleDays} يوم`].filter(Boolean).join('، ') || '—';
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
          <div class="by-tags"><span class="by-tag">${esc(KIND[x.kind] || '')}</span><span class="by-tag">${esc(PLAT[x.platform] || x.platform)}</span>${x.open ? '<span class="by-tag by-open">مفتوح: يحتاج قرار لين</span>' : ''}<span class="by-tag">ينفّذ: ${esc(OWNER[x.owner] || '')}</span>${x.judge ? `<span class="by-tag">الحكم: ${esc(SEV[x.judge.level] || '')}</span>` : ''}</div>
          <h3>${esc(x.title)}</h3>
          <div class="by-do"><b>وش يتغير:</b> ${esc(x.change)}</div>
          <dl><div><dt>ليش:</dt> <dd>${esc(x.why)}</dd></div><div><dt>المخاطر:</dt> <dd>${esc(x.risk)}</dd></div>
          <div><dt>مقياس النجاح:</dt> <dd>${esc(x.success.metric)}: ${esc(x.success.goal)}. نتحقق بعد ${esc(x.success.checkAfterDays.join(' و'))} أيام.</dd></div>
          ${x.followUp ? `<div><dt>مهمة متابعة:</dt> <dd>${esc(x.followUp)}</dd></div>` : ''}
          ${x.open ? `<div><dt>قرار مفتوح عند لين:</dt> <dd>${esc(x.open)}</dd></div>` : ''}</dl>
          <ul>${(x.evidence || []).map(e => `<li>${esc(e)}</li>`).join('')}</ul>
          ${x.act || x.kind === 'shift_budget' ? `<div class="bar by-btns"><button class="btn sm secondary" type="button" data-propose="${esc(x.id)}">جهّز إجراء مقترح</button></div>` : ''}</article>`).join('')
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
  $('#list').addEventListener('click', e => { const b = e.target.closest('[data-propose]'); if (b) proposeOne(b.dataset.propose, b); });
  await load();
  mountExec();
  rules();
}

// The company's rules: import (file or pasted text) with a preview from the server's own validation, then save; export.
async function rules() {
  let cur;
  try { cur = await api('/api/buyer/rules'); } catch { return; }          // no access: the section stays hidden
  $('#rulesBox').hidden = false;
  const info = list => { $('#rulesInfo').textContent = list.length ? `القواعد المحفوظة: ${list.length}، ومنها ${list.filter(r => r.open).length} مفتوحة تنتظر قرار لين.` : 'ما فيه قواعد محفوظة بعد. استورد ملف القواعد.'; };
  info(cur.rules || []);
  $('#rulesImport').addEventListener('click', () => { $('#rulesForm').hidden = !$('#rulesForm').hidden; });
  $('#rulesExport').addEventListener('click', async () => {
    const r = await api('/api/buyer/rules');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify({ rules: r.rules || [] }, null, 1)], { type: 'application/json' }));
    a.download = 'buyer-rules.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  $('#rulesFile').addEventListener('change', async e => { const f = e.target.files?.[0]; if (f) $('#rulesText').value = await f.text(); });
  $('#rulesPreview').addEventListener('click', async e => {
    const btn = e.currentTarget, box = $('#rulesPrev'); busy(btn, true);
    try {
      let body; try { body = JSON.parse($('#rulesText').value); } catch { throw new Error('النص مو JSON صحيح'); }
      const list = Array.isArray(body) ? body : body.rules;
      const r = await api('/api/buyer/rules', { method: 'POST', body: { rules: list, dry: true } });
      box.innerHTML = `<p><b>${fmt(r.rules.length)}</b> قاعدة سليمة، ومنها <b>${fmt(r.rules.filter(x => x.open).length)}</b> مفتوحة.</p>
        <div class="tbl"><table class="by-prev"><thead><tr><th>الاسم</th><th>المنصة</th><th>النوع</th><th>تطابق</th><th>الحدود</th><th>ينفّذ</th><th>مفتوح</th></tr></thead><tbody>`
        + r.rules.map(x => `<tr><td>${esc(x.id)}</td><td>${esc(PLAT[x.platform] || x.platform)}</td><td>${esc(KINDS[x.kind] || x.kind)}</td><td>${esc(x.match.join('، '))}</td><td>${esc(LIMIT(x))}</td><td>${esc(OWNER[x.owner || 'media_buyer'] || '')}</td><td>${x.open ? `<span class="by-tag by-open">مفتوح: يحتاج قرار لين</span> ${esc(x.open)}` : ''}</td></tr>`).join('')
        + `</tbody></table></div><div class="bar" style="margin:10px 0 0"><button class="btn sm" type="button" id="rulesSave">أكّد واحفظ</button></div>`;
      $('#rulesSave').addEventListener('click', async ev => {
        busy(ev.currentTarget, true);
        try {
          await api('/api/buyer/rules', { method: 'POST', body: { rules: r.rules } });
          box.innerHTML = '<p>انحفظت القواعد. التوصيات تتحدّث من أرقام الداشبورد.</p>'; $('#rulesText').value = ''; info(r.rules);
          $('#again')?.click();
        } catch (err) { say($('#msg'), err.message); busy(ev.currentTarget, false); }
      });
    } catch (err) { box.innerHTML = `<p class="muted">${esc(err.message)}</p>`; }
    busy(btn, false);
  });
}
