// لوحة القرارات: صندوق قرارات مرتب حسب الأثر بالريال، مع لوحة تفاصيل وقرارات جماعية واختصارات.
// المرحلة الحالية: القرار ينحفظ في السجل بس، وما ينرسل شي للمنصات.
import { $, $$, esc, api, icon, when, day, fmt, sar, shell, toast, busy, t } from './common.js';

const PLAT = { meta: 'Meta', snap: 'Snap', tiktok: 'TikTok', google: 'Google' };
const PRE = { meta: 'm', snap: 's', tiktok: 't', google: 'g' };
const KIND = { new_campaign: 'حملة جديدة', pause: 'إيقاف', pause_campaign: 'إيقاف الحملة', budget_up: 'رفع الميزانية', budget_down: 'تنزيل الميزانية', refresh_creative: 'كرييتف جديد', resume: 'تشغيل (تراجع)' };
const RULE = { pause: 'صرف ضعف الهدف بدون نتيجة', pause_campaign: 'حملة هدفها Traffic', budget_up: 'ليدز أرخص من الهدف بـ 20% أو أكثر', refresh_creative: 'نسبة النقر نزلت 30% أو أكثر' };
const LEVEL = { campaign: 'حملة', adset: 'مجموعة', ad: 'إعلان' };
const STATUS = { approved: 'وافق', rejected: 'رفض', modified: 'وافق بتعديل', executed: 'تنفّذ', failed: 'فشل', expired: 'انتهى' };

const S = { kill: { kill: false }, tab: 'all', q: '', kind: '', level: '', sort: 'impact', open: [], done: [], ads: {}, gen: null, settings: [], owner: false, sel: new Set(), cursor: 0, hist: { status: '' } };

// الأثر بالريال لكل أسبوع: الإيقاف يوفر صرف آخر 7 أيام، والرفع يضيف نسبة منه
function impact(s) {
  const sp = (s.evidence || {}).spend;
  if (sp == null) return null;
  if (s.kind === 'pause' || s.kind === 'pause_campaign') return { v: sp, n: sar(sp), l: 'ر.س/أسبوع توفير', t: `يوفر ~${sar(sp)} ر.س/أسبوع` };
  if (s.kind === 'budget_up') { const v = sp * ((s.params || {}).pct || 0) / 100; return { v, n: `+${sar(v)}`, l: 'ر.س/أسبوع صرف إضافي', t: `+~${sar(v)} ر.س/أسبوع صرف إضافي` }; }
  return null;
}
const adOf = s => S.ads[(PRE[s.platform] || '') + s.target_id] || null;
const ageOf = s => { const a = adOf(s); if (!a || !a.first) return null; return Math.round((Date.now() - new Date(a.first + 'T00:00:00+03:00')) / 864e5); };
// المراجع الثاني: الاقتراح اللي ما عدّى قواعد لين ينرفض بس
const blocked = s => s.critic && s.critic.ok === false ? (s.critic.issues || [])[0] || 'المراجع رفضه' : s.kind === 'new_campaign' && !S.owner ? 'لين بس توافق على الحملات الجديدة' : '';
const criticChip = s => !s.critic ? '' : s.critic.ok ? `<span class="chip line crit" data-tip="عدّى قواعد لين">${icon('check')}المراجع</span>`
  : `<span class="chip line crit bad" data-tip="${esc((s.critic.issues || []).join(' · '))}">${icon('alert')}المراجع رفضه</span>`;
// إعلان واتساب ومعه إعلانات ثانية شغّالة في مجموعته: Meta يرفض إيقافه بمفتاحنا (ما عنده صلاحية واتساب)، فينفّذه الفريق يدوي
const waManual = s => s.platform === 'meta' && s.level === 'ad' && s.kind === 'pause' ? (adOf(s) || {}).wa_siblings || 0 : 0;
const WA_NOTE = n => `إعلان واتساب، وفي مجموعته ${n === 1 ? 'إعلان ثاني شغّال' : n === 2 ? 'إعلانين ثانيين شغّالين' : `${n} إعلانات ثانية شغّالة`}. الإيقاف التلقائي للإعلان الواحد يحتاج صلاحية واتساب لمفتاح الداشبورد، فبعد الموافقة نفّذه يدوي من Ads Manager.`;
const waChip = s => { const n = waManual(s); return n ? `<span class="chip line crit bad" data-tip="${esc(WA_NOTE(n))}">${icon('alert')}يدوي · واتساب</span>` : ''; };
const ruleOf = s => s.source === 'manual' ? `طلب من ${s.requested_by || ''}` : s.source === 'claude' ? 'اقتراح كلود' : (RULE[s.kind] || 'قاعدة');

