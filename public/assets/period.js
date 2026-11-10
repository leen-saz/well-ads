// The period filter: ONE segmented bar (اليوم، أمس، أسبوع، شهر، هذا الشهر، كل الفترة، اختيار تاريخ) used by every page that
// is not the main dashboard (ملخص اليوم، الرصد، المدير). It looks and works like the dashboard's filter: the same quick
// periods, and the same calendar (first click the start, second the end, from/to fields, Apply).
//
// Two halves in one file, so nothing is written twice:
//  - the range math (no DOM): Riyadh days as YYYY-MM-DD strings. The server routes import it too (from/to validation).
//  - mountPeriod(): draws the bar and the calendar, keeps the choice in the URL and in localStorage.
// Days are Riyadh days (UTC+3, no DST) everywhere.

/** @typedef {{today?: string, last?: string, min?: string}} Ctx */
/** @typedef {{key: string, from: string, to: string}} Period */
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_SPAN = 366; // the most days one request may ask for
const DAY_MS = 864e5;

// ---- range math (pure)
const toD = s => new Date(s + 'T00:00:00Z');
const toS = d => d.toISOString().slice(0, 10);
/** @param {string} s @param {number} n @returns {string} */
export const addDays = (s, n) => { const d = toD(s); d.setUTCDate(d.getUTCDate() + n); return toS(d); };
/** @param {string} a @param {string} b @returns {number} */
export const diffDays = (a, b) => Math.round((toD(b) - toD(a)) / DAY_MS);
// A real calendar day written YYYY-MM-DD (2026-02-30 is not one)
/** @param {unknown} s @returns {boolean} */
export const isDay = s => typeof s === 'string' && DAY_RE.test(s) && Number.isFinite(toD(s).getTime()) && toS(toD(s)) === s;
// Today in Riyadh (UTC+3 all year)
/** @param {number} [now] @returns {string} */
export const riyadhToday = (now = Date.now()) => toS(new Date(now + 3 * 36e5));
// The instants a day range covers, both days included: [fromMs, toMs)
/** @param {string} s @returns {number} */
export const dayStartMs = s => Date.parse(s + 'T00:00:00+03:00');
/** @param {string} from @param {string} to @returns {[number, number]} */
export const rangeMs = (from, to) => [dayStartMs(from), dayStartMs(to) + DAY_MS];

// key: what is saved and put in the URL. '7' and '30' keep the names the dashboard uses; '90' is not on the bar any more
// (the old 90-day button) and still resolves, so an old saved choice keeps working.
export const PRESETS = [
  { key: 't', ar: 'اليوم', en: 'Today' },
  { key: 'y', ar: 'أمس', en: 'Yesterday' },
  { key: '7', ar: 'أسبوع', en: 'Week' },
  { key: '30', ar: 'شهر', en: 'Month' },
  { key: 'tm', ar: 'هذا الشهر', en: 'This month' },
  { key: 'all', ar: 'كل الفترة', en: 'All time' },
];
const LEGACY = { '90': 90 };

