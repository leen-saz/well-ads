// الميديا باير: التنفيذ بموافقة. الإجراءات المقترحة، «اعتمد وطبّق» مع تأكيد ثانٍ، «ارفض»، تراجع لآخر إجراء، زر الطوارئ، وإعدادات التنفيذ.
// كل نص ثابت هنا في عنصر لحاله (والأرقام في عناصر لحالها) عشان الترجمة الإنجليزية تمسكه. ما يتنفّذ شي من هنا بدون ضغطة الموافق.
import { $, api, say, esc, fmt, busy, pageSignal } from '/assets/common.js';

const PLAT = { meta: 'ميتا', snapchat: 'سناب شات', tiktok: 'تيك توك', google: 'جوجل' };
const LEVEL = { campaign: 'حملة', adset: 'مجموعة إعلانية', ad: 'إعلان' };
const STATUS = {
  proposed: ['ينتظر موافقتك', 'wait'], applying: ['قيد التنفيذ', 'run'], applied: ['نُفّذ', 'ok'], failed: ['فشل', 'bad'], aborted: ['انلغى: القيمة تغيّرت', 'bad'],
  rolled_back: ['تم التراجع عنه', 'back'], rejected: ['مرفوض', 'off'], manual_done: ['نفّذته يدوياً', 'ok'],
};
const BLOCK = {
  kill: 'زر الطوارئ شغّال', manual: 'ينفّذ يدوياً', no_change: 'ما فيه تغيير', bad_value: 'قيمة ناقصة', cap_pct: 'يتجاوز سقف نسبة التغيير', cap_daily: 'يتجاوز السقف اليومي الإجمالي',
  no_daily_cap: 'السقف اليومي الإجمالي غير محدد', cooldown: 'تغيير سابق لنفس الكيان خلال 48 ساعة',
};
const WHY = {
  platform_manual: 'هذي المنصة تنفّذ يدوياً', no_structure: 'توصية ما تنطبق عليها عملية آلية', not_configured: 'مفتاح التنفيذ ما انضاف لهذي المنصة',
  campaign_unknown: 'اسم الحملة غير معروف', not_found: 'ما لقينا الحملة في المنصة', ambiguous: 'أكثر من حملة بنفس الاسم', no_budget_entity: 'ما قدرنا نحدد مكان الميزانية', read_failed: 'ما قدرنا نقرأ المنصة',
};
let state = null, onChange = () => {};

const chip = (txt, cls = '') => `<span class="by-tag ${cls}">${esc(txt)}</span>`;
const dot = s => { const [txt, c] = STATUS[s] || ['', 'off']; return `<span class="by-st ${c}"><i></i><span>${esc(txt)}</span></span>`; };
const num = v => (v == null ? '—' : fmt(v, v % 1 ? 2 : 0));
const sgn = v => `${v > 0 ? '+' : ''}${fmt(v, 2)}`;

function change(c) {
  if (c.op === 'budget') {
    if (c.from == null) return `<div class="by-chg"><span>ميزانية يومية</span> <b dir="ltr">${c.pct > 0 ? '+' : ''}${fmt(c.pct, 1)}%</b></div>`;
    return `<div class="by-chg"><span>ميزانية يومية</span> <b dir="ltr">${num(c.from)} ← ${num(c.to)}</b> <small dir="ltr">${sgn(c.to - c.from)} (${c.pct > 0 ? '+' : ''}${fmt(c.pct, 1)}%)</small></div>`;
  }
  if (c.op === 'status') return `<div class="by-chg"><span>الحالة</span> <b>${c.from ? esc(c.from === 'active' ? 'شغّال' : 'متوقف') + ' ← ' : ''}${esc(c.to === 'paused' ? 'متوقف' : 'شغّال')}</b></div>`;
  return `<div class="by-chg"><span>تعليمات</span> <b>${esc(c.text)}</b></div>`;
}