// ---------- الأعلى
function topTools() {
  const fresh = S.gen ? `<span class="chip" data-tip="آخر سحب للأرقام من المنصات"><span class="dot"></span>آخر تحديث للبيانات ${esc(when(S.gen))}</span>` : '';
  const kill = S.kill.kill
    ? `<button class="btn sm danger" id="killBtn" data-on="0"${S.owner ? '' : ' disabled'} data-tip="${S.owner ? 'إلغاء إيقاف الطوارئ' : 'لين بس تلغي إيقاف الطوارئ'}">${icon('power')}إيقاف الطوارئ مفعّل</button>`
    : `<button class="btn sm secondary" id="killBtn" data-on="1" data-tip="يوقف أي تنفيذ على حسابات الإعلانات فوراً">${icon('power')}إيقاف طوارئ</button>`;
  const n = (S.kill.canary || []).length;
  const exec = S.kill.kill ? '' : n
    ? `<span class="chip solid" data-tip="الموافقة على إيقاف إعلان في Meta تتنفّذ في التحديث الجاي (خلال ساعة)، داخل حملات التجربة بس. الباقي ينفّذه الميديا باير بيده">${icon('check')}التنفيذ شغّال: إيقاف Meta في ${n} ${n === 1 ? 'حملة' : 'حملات'} تجربة</span>`
    : `<span class="chip line" data-tip="ما فيه حملة تجربة، فما يتنفّذ شي في المنصات. لين تختار من حدود التنفيذ">${icon('lock')}التنفيذ مقفل · اختر حملة تجربة</span>`;
  return `${fresh}${exec}${kill}<a class="btn sm primary" href="/control/new/">${icon('pen')}حملة جديدة</a>`;
}
function drawTop() {
  $('#tools').innerHTML = topTools();
  $('#killBanner').hidden = !S.kill.kill;
  $('#killBanner').innerHTML = S.kill.kill ? `${icon('power')}<b>إيقاف الطوارئ مفعّل</b><span>أي تنفيذ على حسابات الإعلانات موقوف${S.kill.by ? ` · شغّلها ${esc(S.kill.by)} ${esc(when(S.kill.at))}` : ''}.</span>` : '';
  const b = $('#killBtn'); if (!b || b.disabled) return;
  b.onclick = () => {
    const on = b.dataset.on === '1';
    popover(b, `<h3>${on ? 'تفعيل إيقاف الطوارئ؟' : 'إلغاء إيقاف الطوارئ؟'}</h3><p class="muted" style="margin:0 0 12px">${on ? 'يوقف أي تنفيذ على حسابات الإعلانات فوراً. لين بس تقدر توقفه بعدين.' : 'يرجع التنفيذ حسب الحدود والموافقات.'}</p>
      <div class="bar" style="justify-content:flex-end"><button class="btn sm ghost" data-x>إلغاء</button><button class="btn sm ${on ? 'danger' : 'primary'}" data-go>${on ? 'فعّل الإيقاف' : 'ألغِ الإيقاف'}</button></div><div class="msg"></div>`, pop => {
      $('[data-x]', pop).onclick = closePop;
      $('[data-go]', pop).onclick = async e => { busy(e.currentTarget, true); try { S.kill = await api('/api/control/kill', { method: 'POST', body: { on } }); closePop(); drawTop(); toast(on ? 'إيقاف الطوارئ مفعّل' : 'انلغى إيقاف الطوارئ'); } catch (err) { busy(e.currentTarget, false); const m = $('.msg', pop); m.className = 'msg err'; m.textContent = err.message; } };
    });
  };
}
function kpis() {
  const wasted = S.open.filter(s => s.kind === 'pause' || s.kind === 'pause_campaign').reduce((a, s) => a + ((s.evidence || {}).spend || 0), 0);
  const week = Date.now() - 7 * 864e5;
  const executed = S.done.filter(s => s.status === 'executed' && new Date(s.decided_at) > week).length;
  const decided = S.done.filter(s => s.status !== 'expired');
  const rate = decided.length ? 100 * decided.filter(s => s.status === 'approved' || s.status === 'modified' || s.status === 'executed').length / decided.length : null;
  const k = (t, v, u = '') => `<div class="card kpi"><div class="k">${t}</div><div class="v">${v}${u ? `<small>${u}</small>` : ''}</div></div>`;
  $('#kpis').innerHTML = k('مبلغ معرّض للهدر', sar(wasted), 'ر.س/أسبوع') + k('اقتراحات مفتوحة', fmt(S.open.length)) + k('نُفّذ هالأسبوع', fmt(executed)) + k('نسبة الموافقة', rate == null ? '—' : fmt(rate, 0) + '%');
}
function modes() {
  const same = S.settings.every(x => x.mode === (S.settings[0] || {}).mode);
  const seg = `<span class="seg" role="group" aria-label="الوضع"><button aria-pressed="true">Manual</button><button disabled data-tip="يفتح بعد ما ينجح التنفيذ في حملات التجربة">${icon('lock')}Auto</button></span>`;
  if (same) {
    $('#modes').innerHTML = `<b>الوضع</b>${seg}<span class="muted">كل المنصات</span><span class="grow"></span><button class="btn sm secondary" id="limitsBtn" aria-haspopup="dialog">${icon('gear')}حدود التنفيذ</button>`;
    return limits();
  }
  $('#modes').innerHTML = `<b>الوضع</b>${S.settings.map(s => `<span class="bar" style="gap:6px"><span class="muted">${PLAT[s.platform]}</span>
    <span class="seg" role="group" aria-label="وضع ${PLAT[s.platform]}"><button aria-pressed="true">Manual</button><button disabled data-tip="يفتح بعد ما ينجح التنفيذ في حملات التجربة">${icon('lock')}Auto</button></span></span>`).join('')}
    <span class="grow"></span><button class="btn sm secondary" id="limitsBtn" aria-haspopup="dialog">${icon('gear')}حدود التنفيذ</button>`;
  limits();
}
function limits() {
  $('#limitsBtn').onclick = e => popover(e.currentTarget, `<h3>حدود التنفيذ</h3><ul>
    <li>${icon('check')}أقصى تغيير ميزانية بخطوة وحدة: <b class="num">20%</b></li>
    <li>${icon('check')}سقف الصرف اليومي: يتحدد مع المرحلة B</li>
    <li>${icon('check')}ما فيه إيقاف قبل <b class="num">3</b> أيام من التشغيل</li>
    <li>${icon('check')}أي حملة جديدة تحتاج موافقة لين، حتى في Auto</li>
    <li>${icon('check')}التنفيذ الحين: <b>إيقاف إعلان في Meta بس</b>، داخل حملات التجربة، وبحد أقصى <b class="num">10</b> بالساعة</li></ul>
    <h3 style="margin-top:14px">حملات التجربة</h3>${canaryHtml()}`, pop => {
    const save = $('[data-canary]', pop); if (!save) return;
    save.onclick = async e => { busy(e.currentTarget, true);
      try { S.kill = await api('/api/control/kill', { method: 'POST', body: { canary: [...pop.querySelectorAll('input[data-c]:checked')].map(x => x.value) } }); closePop(); drawTop(); toast('انحفظت حملات التجربة'); }
      catch (err) { busy(e.currentTarget, false); const m = $('.msg', pop); m.className = 'msg err'; m.textContent = err.message; } };
  });
}
function canaryHtml() {
  const on = new Set(S.kill.canary || []);
  const camps = [...new Set(Object.entries(S.ads).filter(([k]) => k[0] === 'm').map(([, a]) => a.campaign).filter(Boolean))].sort();
  if (!S.owner) return on.size ? `<ul>${[...on].map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : '<p class="muted">ما فيه. التنفيذ مقفل.</p>';
  return `<p class="muted" style="margin:0 0 8px">التنفيذ يصير بس داخل الحملات اللي تختارها. ابدأ بحملة وحدة.</p>
    <div style="max-height:220px;overflow:auto;display:grid;gap:6px">${camps.map(c => `<label class="bar" style="gap:8px"><input type="checkbox" data-c value="${esc(c)}"${on.has(c) ? ' checked' : ''}>${esc(c)}</label>`).join('') || '<p class="muted">ما فيه حملات Meta</p>'}</div>
    <div class="msg"></div><div class="bar" style="justify-content:flex-end;margin-top:8px"><button class="btn sm primary" data-canary>احفظ</button></div>`;
}
function tabs() {
  const n = p => S.open.filter(s => p === 'all' || s.platform === p).length;
  $('#tabs').innerHTML = [['all', 'كل المنصات'], ...Object.entries(PLAT)].map(([k, t]) =>
    `<button role="tab" data-t="${k}" aria-selected="${S.tab === k}">${t}<span class="cnt">${n(k)}</span></button>`).join('')
    + `<button role="tab" data-t="log" aria-selected="${S.tab === 'log'}">${icon('clock')}القرارات السابقة<span class="cnt">${S.done.length}</span></button>`
    + `<button role="tab" data-t="learn" aria-selected="${S.tab === 'learn'}">${icon('refresh')}التعلّم</button>`;
}
function filters() {
  if (S.tab === 'log') {
    $('#filters').innerHTML = `<input type="search" id="q" placeholder="ابحث بالإعلان أو الشخص" value="${esc(S.q)}" aria-label="بحث">
      <select id="hs" aria-label="القرار"><option value="">كل القرارات</option>${Object.entries(STATUS).map(([k, t]) => `<option value="${k}"${S.hist.status === k ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
    return;
  }
  const kinds = [...new Set(S.open.map(s => s.kind))];
  $('#filters').innerHTML = `<input type="search" id="q" placeholder="ابحث بالإعلان أو الحملة" value="${esc(S.q)}" aria-label="بحث">
    <select id="fk" aria-label="نوع الاقتراح"><option value="">كل الاقتراحات</option>${kinds.map(k => `<option value="${k}"${S.kind === k ? ' selected' : ''}>${KIND[k] || k}</option>`).join('')}</select>
    <select id="fl" aria-label="المستوى"><option value="">كل المستويات</option>${Object.entries(LEVEL).map(([k, t]) => `<option value="${k}"${S.level === k ? ' selected' : ''}>${t}</option>`).join('')}</select>
    <select id="fs" aria-label="الترتيب"><option value="impact"${S.sort === 'impact' ? ' selected' : ''}>الأثر بالريال</option><option value="new"${S.sort === 'new' ? ' selected' : ''}>الأحدث</option><option value="age"${S.sort === 'age' ? ' selected' : ''}>عمر الإعلان</option></select>`;
}

// ---------- الصندوق
function rows() {
  const q = S.q.trim().toLowerCase();
  let list = S.open.filter(s => (S.tab === 'all' || s.platform === S.tab) && (!S.kind || s.kind === S.kind) && (!S.level || s.level === S.level)
    && (!q || `${s.target_name} ${s.campaign}`.toLowerCase().includes(q)));
  const key = { impact: s => -((impact(s) || {}).v ?? -1), new: s => -new Date(s.created_at), age: s => -(ageOf(s) ?? -1) }[S.sort];
  return list.sort((a, b) => key(a) - key(b));
}
function thumb(s, cls = 'thumb48') {
  const a = adOf(s);
  return a && a.thumb ? `<img class="${cls}" src="${a.thumb}" alt="" loading="lazy">` : `<span class="${cls} ph">${icon('image')}</span>`;
}
function evidence(s) {
  const e = s.evidence || {}, b = [];
  if (e.spend != null) b.push(`صرف <span class="num">${sar(e.spend)}</span>`);
  if (e.leads != null) b.push(`${e.metric === 'chats' ? 'محادثات' : 'ليدز'} <span class="num">${fmt(e.leads)}</span>`);
  if (e.cpl != null) b.push(`تكلفة <span class="num">${sar(e.cpl)}</span>`);
  if (e.target_cpl != null) b.push(`الهدف <span class="num">${sar(e.target_cpl)}</span>`);
  if (e.ctr != null) b.push(`نقر <span class="num">${fmt(e.ctr, 2)}%</span>`);
  return b.join(' · ');
}
function inbox() {
  const list = rows();
  S.list = list;
  if (S.cursor >= list.length) S.cursor = Math.max(0, list.length - 1);
  if (!list.length) { $('#inbox').innerHTML = `<div class="empty">${icon('inbox')}<div>ما فيه قرارات تنتظرك</div></div>`; selbar(); return; }
  $('#inbox').innerHTML = `<table><thead><tr><th style="width:36px"><input type="checkbox" id="all" aria-label="تحديد الكل"${list.every(s => S.sel.has(s.id)) ? ' checked' : ''}></th>
    <th>الكرييتف</th><th>الإعلان</th><th>المنصة</th><th>الاقتراح</th><th>الأثر</th><th>الدليل</th><th>عمر الإعلان</th><th></th></tr></thead><tbody>
    ${list.map((s, i) => { const im = impact(s), age = ageOf(s); return `<tr data-id="${s.id}" aria-selected="${S.sel.has(s.id)}" class="${i === S.cursor ? 'cursor' : ''}">
      <td class="c-pick"><input type="checkbox" data-pick aria-label="تحديد"${S.sel.has(s.id) ? ' checked' : ''}></td>
      <td class="c-thumb">${thumb(s)}</td>
      <td class="ad c-ad"><b>${esc(s.target_name || s.target_id)}</b><span>${esc(s.campaign || '')}</span></td>
      <td class="c-plat"><span class="chip">${PLAT[s.platform]}</span></td>
      <td class="sg c-sg"><span class="chip solid">${KIND[s.kind] || esc(s.kind)}${(s.params || {}).pct ? ` ${s.params.pct}%` : ''}</span><span>${esc(ruleOf(s))}</span>${criticChip(s)}${waChip(s)}</td>
      <td class="imp c-imp">${im ? `<b class="num">${esc(im.n)}</b><span>${esc(im.l)}</span>` : '<span class="muted">—</span>'}</td>
      <td class="ev c-ev">${evidence(s)}</td>
      <td class="num c-age">${age == null ? '—' : `${age} يوم`}</td>
      <td class="c-acts"><div class="acts"><button class="btn icon ghost" data-a="approve" data-tip="${blocked(s) ? esc(blocked(s)) : 'وافق (a)'}" aria-label="وافق"${blocked(s) ? ' disabled' : ''}>${icon('check')}</button>
        <button class="btn icon ghost" data-a="modify" data-tip="وافق بتعديل" aria-label="وافق بتعديل"${blocked(s) ? ' disabled' : ''}>${icon('pen')}</button>
        <button class="btn icon ghost" data-a="reject" data-tip="ارفض (r)" aria-label="ارفض">${icon('x')}</button></div></td></tr>`; }).join('')}
    </tbody></table>`;
  selbar();
}
function history() {
  const q = S.q.trim().toLowerCase();
  const list = S.done.filter(s => (!S.hist.status || s.status === S.hist.status) && (!q || `${s.target_name} ${s.decided_by} ${s.note || ''}`.toLowerCase().includes(q)));
  $('#inbox').innerHTML = list.length ? `<table><thead><tr><th>الوقت</th><th>الإعلان</th><th>المنصة</th><th>الاقتراح</th><th>القرار</th><th>مين</th><th>الملاحظة</th></tr></thead><tbody>
    ${list.map(s => `<tr><td class="num">${esc(when(s.decided_at))}</td><td class="ad"><b>${esc(s.target_name || s.target_id)}</b></td><td><span class="chip">${PLAT[s.platform]}</span></td>
      <td>${KIND[s.kind] || esc(s.kind)}</td><td><span class="chip ${s.status === 'rejected' || s.status === 'expired' ? 'line' : 'solid'}">${STATUS[s.status] || s.status}${s.status === 'approved' ? (s.platform === 'meta' && (s.level === 'ad' || s.level === 'adset') && (s.kind === 'pause' || s.kind === 'resume') && !waManual(s) ? ' · ينتظر التنفيذ' : ' · ينفّذ يدوي') : ''}</span></td>
      <td>${esc(s.decided_by || '')}</td><td>${esc(s.note || '')}${s.result && s.result.error ? `<div class="muted">${icon('alert')}${esc(s.result.error)}</div>` : ''}${s.result && s.result.after ? `<div class="muted">Meta: ${esc(s.result.before)} ← ${esc(s.result.after)}${s.result.via_adset ? ' · تنفّذ على المجموعة كاملة (إعلان واتساب)' : ''}</div>` : ''}
      ${s.status === 'executed' && s.kind === 'pause' && s.platform === 'meta' ? `<button class="btn sm secondary" data-revert="${s.id}">${icon('refresh')}تراجع</button>` : ''}</td></tr>`).join('')}</tbody></table>` : `<div class="empty">${icon('clock')}<div>ما فيه قرارات سابقة</div></div>`;
  $('#selbar').hidden = true;
  $('#inbox').querySelectorAll('[data-revert]').forEach(b => b.onclick = e => { e.stopPropagation(); const id = +b.dataset.revert;
    popover(b, `<h3>تراجع عن الإيقاف؟</h3><p class="muted" style="margin:0 0 8px">الإعلان يرجع يشتغل في Meta في التحديث الجاي.</p><textarea id="note" aria-label="سبب التراجع" placeholder="سبب التراجع (مطلوب)"></textarea>
      <div class="msg"></div><div class="bar" style="justify-content:flex-end;margin-top:8px"><button class="btn sm ghost" data-x>إلغاء</button><button class="btn sm primary" data-go>تراجع</button></div>`, pop => {
      $('[data-x]', pop).onclick = closePop;
      $('[data-go]', pop).onclick = async ev => { const note = $('#note', pop).value.trim(), m = $('.msg', pop);
        if (!note) { m.className = 'msg err'; m.textContent = 'السبب مطلوب'; return; }
        busy(ev.currentTarget, true);
        try { const r = await api('/api/control/suggestions', { method: 'POST', body: { decision: 'revert', id, note } }); S.done = [...r.done, ...S.done]; closePop(); render(); toast('انحفظ التراجع · يتنفّذ خلال ساعة'); }
        catch (err) { busy(ev.currentTarget, false); m.className = 'msg err'; m.textContent = err.message; } };
    }); });
}
function render() { kpis(); tabs(); filters(); S.tab === 'log' ? history() : S.tab === 'learn' ? learning() : inbox(); }
// التعلّم: الدروس، وحركات الفريق داخل المنصات، ونتايج القرارات بعد 3 و7 أيام
async function learning() {
  $('#filters').innerHTML = ''; $('#selbar').hidden = true;
  $('#inbox').innerHTML = `<div class="empty">يحمّل…</div>`;
  let r;
  try { r = await api('/api/control/learning'); } catch (err) { $('#inbox').innerHTML = `<div class="empty">${icon('alert')}<div>${esc(err.message)}</div></div>`; return; }
  if (S.tab !== 'learn') return;
  const L = r.lessons.length ? r.lessons.map(l => `<li class="${l.block ? 'blk' : ''}"><span class="chip ${l.block ? 'solid' : 'line'}">${l.block ? 'موقوفة' : PLAT[l.platform] || l.platform}</span><span>${esc(l.lesson)}</span>
      ${(l.evidence && l.evidence.notes || []).length ? `<div class="muted">ملاحظات الفريق: ${esc(l.evidence.notes.slice(0, 3).join(' · '))}</div>` : ''}</li>`).join('')
    : '<li class="muted">ما فيه دروس لين الحين. تبدأ تطلع بعد ما ينحسم 3 قرارات أو أكثر من نفس النوع.</li>';
  const A = r.activity.length ? `<table><thead><tr><th>الوقت</th><th>المنصة</th><th>مين</th><th>الحركة</th><th>على</th></tr></thead><tbody>${r.activity.map(a => `<tr style="cursor:default">
      <td class="num">${esc(when(a.at))}</td><td><span class="chip">${PLAT[a.platform] || a.platform}</span></td><td>${esc(a.actor || '')}</td><td>${esc((a.detail && a.detail.label) || a.event)}</td><td>${esc(a.object_name || a.object_type || '')}</td></tr>`).join('')}</tbody></table>`
    : '<div class="empty">ما فيه حركات داخل المنصات آخر 7 أيام (أو لسا ما انسحبت).</div>';
  const O = r.outcomes.length ? `<table><thead><tr><th>القرار</th><th>بعد</th><th>تكلفة الليد قبل ← بعد</th><th>التغيّر</th></tr></thead><tbody>${r.outcomes.map(o => `<tr style="cursor:default">
      <td>#${o.suggestion_id} · ${esc(STATUS[o.metrics.decision] || o.metrics.decision)}</td><td class="num">${o.day} أيام</td>
      <td class="num">${sar(o.metrics.before.cpl)} ← ${sar(o.metrics.after.cpl)}</td><td class="num">${o.vs_expect && o.vs_expect.cpl_change_pct != null ? `${o.vs_expect.cpl_change_pct > 0 ? '+' : ''}${o.vs_expect.cpl_change_pct}%` : '—'}</td></tr>`).join('')}</tbody></table>`
    : '<div class="empty">النتايج تطلع بعد 3 أيام من أول قرار.</div>';
  $('#inbox').innerHTML = `<div class="pad"><h2>الدروس</h2><p class="muted" style="margin-top:-6px">من قرارات الفريق وملاحظاته ونتايجها، ومن حركاتهم داخل المنصات. المراجع والاقتراحات يقرونها كل ساعة.</p><ul class="lessons">${L}</ul></div>
    <div class="pad"><h2>حركات الفريق داخل المنصات · آخر 7 أيام</h2><p class="muted" style="margin-top:-6px">Meta وGoogle. Snap وTikTok ما يعطون سجل نشاط.</p></div><div class="tbl">${A}</div>
    <div class="pad"><h2>نتيجة القرارات</h2></div><div class="tbl">${O}</div>`;
}

// ---------- التحديد الجماعي
function selbar() {
  const n = [...S.sel].filter(id => S.open.some(s => s.id === id)).length;
  const bar = $('#selbar');
  bar.hidden = !n;
  if (!n) return;
  bar.innerHTML = `<span><b class="num">${n}</b> مختارة</span><button class="btn sm light" data-bulk="approve">${icon('check')}وافق على ${n}</button>
    <button class="btn sm secondary" data-bulk="reject">${icon('x')}ارفض ${n}</button><button class="btn sm secondary" data-bulk="clear" aria-label="إلغاء التحديد">${icon('x')}</button>`;
}

// ---------- القرارات
async function decide(ids, decision, note = '', btn) {
  busy(btn, true);
  try {
    const r = await api('/api/control/suggestions', { method: 'POST', body: { ids, decision, note } });
    const gone = new Set(r.done.map(s => s.id));
    S.open = S.open.filter(s => !gone.has(s.id)); S.done = [...r.done, ...S.done]; ids.forEach(id => S.sel.delete(id));
    closePop(); closePanel(); render();
    toast(`${decision === 'approve' ? (r.done.some(s => s.platform === 'meta' && s.kind === 'pause') && (S.kill.canary || []).length ? 'انحفظت الموافقة · إيقاف Meta يتنفّذ خلال ساعة لو الحملة تجربة' : 'انحفظت الموافقة') : decision === 'reject' ? 'انحفظ الرفض' : 'انحفظت الموافقة بالتعديل'}${r.done.length > 1 ? ` على ${r.done.length}` : ''}`);
  } catch (err) { busy(btn, false); const m = $('.pop .msg'); if (m) { m.className = 'msg err'; m.innerHTML = icon('alert') + esc(err.message); } else toast(err.message); }
}
function askNote(anchor, ids, decision) {
  const title = decision === 'reject' ? (ids.length > 1 ? `سبب رفض ${ids.length}` : 'سبب الرفض') : 'وش التعديل المطلوب؟';
  const hint = decision === 'reject' ? 'مطلوب. لو تبي نسوي شي بداله اكتبه هنا.' : 'مثال: ارفعها 10% بس.';
  popover(anchor, `<h3>${title}</h3><p class="muted" style="margin:0 0 8px">${hint}</p><textarea id="note" aria-label="${title}"></textarea>
    <div class="msg"></div><div class="bar" style="justify-content:flex-end;margin-top:8px"><button class="btn sm ghost" data-x>إلغاء</button>
    <button class="btn sm primary" data-go>${decision === 'reject' ? 'ارفض' : 'وافق بالتعديل'}</button></div>`, pop => {
    $('#note', pop).focus();
    $('[data-x]', pop).onclick = closePop;
    $('[data-go]', pop).onclick = e => { const note = $('#note', pop).value.trim(); if (!note) { const m = $('.msg', pop); m.className = 'msg err'; m.innerHTML = icon('alert') + 'الملاحظة مطلوبة'; return; } decide(ids, decision, note, e.currentTarget); };
  });
}

// ---------- popover
let POP = null;
function popover(anchor, html, init) {
  closePop();
  const p = document.createElement('div'); p.className = 'pop'; p.setAttribute('role', 'dialog'); p.innerHTML = html; document.body.appendChild(p);
  const r = anchor.getBoundingClientRect();
  const top = Math.min(window.scrollY + r.bottom + 8, window.scrollY + innerHeight - p.offsetHeight - 12);
  const left = Math.max(12, Math.min(r.left + r.width - p.offsetWidth, innerWidth - p.offsetWidth - 12));
  p.style.top = `${Math.max(window.scrollY + 12, top)}px`; p.style.left = `${left}px`;
  POP = p; if (init) init(p);
  setTimeout(() => document.addEventListener('mousedown', outside), 0);
}
function outside(e) { if (POP && !POP.contains(e.target)) closePop(); }
function closePop() { if (POP) { POP.remove(); POP = null; document.removeEventListener('mousedown', outside); } }

// ---------- لوحة التفاصيل
function spark(a) {
  if (!a || !a.days || !a.days.length) return '<p class="muted">ما فيه أرقام آخر 14 يوم</p>';
  const W = 440, H = 96, n = 14, bw = W / n;
  const end = new Date(); const days = [...Array(n)].map((_, i) => { const d = new Date(end - (n - 1 - i) * 864e5); return d.toISOString().slice(0, 10); });
  const by = Object.fromEntries(a.days.map(([d, s, l]) => [d, [s, l]]));
  const ms = Math.max(1, ...days.map(d => (by[d] || [0])[0])), ml = Math.max(1, ...days.map(d => (by[d] || [0, 0])[1]));
  const x = i => W - (i + 1) * bw;   // يمين لليسار
  const bars = days.map((d, i) => { const s = (by[d] || [0])[0], h = s / ms * (H - 12); return `<rect x="${x(i) + 3}" y="${H - h}" width="${bw - 6}" height="${h}" rx="3" fill="var(--soft)"><title>${day(d)}: ${sar(s)} ر.س</title></rect>`; }).join('');
  const pts = days.map((d, i) => `${x(i) + bw / 2},${H - (by[d] || [0, 0])[1] / ml * (H - 12)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="الصرف مقابل الليدز آخر 14 يوم">${bars}<polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/></svg>
    <div class="bar muted"><span class="chip" style="background:var(--soft);color:var(--ink)">الصرف</span><span class="chip line" style="border-color:var(--accent)">الليدز</span></div>`;
}
async function openPanel(s) {
  const a = adOf(s), im = impact(s), e = s.evidence || {}, age = ageOf(s);
  const p = $('#panel');
  p.innerHTML = `<header><h2 style="margin:0">${esc(s.target_name || s.target_id)}</h2><button class="btn icon ghost" data-close aria-label="إغلاق">${icon('x')}</button></header>
    <div class="body">
      ${a && a.thumb ? `<img class="hero" src="${a.thumb}" alt="">` : ''}
      <div class="bar"><span class="chip">${PLAT[s.platform]}</span><span class="chip solid">${KIND[s.kind] || esc(s.kind)}${(s.params || {}).pct ? ` ${s.params.pct}%` : ''}</span><span class="chip line">${LEVEL[s.level]}</span>
        ${a && a.open ? `<a class="btn sm secondary" href="${esc(a.open)}" target="_blank" rel="noopener">${icon('ext')}افتح في المنصة</a>` : ''}</div>
      ${waManual(s) ? `<p class="msg err">${icon('alert')}${esc(WA_NOTE(waManual(s)))}</p>` : ''}
      <div><h3>ليش؟</h3><p style="margin:6px 0 0">${esc(s.reason)}</p><p class="muted" style="margin:4px 0 0">${esc(t(ruleOf(s)))}${s.campaign ? ` · ${esc(s.campaign)}` : ''}</p></div>
      <dl class="kv">
        ${im ? `<dt>الأثر</dt><dd class="num">${esc(im.t)}</dd>` : ''}
        ${e.spend != null ? `<dt>الصرف آخر 7 أيام</dt><dd class="num">${sar(e.spend)} ر.س</dd>` : ''}
        ${e.leads != null ? `<dt>${e.metric === 'chats' ? 'المحادثات' : 'الليدز'} آخر 7 أيام</dt><dd class="num">${fmt(e.leads)}</dd>` : ''}
        ${e.cpl != null ? `<dt>${e.metric === 'chats' ? 'تكلفة المحادثة' : 'تكلفة الليد'}</dt><dd class="num">${sar(e.cpl)} ر.س</dd>` : ''}
        ${e.target_cpl != null ? `<dt>الهدف</dt><dd><span class="num">${sar(e.target_cpl)} ر.س</span> <span class="muted">(${e.target_source === 'written' ? 'هدف مكتوب' : 'متوسط 30 يوم للمنصة'})</span></dd>` : ''}
        ${age != null ? `<dt>عمر الإعلان</dt><dd class="num">${age} يوم</dd>` : ''}
        <dt>انقترح</dt><dd>${esc(when(s.created_at))}</dd>
      </dl>
      ${s.kind === 'new_campaign' ? campaignHTML(s) : ''}${planHTML(s)}
      <div><h3>الصرف مقابل الليدز · آخر 14 يوم</h3>${spark(a)}</div>
      <div><h3>سجل هذا الإعلان</h3><div id="phist" class="muted">يحمّل…</div></div>
    </div>
    <footer><button class="btn primary" data-a="approve"${blocked(s) ? ' disabled' : ''}>${icon('check')}وافق</button><button class="btn secondary" data-a="modify"${blocked(s) ? ' disabled' : ''}>${icon('pen')}وافق بتعديل</button><button class="btn secondary" data-a="reject">${icon('x')}ارفض</button></footer>`;
  p.dataset.id = s.id; p.classList.add('open'); p.setAttribute('aria-hidden', 'false'); $('#veil').classList.add('open');
  $('[data-close]', p).focus();
  try {
    const r = await api('/api/control/history?target=' + encodeURIComponent(s.target_id));
    $('#phist').innerHTML = r.log.length ? r.log.map(x => `<div>${esc(when(x.at))} · ${esc(x.email || '')} · ${esc(STATUS[x.action.replace('suggestion_', '')] || x.action)}${x.note ? ` · ${esc(x.note)}` : ''}</div>`).join('') : 'ما فيه قرارات سابقة على هذا الإعلان';
  } catch { $('#phist').textContent = 'ما قدرت أقرأ السجل'; }
}
function fmtState(o) {
  if (!o) return '—';
  if (o.status) return o.status === 'PAUSED' ? 'موقوف' : 'شغّال';
  if (o.change_pct != null) return `${o.change_pct > 0 ? '+' : ''}${o.change_pct}% ميزانية`;
  if ('budget' in o) return o.budget == null ? 'الميزانية الحالية (تنقرا وقت التنفيذ)' : `${sar(o.budget)} ر.س`;
  return '—';
}
const FIELD = { dept: 'القسم', objective: 'الهدف', budget: 'الميزانية اليومية', start: 'البداية', end: 'النهاية', geo: 'الموقع', age_min: 'العمر من', age_max: 'إلى', gender: 'الجنس', lang: 'اللغة',
  influencer: 'المؤثرة', wa_message: 'رسالة واتساب', creative: 'الكرييتف', primary: 'النص', headline: 'العنوان', cta: 'الزر', destination: 'الوجهة', optimization: 'التحسين', placements: 'أماكن الظهور',
  budget_type: 'نوع الميزانية', partnership: 'شراكة', radius: 'نصف القطر', pixel: 'البكسل', ad_type: 'نوع الإعلان', goal: 'الهدف في سناب', qualify: 'سؤال التأهيل', bid: 'المزايدة', spark: 'Spark',
  spark_code: 'كود Spark', lead_form: 'نموذج فوري', type: 'النوع', keywords: 'الكلمات', negatives: 'السلبية', headlines: 'العناوين', descriptions: 'الأوصاف', final_url: 'الرابط', bidding: 'المزايدة' };
function campaignHTML(s) {
  const p = s.params || {}, e = s.evidence || {}, pend = new Set(e.ai_pending || []);
  const VAL = { iv: 'المحاليل الوريدية', midwife: 'القبالة / رعاية الحمل', foot: 'تقويم القدم', renan: 'رينان لصحة الطفل', leads: 'Leads', sales: 'Sales', all: 'الكل', female: 'نساء', male: 'رجال',
    ar: 'عربي', en: 'إنجليزي', whatsapp: 'واتساب', form: 'نموذج فوري', site: 'الموقع', conversations: 'المحادثات', purchase: 'الشراء', abo: 'على المجموعة (ABO)', cbo: 'على الحملة (CBO)',
    single: 'صورة أو فيديو', story: 'ستوري', collection: 'كولكشن', lead_form: 'نموذج ليد داخل سناب', website: 'سوايب للموقع', pixel_purchase: 'شراء (Pixel)', auto: 'تلقائي', target: 'تكلفة مستهدفة',
    complete_payment: 'Complete Payment', max_conv: 'أكبر عدد تحويلات', tcpa: 'تكلفة تحويل مستهدفة', book: 'احجز الآن', learn: 'اعرف أكثر', signup: 'سجّل', '65': '65+',
    fb_feed: 'فيسبوك فيد', ig_feed: 'إنستغرام فيد', ig_stories: 'ستوري', ig_reels: 'ريلز' };
  const lab = v => VAL[v] || v;
  const val = (k, v) => pend.has(k) ? '<span class="chip line">يعبيها كلود</span>' : v === '' || v == null ? '—' : Array.isArray(v) ? esc(v.map(lab).join('، ')) : typeof v === 'string' && VAL[v] && k !== 'creative' ? esc(lab(v)) : Array.isArray(v) ? esc(v.join('، ')) : typeof v === 'boolean' ? (v ? 'نعم' : 'لا')
    : k === 'creative' || k === 'final_url' ? `<a href="${/^https?:/i.test(v) ? esc(v) : '#'}" target="_blank" rel="noopener">${esc(v)}</a>` : esc(v);
  const rows = Object.keys(FIELD).filter(k => k in p && k !== 'name').map(k => `<dt>${FIELD[k]}</dt><dd>${val(k, p[k])}</dd>`).join('');
  return `<div><h3>تفاصيل الحملة</h3>${(e.moh || []).length ? `<p class="msg err">${icon('alert')}كلمات تخالف تعليمات وزارة الصحة: ${esc(e.moh.join('، '))}</p>` : ''}<dl class="kv">${rows}</dl></div>`;
}
function planHTML(s) {
  if (!s.before && !s.after && !s.measure_plan && !(s.risk || []).length) return '';
  const ex = s.expect || {};
  const exp = [ex.save_per_week != null ? `يوفر ~${sar(ex.save_per_week)} ر.س/أسبوع` : '', ex.extra_spend_per_week != null ? `+${sar(ex.extra_spend_per_week)} ر.س/أسبوع صرف` : '',
    ex.extra_leads_per_week != null ? `+${fmt(ex.extra_leads_per_week, 1)} ليد/أسبوع متوقع` : ''].filter(Boolean).join(' · ');
  return `<div><h3>الخطة</h3><dl class="kv">
    ${s.before || s.after ? `<dt>قبل ← بعد</dt><dd>${esc(fmtState(s.before))} ← ${esc(fmtState(s.after))}</dd>` : ''}
    ${exp ? `<dt>التوقّع</dt><dd>${esc(exp)}</dd>` : ''}
    ${s.measure_plan ? `<dt>القياس</dt><dd>${esc(s.measure_plan)}</dd>` : ''}
    ${s.reversal_plan ? `<dt>التراجع</dt><dd>${esc(s.reversal_plan)}</dd>` : ''}
    ${(s.risk || []).length ? `<dt>الخطر</dt><dd>${s.risk.map(r => `<span class="chip line">${esc(r)}</span>`).join(' ')}</dd>` : ''}
    ${s.critic ? `<dt>المراجع</dt><dd>${s.critic.ok ? 'عدّى قواعد لين' : esc((s.critic.issues || []).join(' · '))}</dd>` : ''}
  </dl></div>`;
}
function closePanel() { const p = $('#panel'); p.classList.remove('open'); p.setAttribute('aria-hidden', 'true'); $('#veil').classList.remove('open'); }

// ---------- الأحداث
function act(btn, ids) {
  const d = btn.dataset.a || btn.dataset.bulk;
  if (d === 'approve') return decide(ids, 'approve', '', btn);
  askNote(btn, ids, d === 'modify' ? 'modify' : 'reject');
}
function bind() {
  $('#tabs').onclick = e => { const b = e.target.closest('[data-t]'); if (!b) return; S.tab = b.dataset.t; S.q = ''; S.cursor = 0; render(); };
  $('#filters').oninput = e => {
    if (e.target.id === 'q') { S.q = e.target.value; S.tab === 'log' ? history() : inbox(); return; }
    if (e.target.id === 'fk') S.kind = e.target.value; if (e.target.id === 'fl') S.level = e.target.value; if (e.target.id === 'fs') S.sort = e.target.value;
    if (e.target.id === 'hs') S.hist.status = e.target.value;
    S.tab === 'log' ? history() : S.tab === 'learn' ? learning() : inbox();
  };
  $('#inbox').onclick = e => {
    if (e.target.id === 'all') { (S.list || []).forEach(s => e.target.checked ? S.sel.add(s.id) : S.sel.delete(s.id)); inbox(); return; }
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    const id = +tr.dataset.id, s = S.open.find(x => x.id === id);
    if (e.target.matches('[data-pick]')) { e.target.checked ? S.sel.add(id) : S.sel.delete(id); tr.setAttribute('aria-selected', String(e.target.checked)); selbar(); return; }
    const b = e.target.closest('[data-a]'); if (b) { act(b, [id]); return; }
    S.cursor = (S.list || []).indexOf(s); openPanel(s);
  };
  $('#selbar').onclick = e => { const b = e.target.closest('[data-bulk]'); if (!b) return; if (b.dataset.bulk === 'clear') { S.sel.clear(); inbox(); return; } act(b, [...S.sel]); };
  $('#panel').onclick = e => { if (e.target.closest('[data-close]')) return closePanel(); const b = e.target.closest('[data-a]'); if (b) act(b, [+$('#panel').dataset.id]); };
  $('#veil').onclick = closePanel;
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (POP) closePop(); else closePanel(); return; }
    if (e.target.closest('input,textarea,select') || e.metaKey || e.ctrlKey || e.altKey || S.tab === 'log' || !S.list || !S.list.length) return;
    const cur = S.list[S.cursor];
    const row = () => $(`tr[data-id="${S.list[S.cursor].id}"]`);
    if (e.key === 'j' || e.key === 'k') { S.cursor = Math.max(0, Math.min(S.list.length - 1, S.cursor + (e.key === 'j' ? 1 : -1))); inbox(); row().scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'x') { S.sel.has(cur.id) ? S.sel.delete(cur.id) : S.sel.add(cur.id); inbox(); }
    else if (e.key === 'a') decide(S.sel.size ? [...S.sel] : [cur.id], 'approve', '', null);
    else if (e.key === 'r') askNote(row(), S.sel.size ? [...S.sel] : [cur.id], 'reject');
    else if (e.key === 'Enter') openPanel(cur);
    else return;
    e.preventDefault();
  });
}

// ---------- التحميل
function skeleton() {
  $('#inbox').innerHTML = `<table><tbody class="skel">${'<tr>' + '<td><div style="width:48px;height:48px"></div></td><td><div style="width:60%"></div></td><td><div></div></td><td><div></div></td><td><div style="width:70%"></div></td>'.repeat(1) + '</tr>'}`.repeat(5) + '</tbody></table>';
}
async function load() {
  skeleton();
  try {
    const [sug, set, ads, kill] = await Promise.all([api('/api/control/suggestions'), api('/api/control/settings'), fetch('/control/ads.json', { credentials: 'same-origin' }).then(r => r.ok ? r.json() : { ads: {} }).catch(() => ({ ads: {} })), api('/api/control/kill').catch(() => ({ kill: false }))]);
    Object.assign(S, { open: sug.open, done: sug.done, settings: set.settings, owner: set.owner, ads: ads.ads || {}, gen: ads.generated_at || null, kill });
    drawTop();
    modes(); render();
    const want = +new URLSearchParams(location.search).get('open'); const hit = want && S.open.find(x => x.id === want); if (hit) openPanel(hit);
  } catch (err) {
    $('#inbox').innerHTML = `<div class="empty">${icon('alert')}<div>${esc(err.message)}</div><button class="btn secondary" id="retry" style="margin-top:12px">${icon('refresh')}حاول مرة ثانية</button></div>`;
    $('#retry').onclick = load;
  }
}
shell({ active: 'control', title: 'لوحة القرارات' })
  .then(() => { bind(); load(); })
  .catch(err => { $('#content').innerHTML = `<div class="card empty">${icon('alert')}<div>${esc(err.message)}</div></div>`; });