// ctx: today (Riyadh), last (the last day with data, default today), min (the first day the page has, default a year back)
const norm = ctx => {
  const today = isDay(ctx?.today) ? ctx.today : riyadhToday();
  const min = isDay(ctx?.min) && ctx.min <= today ? ctx.min : addDays(today, -(MAX_SPAN - 1));
  const last = isDay(ctx?.last) && ctx.last <= today && ctx.last >= min ? ctx.last : today;
  return { today, last, min };
};
/** @param {string} s @param {Ctx} [ctx] @returns {string} */
export const clampDay = (s, ctx) => { const { today, min } = norm(ctx); return s < min ? min : s > today ? today : s; };
// from/to in order and inside [min, today]
/** @param {string} from @param {string} to @param {Ctx} [ctx] @returns {[string, string]} */
export function clampRange(from, to, ctx) {
  let a = clampDay(from, ctx), z = clampDay(to, ctx);
  if (a > z) [a, z] = [z, a];
  return [a, z];
}
// The quick periods. Week and month end on the last day with data (like the dashboard); today and all-time on today.
/** @param {string} key @param {Ctx} [ctx] @returns {[string, string] | null} */
export function resolvePreset(key, ctx) {
  const { today, last, min } = norm(ctx);
  const sized = (n, end) => clampRange(addDays(end, -(n - 1)), end, { today, min });
  switch (String(key)) {
    case 't': return [today, today];
    case 'y': { const y = clampDay(addDays(today, -1), { today, min }); return [y, y]; }
    case '7': return sized(7, last);
    case '30': return sized(30, last);
    case 'tm': return clampRange(today.slice(0, 8) + '01', today, { today, min });
    case 'all': return [min, today];
    default: { const n = LEGACY[String(key)]; return n ? sized(n, last) : null; }
  }
}
// What a page asked for → { key, from, to }. key is a preset name, or 'custom' for a day range. Anything that does not
// parse falls back to the page's default, never to an error.
/** @param {{key?: string | null, from?: string | null, to?: string | null} | null} want @param {Ctx} [ctx] @param {string} [def] @returns {Period} */
export function pick(want, ctx, def = '30') {
  const w = want || {};
  if (w.from != null || w.to != null) {
    if (isDay(w.from) && isDay(w.to)) { const [from, to] = clampRange(w.from, w.to, ctx); return { key: 'custom', from, to }; }
  } else if (w.key != null) {
    const r = resolvePreset(w.key, ctx);
    // an old 90-day choice is no button now: it comes back as that range of days
    if (r) return { key: LEGACY[String(w.key)] ? 'custom' : String(w.key), from: r[0], to: r[1] };
  }
  const key = resolvePreset(def, ctx) ? String(def) : '30', r = resolvePreset(key, ctx);
  return { key, from: r[0], to: r[1] };
}
// The server side: ?from=&to= (Riyadh days) or the old ?days=N. Returns { from, to, days } or { error } for text that is not
// a real day. A span over MAX_SPAN is cut to its last MAX_SPAN days; to after today is today; from after to are swapped.
/** @param {(k: string) => string | null} get @param {number} [now] @param {{days?: number, maxDays?: number}} [opt] @returns {{from: string, to: string, days: number} | {error: string}} */
export function parseRangeParams(get, now = Date.now(), { days = 30, maxDays = MAX_SPAN } = {}) {
  const today = riyadhToday(now), f = get('from'), t = get('to');
  let from, to;
  if (f != null || t != null) {
    if (!isDay(f) || !isDay(t)) return { error: 'bad_range' };
    from = f; to = t;
    if (from > to) [from, to] = [to, from];
    if (to > today) to = today;
    if (from > to) from = to;
  } else {
    const n = Number(get('days'));
    const span = Number.isInteger(n) && n >= 1 && n <= maxDays ? n : days;
    to = today; from = addDays(today, -(span - 1));
  }
  if (diffDays(from, to) + 1 > maxDays) from = addDays(to, -(maxDays - 1));
  return { from, to, days: diffDays(from, to) + 1 };
}
// "24 days" in the page language: 1 يوم، 2 يومين، 3 إلى 10 أيام، بعدها يوم
/** @param {number} n @param {string} [lang] @returns {string} */
export function daysWord(n, lang = 'ar') {
  if (lang === 'en') return `${n} ${n === 1 ? 'day' : 'days'}`;
  return n === 1 ? 'يوم' : n === 2 ? 'يومين' : n <= 10 ? `${n} أيام` : `${n} يوم`;
}

