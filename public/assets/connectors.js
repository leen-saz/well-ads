// صفحة الربط: حالة كل منصة، وزر "اربط" (OAuth) أو الخانات اليدوية حسب توثيق المنصة.
// القيم السرية تروح للسيرفر وما ترجع أبداً: الخانة المحفوظة تطلع "محفوظ" بس.
import { t } from './i18n.js';
import { $, $$, api, esc, icon, shell, say, toast, busy, when, friendly } from './common.js';

// Runs on every visit of this page (assets/router.js calls it after each ClientRouter navigation).
export default async function mount() {

  const S = { list: [], q: '', open: null, fallback: new Set() };
  const GROUP = { ads: 'منصات الإعلانات', analytics: 'التحليلات والقياس' };
  const STATUS = {
    ok: ['ok', 'check', 'مربوط'], partial: ['warn', 'alert', 'ناقص'], expired: ['warn', 'alert', 'انتهى الربط'],
    none: ['line', 'plug', 'مو مربوط'], mcp: ['ok', 'check', 'مربوط'], github: ['ok', 'check', 'يشتغل تلقائياً'],
  };
  const ERR = { state: 'انتهت مهلة الربط، جرّب مرة ثانية.', denied: 'انلغى الربط من صفحة المنصة.', access: 'ما عندك صلاحية الربط أو بيانات التطبيق ناقصة.', exchange: 'المنصة ما رجّعت مفتاح صالح. تأكد إن رابط الرجوع مضاف في إعدادات التطبيق.' };

  function chip(p) {
    const [cls, ic, txt] = STATUS[p.status] || STATUS.none;
    return `<span class="chip ${cls}">${icon(ic)}${txt}</span>`;
  }
  function logo(p) {
    return p.logo ? `<span class="cx-logo"><img src="/assets/logos/${esc(p.logo)}.svg" alt="" width="24" height="24"></span>`
      : `<span class="cx-logo mono" style="background:${esc(p.color)}">${esc(p.name.trim()[0])}</span>`;
  }
  // البديل: خانات المنصة حسب توثيقها. يطلع إذا المنصة ما تدعم زر الربط، أو الربط ما ضبط، أو بعد الربط يبي رقم الحساب.
  function form(p) {
    const list = p.oauth && p.oauthReady && !S.fallback.has(p.id) ? p.fields.filter(f => !f.manual) : p.fields;
    const fields = list.map(f => {
      const id = `f_${p.id}_${f.env}`;
      const ph = f.saved && f.secret ? 'محفوظ · اتركه فاضي عشان يبقى' : f.placeholder || (f.optional ? 'اختياري' : '');
      const val = !f.secret && f.shown ? esc(f.shown) : '';
      const input = f.type === 'textarea'
        ? `<textarea id="${id}" name="${f.env}" placeholder="${esc(ph)}" autocomplete="off" spellcheck="false"></textarea>`
        : `<input id="${id}" name="${f.env}" type="${f.secret ? 'password' : 'text'}" value="${val}" placeholder="${esc(ph)}" autocomplete="off" spellcheck="false">`;
      return `<label for="${id}">${esc(f.label)}${f.optional ? ' <span class="muted">(اختياري)</span>' : ''}${f.saved ? ` <span class="muted">${icon('check')}محفوظ</span>` : ''}</label>${input}`;
    }).join('');
    const note = S.fallback.has(p.id) ? 'الربط ما ضبط، فهذي الطريقة البديلة: ' : p.oauth && !p.oauthReady ? 'زر الربط لسا ما تجهّز لهالمنصة، فاربطها بالمفاتيح: ' : '';
    return `<form data-save="${p.id}" novalidate>
      <p class="muted cx-meta">${note}${esc(p.help)} <a href="${esc(p.docs)}" target="_blank" rel="noopener">${icon('ext')}جيب المفاتيح</a></p>${fields}
      <div class="bar" style="margin-top:16px"><button class="btn primary" type="submit">احفظ</button><button class="btn ghost" type="button" data-close>إلغاء</button>
        ${!p.mcp && !['none', 'github'].includes(p.status) ? `<button class="btn ghost" type="button" data-drop="${p.id}">${icon('x')}فك الربط</button>` : ''}</div>
      <div class="msg" role="status"></div></form>`;
  }
  function card(p) {
    // منصة بلا خانات (تيك توك) زرها الوحيد هو الربط، حتى لو أسرار التطبيق لسا ما انضافت أو المحاولة السابقة فشلت.
    const direct = p.oauth && (p.oauthReady || !p.fields.length) && (!p.fields.length || !S.fallback.has(p.id));
    const label = p.status === 'ok' ? 'أعد الربط' : 'اربط';
    const btn = direct
      ? `<a class="btn sm primary" href="/api/connectors/start?platform=${p.id}">${icon('plug')}${label}</a>`
      : p.mcp ? ''
      : `<button class="btn sm primary" data-key="${p.id}" aria-expanded="${S.open === p.id}">${icon('plug')}${label}</button>`;
    // بعد زر الربط: إذا ناقص رقم الحساب نطلبه بدون ما نرجع للمفاتيح
    const needIds = direct && p.status === 'partial' && p.fields.some(f => !f.manual && !f.saved && !f.optional);
    const meta = [p.fetch ? 'أرقامها تظهر في الداشبورد' : 'يخدم النشر أو تتبع التحويلات'];
    if (p.at) meta.push(`آخر ربط ${when(p.at)}${p.by ? ` · ${esc(p.by)}` : ''}`);
    if (p.expires) meta.push(`ينتهي ${when(p.expires)}`);
    if (p.status === 'github' && p.lastPull) meta.push(`آخر سحب ناجح ${when(p.lastPull)} · يشتغل تلقائياً من إعدادات النظام، مو من هذي الصفحة`);
    if (p.checked) meta.push(esc(p.checked));
    const drop = !['none', 'mcp', 'github'].includes(p.status) && !p.fields.length
      ? `<button class="btn sm ghost" type="button" data-drop="${p.id}">${icon('x')}فك الربط</button>` : '';
    const note = p.mcp && S.open !== p.id ? `<p class="muted cx-meta">${esc(p.help)}</p>` : '';
    const core = p.core ? `<span class="chip solid" title="${esc('يحتاجه: ' + p.core)}">${icon('alert')}أساسي</span>` : '';
    if (p.core) meta.unshift(`يحتاجه: ${esc(p.core)}`);
    return `<article class="card cx${p.core ? ' cx-core' : ''}" id="cx_${p.id}"><div class="cx-top">${logo(p)}<h3>${esc(p.name)}</h3>${core}${chip(p)}<div class="cx-acts">${btn}
      ${needIds ? `<button class="btn sm secondary" data-key="${p.id}">${icon('pen')}أضف رقم الحساب</button>` : ''}${drop}</div></div>
      <p class="muted cx-meta">${meta.join(' · ')}</p>${note}${S.open === p.id ? form(p) : ''}</article>`;
  }
  // What is typed in an open key form survives a redraw (the search box, opening another card): keys are long, losing them is the worst case
  const DRAFT = {};
  const keep = () => $$('[data-save]', $('#list')).forEach(f => { for (const i of $$('input,textarea', f)) if (i.name) (DRAFT[f.dataset.save] ||= {})[i.name] = i.value; });
  const restore = () => $$('[data-save]', $('#list')).forEach(f => { const d = DRAFT[f.dataset.save]; if (d) for (const i of $$('input,textarea', f)) if (i.name in d) i.value = d[i.name]; });
  function render() { keep(); draw(); restore(); }
  function draw() {
    const q = S.q.trim().toLowerCase();
    // Platforms nothing is built for yet (no numbers pulled, no publishing, no conversions) are not listed: a long list of
    // «مو مربوط» suggests abilities that do not exist. One that is already connected, or that the system needs, stays.
    const BUILT = new Set(['meta_pages', 'postiz', 'meta_capi', 'tiktok_events', 'snap_capi', 'search_console']);
    const shown = S.list.filter(p => p.fetch || p.core || BUILT.has(p.id) || p.status !== 'none');
    const list = shown.filter(p => !q || p.name.toLowerCase().includes(q) || p.id.includes(q));
    const isOn = p => ['ok', 'mcp', 'github'].includes(p.status);
    const ok = shown.filter(isOn).length;
    const core = shown.filter(p => p.core), coreOk = core.filter(isOn).length;
    $('#sum').textContent = `الأساسية ${coreOk} من ${core.length} · الكل ${ok} من ${shown.length}`;
    const coreList = list.filter(p => p.core);
    $('#list').innerHTML = (coreList.length ? `<h2 class="cx-h">أساسية لتشغيل النظام <span class="muted">(${coreOk} من ${core.length} مربوطة)</span></h2><div class="cx-list">${coreList.map(card).join('')}</div>` : '') + Object.entries(GROUP).map(([g, t]) => {
      const items = list.filter(p => p.group === g && !p.core);
      return items.length ? `<h2 class="cx-h">${t} <span class="muted">(${items.length})</span></h2><div class="cx-list">${items.map(card).join('')}</div>` : '';
    }).join('') || `<div class="card empty">${icon('search')}<div>ما فيه منصة بهالاسم</div></div>`;
  }
  async function load() {
    try {
      S.list = (await api('/api/connectors/list')).platforms;
      if (S.open) {
        const opened = S.list.find(x => x.id === S.open);
        if (opened && !opened.fields.length) { S.open = null; S.fallback.delete(opened.id); }
      }
      render();
    }
    catch (err) { $('#list').innerHTML = `<div class="card empty">${icon('alert')}<div>${esc(friendly(err))}</div><button class="btn secondary" id="retry" style="margin-top:12px">${icon('refresh')}حاول مرة ثانية</button></div>`; $('#retry').onclick = load; }
  }

  $('#list').addEventListener('click', async e => {
    const k = e.target.closest('[data-key]'), x = e.target.closest('[data-close]'), d = e.target.closest('[data-drop]');
    if (k) { S.open = S.open === k.dataset.key ? null : k.dataset.key; render(); $(`#cx_${k.dataset.key} input, #cx_${k.dataset.key} textarea`)?.focus(); }
    if (x) { delete DRAFT[S.open]; S.open = null; render(); }
    if (d) {
      const p = S.list.find(y => y.id === d.dataset.drop);
      if (!confirm(t(`فك ربط ${p.name}؟ المفاتيح المحفوظة تنمسح من الخزنة.`))) return;
      busy(d, true);
      try { await api('/api/connectors/disconnect', { method: 'POST', body: { platform: p.id } }); toast(`انفك ربط ${p.name}`); await load(); }
      catch (err) { busy(d, false); say($('#msg'), err.message); }
    }
  });
  $('#list').addEventListener('submit', async e => {
    const f = e.target.closest('[data-save]'); if (!f) return;
    e.preventDefault();
    const values = Object.fromEntries($$('input,textarea', f).map(i => [i.name, i.value]));
    const btn = $('button[type=submit]', f); busy(btn, true);
    try {
      const r = await api('/api/connectors/save', { method: 'POST', body: { platform: f.dataset.save, values } });
      delete DRAFT[f.dataset.save]; S.open = null; toast(r.checked || 'انحفظ'); await load();
    } catch (err) { busy(btn, false); say($('.msg', f), err.message); }
  });
  $('#q').addEventListener('input', e => { S.q = e.target.value; render(); });

  shell({ active: 'connectors', title: 'الربط' }).then(() => {
    const u = new URLSearchParams(location.search);
    if (u.get('ok')) toast('انربط ✓');
    if (u.get('err')) say($('#msg'), ERR[u.get('err')] || 'ما تم الربط');
    // الربط ما ضبط: نفتح البديل (الخانات) لنفس المنصة على طول
    if (u.get('err') && u.get('p')) { S.fallback.add(u.get('p')); S.open = u.get('p'); }
    if (u.get('ok') || u.get('err')) history.replaceState(null, '', '/connectors/');
    load().then(() => { if (S.open) $(`#cx_${S.open}`)?.scrollIntoView({ block: 'center' }); });
  }).catch(() => {});
}