function card(a, can, last) {
  const g = a.guards || {}, blocks = (g.blocks || []).filter(b => !(a.mode === 'manual' && b.code === 'manual'));
  const manual = a.mode === 'manual', open = a.status === 'proposed';
  const tags = [chip(PLAT[a.platform] || a.platform), chip(LEVEL[a.level] || a.level), manual ? chip('نفّذه يدوياً', 'by-manual') : open ? chip(g.live ? 'تنفيذ حقيقي جاهز' : 'تجربة بدون تنفيذ', g.live ? 'by-live' : '') : ''].join('');
  const impact = g.impact && a.change.op === 'budget' && a.change.from != null ? `<div><dt>الأثر المالي:</dt> <dd dir="ltr">${sgn(g.impact.dayDelta)} / <span>يومياً</span>، ${sgn(g.impact.weekDelta)} / <span>أسبوعياً</span></dd></div>` : '';
  const btns = open && can.approve
    ? (manual ? `<button class="btn sm" type="button" data-done="${esc(a.id)}">نفّذته يدوياً</button>` : `<button class="btn sm" type="button" data-apply="${esc(a.id)}">اعتمد وطبّق</button>`) + `<button class="btn sm secondary" type="button" data-reject="${esc(a.id)}">ارفض</button>`
    : last && can.approve ? `<button class="btn sm secondary" type="button" data-back="${esc(a.id)}">تراجع عن هذا الإجراء</button>` : '';
  return `<article class="card by-r by-a ${esc(a.status)}"><div class="by-tags">${dot(a.status)}${tags}</div>
    <h3>${esc(a.entity_name || '—')}</h3>${change(a.change)}
    <dl>${impact}<div><dt>السبب:</dt> <dd>${esc(a.reason)}</dd></div>${a.risk ? `<div><dt>المخاطر:</dt> <dd>${esc(a.risk)}</dd></div>` : ''}
    ${a.success?.metric ? `<div><dt>مقياس النجاح:</dt> <dd>${esc(a.success.metric)}: ${esc(a.success.goal)}</dd></div>` : ''}
    ${manual && a.manual_why ? `<div><dt>ليش يدوي:</dt> <dd>${esc(WHY[a.manual_why] || '')}</dd></div>` : ''}</dl>
    ${open && blocks.length ? `<ul class="by-block">${blocks.map(b => `<li>${esc(BLOCK[b.code] || '')}${b.detail != null ? ` <span dir="ltr">${esc(String(b.detail))}${b.code === 'cap_pct' ? '%' : ''}</span>` : ''}</li>`).join('')}</ul>` : ''}
    ${a.dry_run && open ? `<p class="muted by-dry">آخر تجربة بدون تنفيذ: ما تغيّر شي${a.dry_run.stale ? '، والقيمة في المنصة تغيّرت' : ''}</p>` : ''}
    ${btns ? `<div class="bar by-btns">${btns}</div>` : ''}</article>`;
}

function render() {
  const { actions, settings: s, can, missing } = state;
  const ws = $('#by-execBox'); ws.hidden = false;
  if (missing) { $('#by-execStateMsg').innerHTML = `<p class="muted">${esc(state.message)}</p>`; $('#by-actions').innerHTML = ''; $('#by-execCtl').hidden = true; return; }
  $('#by-execCtl').hidden = false; $('#by-execStateMsg').innerHTML = '';
  $('#by-killBanner').hidden = !s.kill;
  const plats = ['meta', 'snapchat'];
  $('#by-execState').innerHTML = plats.map(p => `<div class="by-plat"><b>${esc(PLAT[p])}</b>
      <span class="by-st ${s.configured[p] ? 'ok' : 'off'}"><i></i><span>${s.configured[p] ? 'مفتاح التنفيذ مضاف' : 'مفتاح التنفيذ ناقص'}</span></span>
      <span class="by-st ${s.live[p] ? 'bad' : 'wait'}"><i></i><span>${s.live[p] ? 'تنفيذ حقيقي' : 'تجربة بدون تنفيذ'}</span></span>
      ${can.owner ? `<button class="btn sm secondary" type="button" data-live="${p}" data-on="${s.live[p] ? 0 : 1}" ${!s.live[p] && !s.configured[p] ? 'disabled' : ''}>${s.live[p] ? 'ارجع للتجربة بدون تنفيذ' : 'فعّل التنفيذ الحقيقي'}</button>` : ''}</div>`).join('')
    + `<div class="by-plat"><b>تيك توك وجوجل</b><span class="by-st off"><i></i><span>ينفّذ يدوياً</span></span></div>`;
  $('#by-execLimits').innerHTML = `<span>سقف التغيير للإجراء</span> <b dir="ltr">${fmt(s.maxPct)}%</b> · <span>السقف اليومي الإجمالي</span> <b dir="ltr">${s.dailyCap == null ? '—' : fmt(s.dailyCap)}</b> · <span>المستهلك اليوم</span> <b dir="ltr">${fmt(state.usedToday, 2)}</b>`;
  $('#by-limitsForm').hidden = !can.owner;
  const lastId = actions.filter(a => a.status === 'applied').sort((x, y) => String(y.applied_at).localeCompare(String(x.applied_at)))[0]?.id;
  $('#by-actions').innerHTML = actions.length ? actions.map(a => card(a, can, a.id === lastId)).join('') : '<div class="card pad muted" style="text-align:center">ما فيه إجراءات مقترحة بعد. حوّل التوصيات لإجراءات من الأعلى.</div>';
}