// ---- the bar
const MONTHS = {
  ar: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
const WEEK = { ar: ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'], en: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] };
const TX = {
  ar: { period: 'الفترة', custom: 'اختيار تاريخ', from: 'من', to: 'إلى', apply: 'تطبيق', cancel: 'إلغاء', pickStart: 'اختار يوم البداية', pickEnd: 'اختار يوم النهاية', prev: 'الشهر السابق', next: 'الشهر التالي', day: 'يوم' },
  en: { period: 'Period', custom: 'Custom dates', from: 'From', to: 'To', apply: 'Apply', cancel: 'Cancel', pickStart: 'Pick the first day', pickEnd: 'Pick the last day', prev: 'Previous month', next: 'Next month', day: 'days' },
};
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pageLang = () => { try { return document.documentElement.lang === 'en' ? 'en' : 'ar'; } catch { return 'ar'; } };
const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>';
let uid = 0;

// mountPeriod(host, opts) → { get, set, update }
//   id        names the choice (URL parameters and the saved key)
//   def       the preset used when nothing is chosen/saved ('30')
//   ctx       { today, last, min } as above; update({ctx}) when the data arrives
//   url       true: the choice is also in the address (?range=30 or ?from=…&to=…); false: saved in this browser only
//   onChange  called with { key, from, to } once on start and after every change
/** @param {HTMLElement} host @param {{id?: string, def?: string, ctx?: Ctx, lang?: string, label?: string, url?: boolean, onChange?: (p: Period) => void}} [opts]
 *  @returns {{get: () => Period, update: (next?: Ctx) => void, destroy: () => void}} */
export function mountPeriod(host, opts = {}) {
  const id = opts.id || 'period', lang = opts.lang || pageLang(), tx = TX[lang], months = MONTHS[lang];
  const n = ++uid, useUrl = opts.url !== false, store = `well-ads-period:${id}`;
  let ctx = norm(opts.ctx), cur;
  const dp = { from: '', to: '', month: '' };
  const nice = s => { const d = toD(s), m = months[d.getUTCMonth()], day = d.getUTCDate(); return lang === 'en' ? `${m} ${day}` : `${day} ${m}`; };

  // wanted choice: the address first, then what this browser saved, then the page's default
  const fromUrl = () => { if (!useUrl) return null; const q = new URLSearchParams(location.search); const r = q.get('range'); return q.has('from') || q.has('to') ? { from: q.get('from'), to: q.get('to') } : r ? { key: r } : null; };
  const fromStore = () => { try { const v = JSON.parse(localStorage.getItem(store) || 'null'); if (!v) return null; return v.key === 'custom' ? { from: v.from, to: v.to } : { key: v.key ?? (v.days ? String(v.days) : null) }; } catch { return null; } };
  const read = () => pick(fromUrl() || fromStore(), ctx, opts.def);
  const write = () => {
    try { localStorage.setItem(store, JSON.stringify(cur.key === 'custom' ? { key: 'custom', from: cur.from, to: cur.to } : { key: cur.key })); } catch { /* storage blocked */ }
    if (!useUrl) return;
    const u = new URL(location.href);
    for (const k of ['range', 'from', 'to']) u.searchParams.delete(k);
    if (cur.key === 'custom') { u.searchParams.set('from', cur.from); u.searchParams.set('to', cur.to); } else u.searchParams.set('range', cur.key);
    try { history.replaceState(history.state, '', u.pathname + u.search + u.hash); } catch { /* ignore */ }
  };

  host.classList.add('pf-wrap');
  host.innerHTML = `<div class="pf" role="group" aria-label="${esc(opts.label || tx.period)}">${PRESETS.map(p => `<button type="button" data-k="${p.key}" aria-pressed="false">${esc(p[lang])}</button>`).join('')}<button type="button" class="pf-custom" data-k="custom" aria-haspopup="dialog" aria-expanded="false" aria-pressed="false" aria-controls="pf-pop-${n}">${ICON}<span class="pf-lbl">${esc(tx.custom)}</span></button></div>
    <div class="pf-pop" id="pf-pop-${n}" role="dialog" aria-label="${esc(tx.custom)}" hidden>
      <div class="pf-head"><button type="button" class="pf-nav" data-nav="-1" aria-label="${esc(tx.prev)}"></button><b class="pf-month"></b><button type="button" class="pf-nav" data-nav="1" aria-label="${esc(tx.next)}"></button></div>
      <div class="pf-week" aria-hidden="true">${WEEK[lang].map(d => `<span>${d}</span>`).join('')}</div>
      <div class="pf-grid"></div>
      <div class="pf-fields"><label>${esc(tx.from)} <input type="date" class="pf-from"></label><label>${esc(tx.to)} <input type="date" class="pf-to"></label></div>
      <div class="pf-foot"><span class="pf-sel"></span><button type="button" class="pf-cancel">${esc(tx.cancel)}</button><button type="button" class="pf-apply">${esc(tx.apply)}</button></div>
    </div>`;
  const $ = s => host.querySelector(s), bar = $('.pf'), pop = $('.pf-pop'), cbtn = $('.pf-custom');
  const isOpen = () => !pop.hidden;
  const rtl = () => getComputedStyle(pop).direction === 'rtl';

  function paint() {
    for (const b of bar.querySelectorAll('button[data-k]')) b.setAttribute('aria-pressed', String(b.dataset.k === cur.key));
    $('.pf-lbl').textContent = cur.key === 'custom' ? (cur.from === cur.to ? nice(cur.from) : `${nice(cur.from)} – ${nice(cur.to)}`) : tx.custom;
  }
  function draw() {
    const [y, m] = dp.month.split('-').map(Number), first = `${dp.month}-01`;
    const count = new Date(Date.UTC(y, m, 0)).getUTCDate(), lead = toD(first).getUTCDay();
    $('.pf-month').textContent = `${months[m - 1]} ${y}`;
    const lo = dp.from, hi = dp.to || dp.from, cells = Array.from({ length: lead }, () => '<span></span>');
    for (let d = 1; d <= count; d++) {
      const s = `${dp.month}-${String(d).padStart(2, '0')}`, off = s < ctx.min || s > ctx.today;
      const cls = [s === lo ? 's' : '', s === hi ? 'e' : '', lo && s > lo && s < hi ? 'in' : '', s === ctx.today ? 'today' : ''].filter(Boolean).join(' ');
      cells.push(`<button type="button" data-d="${s}" class="${cls}" aria-label="${nice(s)} ${y}" aria-pressed="${s === lo || s === hi || (!!lo && s > lo && s < hi)}"${off ? ' disabled' : ''}>${d}</button>`);
    }
    $('.pf-grid').innerHTML = cells.join('');
    const prev = pop.querySelector('[data-nav="-1"]'), next = pop.querySelector('[data-nav="1"]'), r = rtl();
    prev.textContent = r ? '›' : '‹'; next.textContent = r ? '‹' : '›';
    prev.disabled = first <= ctx.min.slice(0, 7) + '-01'; next.disabled = first >= ctx.today.slice(0, 7) + '-01';
    $('.pf-from').min = $('.pf-to').min = ctx.min; $('.pf-from').max = $('.pf-to').max = ctx.today;
    $('.pf-from').value = dp.from; $('.pf-to').value = dp.to || dp.from;
    $('.pf-sel').textContent = !dp.from ? tx.pickStart : !dp.to ? tx.pickEnd : `${nice(dp.from)} – ${nice(dp.to)} (${daysWord(diffDays(dp.from, dp.to) + 1, lang)})`;
    $('.pf-apply').disabled = !dp.from;
  }
  function show(on) {
    pop.hidden = !on; cbtn.setAttribute('aria-expanded', String(on));
    if (!on) return;
    dp.from = cur.from; dp.to = cur.to; dp.month = cur.to.slice(0, 7);
    draw();
    (pop.querySelector('.pf-grid .e') || pop.querySelector('.pf-grid button:not(:disabled)'))?.focus();
  }
  function move(k) { const [y, m] = dp.month.split('-').map(Number); dp.month = toS(new Date(Date.UTC(y, m - 1 + k, 1))).slice(0, 7); draw(); }
  function choose(next, save = true) {
    cur = next; paint(); if (save) write();
    opts.onChange?.({ ...cur });
  }

  bar.addEventListener('click', e => {
    const b = e.target.closest('button[data-k]'); if (!b) return;
    if (b.dataset.k === 'custom') { show(!isOpen()); return; }
    show(false);
    const r = resolvePreset(b.dataset.k, ctx); if (r) choose({ key: b.dataset.k, from: r[0], to: r[1] });
  });
  pop.addEventListener('click', e => {
    const nav = e.target.closest('[data-nav]'); if (nav) { move(+nav.dataset.nav); return; }
    const b = e.target.closest('.pf-grid button[data-d]'); if (!b || b.disabled) return;
    const d = b.dataset.d;
    if (!dp.from || dp.to) { dp.from = d; dp.to = ''; } else if (d < dp.from) { dp.to = dp.from; dp.from = d; } else dp.to = d;
    draw(); pop.querySelector(`.pf-grid button[data-d="${d}"]`)?.focus();
  });
  // Arrow keys move a day (right/left follow the reading direction), up/down a week; Escape closes
  pop.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); show(false); cbtn.focus(); return; }
    const b = e.target.closest && e.target.closest('.pf-grid button[data-d]'); if (!b) return;
    const r = rtl(), step = { ArrowLeft: r ? 1 : -1, ArrowRight: r ? -1 : 1, ArrowUp: -7, ArrowDown: 7 }[e.key]; if (!step) return;
    e.preventDefault();
    let d = addDays(b.dataset.d, step); d = d < ctx.min ? ctx.min : d > ctx.today ? ctx.today : d;
    if (d.slice(0, 7) !== dp.month) { dp.month = d.slice(0, 7); draw(); }
    pop.querySelector(`.pf-grid button[data-d="${d}"]`)?.focus();
  });
  // The typed fields set the same pending range; Apply makes it the choice
  for (const c of ['.pf-from', '.pf-to']) $(c).addEventListener('change', () => {
    const f = $('.pf-from').value, t = $('.pf-to').value; if (!isDay(f)) return;
    const [a, z] = clampRange(f, isDay(t) ? t : f, ctx); dp.from = a; dp.to = z; dp.month = z.slice(0, 7); draw();
  });
  $('.pf-apply').addEventListener('click', () => {
    if (!dp.from) return;
    const [from, to] = clampRange(dp.from, dp.to || dp.from, ctx);
    show(false); choose({ key: 'custom', from, to }); cbtn.focus();
  });
  $('.pf-cancel').addEventListener('click', () => { show(false); cbtn.focus(); });
  // An outside click closes it (the path is read from the event: a day click redraws the grid, so its button is gone)
  const outside = e => { if (isOpen() && !e.composedPath().includes(host)) show(false); };
  document.addEventListener('click', outside);

  cur = read(); paint(); write(); opts.onChange?.({ ...cur });
  return {
    get: () => ({ ...cur }),
    // New data bounds (today / last day / first day): quick periods are worked out again, a custom range is kept inside them
    update(next = {}) {
      ctx = norm({ ...ctx, ...next });
      const before = `${cur.from}${cur.to}`;
      cur = cur.key === 'custom' ? pick({ from: cur.from, to: cur.to }, ctx) : pick({ key: cur.key }, ctx, opts.def);
      paint();
      if (before !== `${cur.from}${cur.to}`) opts.onChange?.({ ...cur });
    },
    destroy() { document.removeEventListener('click', outside); host.innerHTML = ''; },
  };
}
