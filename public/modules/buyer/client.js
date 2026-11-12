// الميديا باير: يقرأ التوصيات من /api/buyer/report ويعرضها مرتبة: وش يتغير، ليش، المخاطر، مقياس النجاح، ومن ينفّذ.
import { $, api, say, esc, busy, fmt, when, failure } from '/assets/common.js';
import { mountExec, proposeOne } from '/modules/buyer/exec.js';

const PLAT = { meta: 'ميتا', snapchat: 'سناب شات', tiktok: 'تيك توك', google: 'جوجل' };
const KIND = { pause: 'إيقاف', budget_down: 'تخفيض ميزانية', budget_up: 'توسيع ميزانية', refresh_creative: 'مادة جديدة', hold: 'انتظر', review: 'افحص', shift_budget: 'نقل ميزانية', schedule: 'جدولة', resume: 'تشغيل' };
const SEV = { fine: 'تمام', watch: 'انتبه', problem: 'مشكلة', disaster: 'كارثة', na: 'ما ينحكم' };
const OWNER = { media_buyer: 'المشتري الإعلامي', video_agent: 'إيجنت الفيديو الإعلاني', production: 'الإنتاج', landing: 'صفحة الهبوط' };

// The recommendations and the approved-execution layer, in whatever page holds the pane (the decisions board). Runs once per
// page visit; the button inside the pane reloads the analysis.
export async function mountPane() {
  const root = $('#buyerPane'); if (root) root.hidden = false;
  async function load(btn) {
    busy(btn, true);
    try {
      const r = await api('/api/buyer/report');
      const P = Object.entries(r.platforms || {});
      $('#by-sum').innerHTML = `<div class="card"><b>${fmt((r.recs || []).length)}</b><span>توصية</span></div>`
        + P.map(([p, v]) => `<div class="card"><b>${v.cpl == null ? '—' : fmt(Math.round(v.cpl))}</b><span>تكلفة الليد في ${esc(PLAT[p] || p)} · ${esc(SEV[v.judgeCpl] || '')}</span></div>`).join('');
      const R = r.recs || [];
      $('#by-list').innerHTML = R.length ? R.map(x => `<article class="card by-r ${esc(x.kind)}">
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
      $('#by-gated').hidden = !G.length;
      $('#by-gatedList').innerHTML = G.map(g => `<li>${esc(PLAT[g.platform] || g.platform)}${g.campaign ? ' · ' + esc(g.campaign) : ''}: ${esc(g.reason)}</li>`).join('');
      say($('#by-msg'), `آخر تحليل: ${when(r.checked_at)}`, true);
    } catch (err) { failure($('#by-list'), err, () => load()); }
    busy(btn, false);
  }
  $('#by-refresh')?.addEventListener('click', e => load(e.currentTarget));
  $('#by-list').addEventListener('click', e => { const b = e.target.closest('[data-propose]'); if (b) proposeOne(b.dataset.propose, b); });
  await load();
  mountExec();
  outcomes();
}

// What happened after each action Leen took: measured now for what is due, then shown. The proposals to change a rule are counts
// only and go into a development PR, never straight into the rules.
const RES = { worked: 'نجحت', no_change: 'ما تغيّر شي', worse: 'أسوأ', unclear: 'عينة صغيرة' };
const RULE = { scale_up: 'توسيع', stop_cpl: 'إيقاف', zero_leads: 'صرف بلا ليد', fatigue: 'تعب المادة', low_ctr: 'نقر ضعيف', page_leak: 'تسرّب الصفحة', shift_budget: 'نقل ميزانية', placement_gap: 'مواضع ميتا', weekday_gap: 'أيام الأسبوع', few_creatives: 'مواد قليلة', company: 'قاعدة الشركة', learning_hold: 'انتظر' };
async function outcomes() {
  try { await api('/api/buyer/outcomes', { method: 'POST' }); } catch { /* viewing only: nothing to measure from here */ }
  let r; try { r = await api('/api/buyer/outcomes'); } catch { return; }
  if (r.missing) return;
  const box = $('#by-outBox'); if (!box) return;
  box.hidden = false;
  const rows = r.rows || [], num = v => (v == null ? '—' : fmt(Math.round(v * 10) / 10)), pair = (a, b) => `<span dir="ltr">${num(a)} ← ${num(b)}</span>`;
  $('#by-outInfo').textContent = rows.length ? `${rows.length} نتيجة مقاسة. تيك توك يُحكم عليه بنسبة النقر مو بالليدز.` : 'ما فيه نتائج بعد. تظهر بعد 3 أيام من أول إجراء تنفّذه.';
  $('#by-outTable').innerHTML = rows.length ? '<thead><tr><th>الحملة</th><th>القاعدة</th><th>اليوم</th><th>النتيجة</th><th>تكلفة الليد</th><th>نسبة النقر %</th><th>الصرف</th></tr></thead><tbody>'
    + rows.map(x => `<tr><td>${esc(x.entity || '—')}</td><td>${esc(RULE[x.rec_rule] || x.rec_rule || '—')} · ${esc(PLAT[x.platform] || x.platform)}</td><td class="n">${esc(x.day)}</td><td>${esc(RES[x.result] || '')}</td>`
      + `<td>${x.platform === 'tiktok' ? '—' : pair(x.before.cpl, x.after.cpl)}</td><td>${pair(x.before.ctr, x.after.ctr)}</td><td>${pair(x.before.spend, x.after.spend)}</td></tr>`).join('') + '</tbody>' : '';
  const T = (r.tuning || []).filter(t => t.n > 0);
  $('#by-tuning').innerHTML = T.length ? '<h3 style="margin:0 0 6px">وش تقول النتائج عن القواعد</h3><ul class="muted">' + T.map(t => `<li>${esc(RULE[t.rule] || t.rule)}: نجحت ${esc(t.worked)} من ${esc(t.n)} نتيجة بعد 7 أيام${t.proposal ? '. ' + esc(t.proposal) : ''}</li>`).join('') + '</ul>' : '';
  const copy = $('#by-tuneCopy'); copy.hidden = !T.length;
  copy.onclick = async () => {
    const text = '## نتائج توصيات الميديا باير (أعداد فقط)\n' + T.map(t => `- ${t.rule}: ${t.worked} نجحت من ${t.n}، ${t.worse} أسوأ${t.proposal ? '. اقتراح: ' + t.proposal : ''}`).join('\n');
    try { await navigator.clipboard.writeText(text); say($('#by-msg'), 'اننسخ الملخص: ألصقه في وصف الـPR التطويري', true); } catch { say($('#by-msg'), text); }
  };
}