async function reload() {
  const r = await api('/api/buyer/actions');
  state = r; render();
}

// ---- the confirmation dialog: the second confirmation, with the money summary
function dialog(a) {
  const dlg = $('#by-dlg'), g = a.guards || {}, s = state.settings, c = a.change;
  const blocked = (g.blocks || []).length > 0, liveOk = g.live && !blocked;
  const rows = [
    ['المنصة', esc(PLAT[a.platform])], ['النوع', esc(LEVEL[a.level])], ['الكيان', esc(a.entity_name || '—')],
    ...(c.op === 'budget' ? [
      ['القيمة الحالية (ميزانية يومية)', `<b dir="ltr">${num(c.from)}</b>`], ['القيمة الجديدة', `<b dir="ltr">${num(c.to)}</b>`],
      ['الفرق اليومي', `<b dir="ltr">${sgn(g.impact.dayDelta)}</b>`], ['الفرق خلال أسبوع لو بقي', `<b dir="ltr">${sgn(g.impact.weekDelta)}</b>`],
      ['نسبة التغيير', `<b dir="ltr">${c.pct > 0 ? '+' : ''}${fmt(c.pct, 1)}%</b> <small>(<span>السقف</span> <span dir="ltr">${fmt(s.maxPct)}%</span>)</small>`],
      ['المستهلك من السقف اليومي', `<b dir="ltr">${fmt(g.impact.dailyUsed, 2)} / ${s.dailyCap == null ? '—' : fmt(s.dailyCap)}</b>`],
    ] : [['الحالة الحالية', esc(c.from === 'active' ? 'شغّال' : c.from === 'paused' ? 'متوقف' : '—')], ['الحالة الجديدة', esc(c.to === 'paused' ? 'متوقف' : 'شغّال')]]),
  ];
  dlg.innerHTML = `<h2 style="margin:0 0 4px">تأكيد الإجراء</h2><p class="muted" style="margin:0 0 12px">راجع الأثر قبل ما تأكّد. ما يتنفّذ شي إلا بضغطتك.</p>
    <dl class="by-sum2">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
    ${blocked ? `<ul class="by-block">${g.blocks.map(b => `<li>${esc(BLOCK[b.code] || '')}</li>`).join('')}</ul>` : ''}
    <div class="by-mode ${liveOk ? 'live' : ''}"><b>${liveOk ? 'التنفيذ الحقيقي مفعّل لهذي المنصة' : g.live ? 'التنفيذ الحقيقي موقوف بسبب الحواجز فوق' : 'التنفيذ الحقيقي مقفل لهذي المنصة: المتاح تجربة بدون تنفيذ'}</b></div>
    <label class="by-ack" ${liveOk ? '' : 'hidden'}><input type="checkbox" id="by-ack"> <span>أفهم إن هذا يغيّر الحساب الإعلاني فعلياً</span></label>
    <div id="by-dlgOut" class="muted" role="status"></div>
    <div class="bar" style="margin:14px 0 0;justify-content:flex-end;gap:8px"><button class="btn secondary" type="button" id="by-dlgCancel">إلغاء</button><button class="btn secondary" type="button" id="by-dlgDry">جرّب بدون تنفيذ</button><button class="btn danger" type="button" id="by-dlgLive" disabled ${liveOk ? '' : 'hidden'}>أكّد وطبّق فعلياً</button></div>`;
  const out = $('#by-dlgOut', dlg), go = async (mode, btn) => {
    busy(btn, true); out.textContent = '';
    try {
      const r = await api('/api/buyer/apply', { method: 'POST', body: { id: a.id, confirm: true, mode, expect: { from: c.from ?? null, to: c.to ?? null } } });
      if (r.dry) {
        out.innerHTML = `<p><b>ما تغيّر شي. هذي معاينة بس.</b></p><ul>${r.stale ? '<li>القيمة في المنصة اختلفت عن اللي ظهر لك</li>' : ''}${(r.blocks || []).map(b => `<li>${esc(BLOCK[b] || '')}</li>`).join('')}${!r.stale && !(r.blocks || []).length ? '<li>القيمة الحالية في المنصة مطابقة، وما فيه حاجز</li>' : ''}</ul>`;
        await reload();
      } else { dlg.close(); say($('#by-msg'), 'تم التنفيذ وتأكدنا من القيمة الجديدة', true); await reload(); onChange(); }
    } catch (err) { out.textContent = err.message; await reload().catch(() => {}); }
    busy(btn, false);
  };
  $('#by-ack', dlg).addEventListener('change', e => { $('#by-dlgLive', dlg).disabled = !e.target.checked; });
  $('#by-dlgCancel', dlg).addEventListener('click', () => dlg.close());
  $('#by-dlgDry', dlg).addEventListener('click', e => go('dry', e.currentTarget));
  $('#by-dlgLive', dlg).addEventListener('click', e => go('live', e.currentTarget));
  dlg.showModal();
}

export async function mountExec({ afterChange } = {}) {
  onChange = afterChange || (() => {});
  // Hidden only for someone with no access (403). Any other failure (a network blip, a server error) says so instead of looking like «no access».
  try { await reload(); } catch (err) {
    if (err?.status === 403) return;
    say($('#by-msg'), err?.message || 'ما قدرت أقرأ إجراءات التنفيذ، جرّب بعد شوي');
    return;
  }
  const act = async (fn, btn, okMsg) => { busy(btn, true); try { await fn(); if (okMsg) say($('#by-msg'), okMsg, true); await reload(); } catch (err) { say($('#by-msg'), err.message); await reload().catch(() => {}); } busy(btn, false); };
  // One emergency stop for everything: the board's own button (public/assets/control.js). It tells this pane to reread the state.
  window.addEventListener('buyer-reload', () => { reload().catch(() => {}); }, { signal: pageSignal() });
  document.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || !$('#by-execBox') || !$('#by-execBox').contains(b)) return;
    const id = b.dataset.apply || b.dataset.reject || b.dataset.done || b.dataset.back;
    if (b.dataset.apply) { const a = state.actions.find(x => x.id === id); if (a) dialog(a); }
    else if (b.dataset.reject) act(() => api('/api/buyer/decide', { method: 'POST', body: { id, decision: 'reject' } }), b, 'انرفض الإجراء');
    else if (b.dataset.done) act(() => api('/api/buyer/decide', { method: 'POST', body: { id, decision: 'manual_done' } }), b, 'انسجّل إنك نفّذته يدوياً');
    else if (b.dataset.back) {
      const dlg = $('#by-dlg');
      dlg.innerHTML = `<h2 style="margin:0 0 8px">تراجع عن آخر إجراء</h2><p class="muted">نرجّع القيمة السابقة بشرط إن المنصة ما تغيّرت بعد تنفيذنا. تأكيدك مطلوب.</p><div id="by-dlgOut" class="muted"></div>
        <div class="bar" style="margin:14px 0 0;justify-content:flex-end;gap:8px"><button class="btn secondary" type="button" id="by-dlgCancel">إلغاء</button><button class="btn danger" type="button" id="by-dlgBack">أكّد التراجع</button></div>`;
      $('#by-dlgCancel', dlg).addEventListener('click', () => dlg.close());
      $('#by-dlgBack', dlg).addEventListener('click', async ev => { busy(ev.currentTarget, true); try { await api('/api/buyer/rollback', { method: 'POST', body: { id, confirm: true } }); dlg.close(); say($('#by-msg'), 'تم التراجع', true); await reload(); onChange(); } catch (err) { $('#by-dlgOut', dlg).textContent = err.message; busy(ev.currentTarget, false); } });
      dlg.showModal();
    }
    else if (b.dataset.live) act(() => api('/api/buyer/execution', { method: 'POST', body: { live: { platform: b.dataset.live, on: b.dataset.on === '1' } } }), b);
  }, { signal: pageSignal() });
  $('#by-limitsSave').addEventListener('click', e => act(() => {
    const body = {}, p = $('#by-limPct').value.trim(), d = $('#by-limDaily').value.trim();
    if (p) body.maxPct = Number(p); if (d) body.dailyCap = Number(d);
    if (!Object.keys(body).length) throw new Error('اكتب قيمة وحدة على الأقل');
    return api('/api/buyer/execution', { method: 'POST', body });
  }, e.currentTarget, 'انحفظت الحدود'));
  $('#by-proposeAll').addEventListener('click', e => act(async () => { const r = await api('/api/buyer/propose', { method: 'POST', body: { all: true } }); say($('#by-msg'), r.count ? 'انضافت الإجراءات المقترحة' : 'ما فيه توصية تتحول لإجراء', !!r.count); }, e.currentTarget));
}

// One recommendation → one proposed action
export async function proposeOne(recId, btn) {
  busy(btn, true);
  try { const r = await api('/api/buyer/propose', { method: 'POST', body: { rec_id: recId } }); say($('#by-msg'), r.existing ? 'الإجراء موجود من قبل' : r.mode === 'manual' ? 'انضاف كإجراء ينفّذ يدوياً' : 'انضاف كإجراء ينتظر موافقتك', true); await reload(); $('#by-execBox')?.scrollIntoView({ behavior: 'smooth' }); }
  catch (err) { say($('#by-msg'), err.message); }
  busy(btn, false);
}
