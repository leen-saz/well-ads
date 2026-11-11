// الرصد: (1) وش ينقال عننا وعن المنافسين بالكلمات من مصادر عامة، مع الشعور، وحصة الظهور في الإشارات والتنبيهات.
// (2) تبويب ثاني: تفاعل منشوراتنا العضوية والطلب من الـ CRM (يتحمّل أول ما ينفتح).
import { $, $$, api, say, esc, shell, fmt, busy, failure, LANG } from '/assets/common.js';
import { mountPeriod, rangeMs, diffDays, daysWord } from '/assets/period.js';
import { analyze, postsOf, demandAlerts } from '/modules/listening/analyze.js';
import { summarize, filterMentions, brandSuggestions, brandAdd, missingKeys } from '/modules/listening/social.js';

const NET = { facebook: 'فيسبوك', instagram: 'انستقرام', tiktok: 'تيك توك' };
const SRC = { meta_form: 'نموذج ميتا', meta_ctwa: 'واتساب من إعلان', whatsapp_ad_prefill: 'واتساب من إعلان', snapchat_form: 'نموذج سناب', tiktok_form: 'نموذج تيك توك',
  whatsapp_organic: 'واتساب بدون إعلان', manual: 'يدوي', cold_outreach: 'تواصل مباشر', website: 'الموقع', voice: 'اتصال', late_import: 'استيراد متأخر', partner_other: 'شركاء' };
const KEY = 'well-listen-kw';
const DEFAULT_KW = ['محاليل', 'فيتامين', 'ولادة', 'رعاية منزلية', 'قدم السكري'];
const pct = x => x == null ? 'جديد' : `${x > 0 ? '+' : ''}${Math.round(x * 100)}%`;
const L = (ar, en) => (LANG === 'en' ? en : ar);
const lift = x => x == null ? '—' : `${x.toFixed(1)}×`;

async function organicData() {
  // The dashboard page carries the data as JSON; read it the same way the dashboard does (same origin, same login)
  const html = await (await fetch('/', { credentials: 'same-origin', cache: 'no-store' })).text();
  const m = html.match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/);
  return m ? (JSON.parse(m[1]).organic || {}) : {};
}

async function organic() {
  let kw = DEFAULT_KW, range = null, ready = false, posts = [];
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); if (Array.isArray(s) && s.length) kw = s; } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(kw)); } catch {} };

  function drawKw() {
    $('#kw').innerHTML = kw.map((k, i) => `<span class="so-chip">${esc(k)} <button type="button" class="ls-x" data-del="${i}" aria-label="احذف ${esc(k)}">×</button></span>`).join('');
  }
  const card = p => `<article class="card ls-post"><div class="cp-meta"><b>${esc(NET[p.network] || p.network)}</b><span class="muted">${esc(String(p.date || '').slice(0, 10))}</span>
      <span class="so-chip">${fmt(p.eng)} تفاعل</span>${p.comments ? `<span class="so-chip">${fmt(p.comments)} تعليق</span>` : ''}${p.link ? `<a class="btn sm ghost" href="${esc(p.link)}" target="_blank" rel="noopener">افتح</a>` : ''}</div>
      <p class="cp-q" dir="auto">${esc(String(p.caption || p.text || '').slice(0, 280))}</p></article>`;

  function draw() {
    drawKw();
    if (!posts.length) {
      $('#out').innerHTML = `<div class="card dg-ok"><b>ما فيه منشورات عضوية للحين.</b><p class="muted" style="margin:6px 0 0">اربط "صفحة فيسبوك وحساب انستقرام" من صفحة الربط، وأول تحديث يجيب المنشورات هنا.</p></div>`;
      return;
    }
    if (!range) return;
    const r = analyze(posts, kw, { from: range.from, to: range.to });
    $('#sumO').innerHTML = `<div class="card"><b>${fmt(r.posts)}</b><span>${L('منشور في الفترة', 'posts in the period')}</span></div><div class="card"><b>${fmt(r.avg, 1)}</b><span>متوسط التفاعل للمنشور</span></div>`
      + Object.entries(r.networks).map(([n, v]) => `<div class="card"><b>${fmt(v.posts)}</b><span>${esc(NET[n] || n)}</span></div>`).join('');
    $('#out').innerHTML = `
      <section class="card pad"><h2>الكلمات اللي تتابعها</h2>
        <div class="tbl"><table class="dg-plat"><thead><tr><th>الكلمة</th><th>منشورات</th><th>متوسط التفاعل</th><th>مقارنة بالمعتاد</th><th>آخر ذكر</th></tr></thead><tbody>
        ${r.watch.map(w => `<tr><td>${esc(w.keyword)}</td><td class="n">${fmt(w.posts)}</td><td class="n">${w.posts ? fmt(w.avg, 1) : '—'}</td><td class="n">${lift(w.lift)}</td><td class="n">${esc(w.last || '—')}</td></tr>`).join('')}
        </tbody></table></div><p class="muted" style="margin:8px 0 0">"مقارنة بالمعتاد" = متوسط تفاعل منشورات الكلمة ÷ متوسط كل المنشورات. فوق 1× يعني الناس تتفاعل معها أكثر.</p></section>
      <section class="card pad"><h2>المواضيع اللي تشد</h2><div class="ls-topics">${r.topics.map(t => `<span class="so-chip" title="${fmt(t.posts)} منشور">${esc(t.word)} · ${lift(t.lift)}</span>`).join('') || '<span class="muted">يحتاج منشورات أكثر.</span>'}</div></section>
      <section><h2>منشورات تفاعلها ضعف المعتاد</h2><div class="dg-list">${r.standouts.map(card).join('') || '<p class="muted">ما فيه.</p>'}</div></section>
      <section><h2>منشورات فيها نقاش</h2><div class="dg-list">${r.talking.map(card).join('') || '<p class="muted">ما فيه.</p>'}</div></section>`;
  }

  async function demand() {
    try {
      const d = await api(`/api/listening/demand?from=${range.from}&to=${range.to}`);
      const alerts = demandAlerts(d.sources || []);
      $('#demand').innerHTML = (d.sources || []).length ? `<div class="tbl"><table class="dg-plat"><thead><tr><th>المصدر</th><th>${L('هالفترة', 'This period')}</th><th>${L('الفترة اللي قبلها', 'Period before')}</th><th>التغيّر</th></tr></thead><tbody>
          ${d.sources.map(s => { const a = alerts.find(x => x.source === s.source); return `<tr${a ? ' class="ls-alert"' : ''}><td>${esc(SRC[s.source] || s.source)}</td><td class="n">${fmt(s.now)}</td><td class="n">${fmt(s.prev)}</td><td class="n">${s.prev ? pct((s.now - s.prev) / s.prev) : '—'}</td></tr>`; }).join('')}
          </tbody></table></div>${alerts.length ? `<p class="dg-fix" style="margin:10px 0 0"><b>انتبه:</b> ${alerts.map(a => `${esc(SRC[a.source] || a.source)} ${pct(a.change)}`).join('، ')}</p>` : ''}`
        : `<p class="muted">${L('ما فيه ليدز في هالفترة وقبلها.', 'No leads in this period or the one before.')}</p>`;
    } catch (err) { failure($('#demand'), err, demand); }
  }

  $('#addKw').addEventListener('submit', e => { e.preventDefault(); const v = $('#kwIn').value.trim(); if (v && !kw.includes(v)) { kw = [...kw, v].slice(0, 20); save(); draw(); } $('#kwIn').value = ''; });
  $('#kw').addEventListener('click', e => { const b = e.target.closest('[data-del]'); if (!b) return; kw = kw.filter((_, i) => i !== +b.dataset.del); save(); draw(); });
  // The same period bar as every page; the posts, the words and the CRM demand all follow it. Saved in this browser (the tab has no address of its own)
  mountPeriod($('#orgPeriod'), { id: 'listening-organic', def: 'all', url: false, onChange: r => { range = r; if (ready) { draw(); demand(); } } });
  try { posts = postsOf(await organicData()); } catch (err) { say($('#msg'), 'ما قدرت أقرأ المنشورات العضوية: ' + err.message); }
  ready = true;
  demand();
  draw();
}

// ---------------- Social listening ----------------
const KIND = { brand: 'علامتنا', competitor: 'المنافسين', alert: 'كلمات التنبيه' };
const SENT = { positive: 'إيجابي', negative: 'سلبي', neutral: 'محايد', unscored: 'ما تصنّف للحين' };
const SOURCE = { news: 'أخبار', reddit: 'ريديت', youtube: 'يوتيوب', x: 'X', tiktok: 'تيك توك' };
// Colours: ours is the brand purple; competitors get muted indigo shades; sentiment strip uses deep / soft / pulse
const COL = ['#7E57FD', '#1D1069', '#221196', '#ACA6E1', '#5B4BC4', '#8F86D6', '#3A2FA0'];
const MOOD = { positive: 'var(--deep)', neutral: 'var(--soft)', negative: 'var(--pulse)', unscored: 'rgba(29,16,105,.12)' };
const pctS = x => `${Math.round(x * 100)}%`;
const day = s => (s ? String(s).slice(0, 10) : '—');

async function listening() {
  let W = [], M = [], range = null, ready = false, mseq = 0, shown = 15, filt = {};

  function setup(d) {
    // Nothing technical here: a normal user is told to ask the owner, the owner is sent to the data-health page
    $('#setup').innerHTML = d.missing ? `<section class="card pad" style="margin:0 0 16px"><h2 style="margin:0 0 6px">الرصد ما اكتمل تجهيزه</h2>
      <p style="margin:0">${d.owner ? 'التفاصيل وش ناقص في <a href="/maestro/health/">صحة الداتا</a>.' : 'بلّغ الإدارة عشان تكمل تجهيزه.'}</p></section>` : '';
    const s = d.sources || {};
    const chip = (on, label, need) => `<span class="${on ? '' : 'off'}">${on ? '✓' : '○'} ${esc(label)}${on || !need ? '' : ' · يحتاج تفعيل من الإدارة'}</span>`;
    $('#src').innerHTML = chip(s.news, 'الأخبار (قوقل، وإذا رفض فـ Bing)', '') + chip(s.reddit, 'ريديت', 1) + chip(s.youtube, 'يوتيوب', 1)
      + chip(s.x, 'X عن طريق Grok (مدفوع)', 1) + chip(s.tiktok, 'تيك توك عن طريق Grok (مدفوع)', 1) + chip(s.sentiment, 'تحليل الشعور', 1);
    const miss = d.missing ? [] : missingKeys(s);
    $('#keys').innerHTML = miss.length ? `<section class="card pad lx-keys"><h2 style="margin:0 0 6px">مصادر ما انفعّلت للحين</h2>
      <p class="muted" style="margin:0 0 8px">الرصد شغّال على الأخبار. كل مصدر هنا يضيف إشارات أكثر أول ما تفعّله الإدارة.</p>
      <ul>${miss.map(k => `<li><b>${esc(k.label)}</b> (${esc(k.cost)}): ${esc(k.adds)}</li>`).join('')}</ul>${d.owner ? '<p class="muted" style="margin:8px 0 0">طريقة التفعيل في <a href="/maestro/health/">صحة الداتا</a>.</p>' : ''}</section>` : '';
    $('#refresh').disabled = !!d.missing; $('#wf button[type=submit]').disabled = !!d.missing;
  }

  // علامتنا فاضية: تنبيه واضح مع كلمات Well الجاهزة، تنضاف بضغطة
  function drawBrand() {
    const none = !W.some(w => w.kind === 'brand'), sug = brandSuggestions(W);
    $('#brand').innerHTML = none && !$('#refresh').disabled ? `<section class="card pad lx-brand" aria-labelledby="brandH"><h2 id="brandH" style="margin:0 0 6px">ما فيه شي يراقب Well للحين</h2>
      <p style="margin:0 0 10px">"علامتنا" فاضية، فما راح تشوف وش ينقال عننا ولا حصتنا مقابل المنافسين. أضف كلمات Well، واضغط على أي وحدة تضيفها بروحها:</p>
      <div class="lx-sug">${sug.map(t => `<button type="button" class="so-chip" data-sug="${esc(t)}">+ ${esc(t)}</button>`).join('')}</div>
      <div class="bar" style="margin-top:10px"><button type="button" class="btn primary" data-sug-all>أضف الكلمات الأربع</button></div></section>` : '';
    const g = $('#watch [data-grp="brand"]');
    if (g && !none && sug.length) g.insertAdjacentHTML('beforeend', `<div class="lx-sug" style="margin-top:6px"><span class="muted">اقتراحات:</span>${sug.map(t => `<button type="button" class="so-chip" data-sug="${esc(t)}">+ ${esc(t)}</button>`).join('')}</div>`);
  }
  async function addBrand(terms, btn) {
    const body = brandAdd(W, terms); if (!body) return;
    busy(btn, true);
    try { await api('/api/listening/watch', { method: 'POST', body }); await load(); say($('#wmsg'), 'انضافت لعلامتنا. اضغط "حدّث الحين" عشان تجيب إشاراتها.', true); }
    catch (err) { say($('#wmsg'), err.message); busy(btn, false); }
  }
  $('#paneListen').addEventListener('click', e => {
    const one = e.target.closest('[data-sug]'), all = e.target.closest('[data-sug-all]');
    if (one) addBrand([one.dataset.sug], one);
    if (all) addBrand(brandSuggestions(W), all);
  });

  function drawWatch() {
    $('#watch').innerHTML = Object.entries(KIND).map(([k, label]) => {
      const list = W.filter(w => w.kind === k);
      return `<div class="lx-grp" data-grp="${k}"><h3>${label}</h3>${list.length ? list.map(w => `<div class="lx-item"><div><b>${esc(w.name)}</b>
          ${w.keywords.length ? `<div class="kw">${w.keywords.map(esc).join('، ')}</div>` : ''}
          ${w.kind === 'competitor' ? `<div class="lx-links">${w.adlibrary ? `<a class="btn sm ghost" href="${esc(w.adlibrary)}" target="_blank" rel="noopener">إعلاناته في مكتبة ميتا</a>` : ''}
            ${Object.entries(w.links || {}).filter(([n]) => n !== 'adlibrary').map(([n, v]) => `<span class="so-chip">${esc(n)}: ${esc(v)}</span>`).join('')}</div>` : ''}</div>
          <div class="bar"><button type="button" class="btn sm secondary" data-run="${w.id}">حدّثه</button><button type="button" class="btn sm ghost" data-del="${w.id}" aria-label="احذف ${esc(w.name)}">احذف</button></div></div>`).join('')
        : `<p class="muted" style="margin:0">${k === 'brand' ? 'فاضية: أضف كلمات Well من التنبيه فوق، أو اكتبها بنفسك تحت.' : k === 'competitor' ? 'أضف منافس عشان تقارن صوتك بصوته.' : 'كلمات تبي تنبيه أول ما تنذكر، مثل شكوى أو اسم منتج.'}</p>`}</div>`;
    }).join('');
    $('#fW').innerHTML = '<option value="">الكل</option>' + W.map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('');
    if (filt.watch) $('#fW').value = String(filt.watch);
  }

  function drawVoice(sum) {
    const v = sum.share.filter(r => r.total);
    if (!v.length) { $('#voice').innerHTML = `<div class="lx-empty"><p class="muted" style="margin:0">${W.length ? 'ما فيه إشارات في هالفترة. اضغط "حدّث الحين".' : 'أضف علامتنا ومنافس واحد على الأقل من "اللي نراقبه".'}</p></div>`; return; }
    const colour = new Map(sum.share.map((r, i) => [r.id, r.kind === 'brand' ? COL[0] : COL[1 + (i % (COL.length - 1))]]));
    const mood = r => ['positive', 'neutral', 'negative', 'unscored'].map(k => r[k] ? `<i style="width:${100 * r[k] / r.total}%;background:${MOOD[k]}" title="${SENT[k]} ${r[k]}"></i>` : '').join('');
    $('#voice').innerHTML = `<div class="lx-bar" role="img" aria-label="${esc(v.map(r => `${r.name} ${pctS(r.share)}`).join('، '))}">${v.map(r => `<div class="lx-seg" style="flex:${r.total};background:${colour.get(r.id)}"><span class="nm">${esc(r.name)} ${pctS(r.share)}</span><span class="mood">${mood(r)}</span></div>`).join('')}</div>
      <div class="tbl"><table class="lx-legend"><thead><tr><th>الجهة</th><th>الإشارات</th><th>الحصة</th><th>إيجابي</th><th>سلبي</th><th>محايد</th></tr></thead><tbody>
      ${sum.share.map(r => `<tr><td><span class="lx-dot" style="background:${colour.get(r.id)}"></span>${esc(r.name)}${r.kind === 'brand' ? ' <span class="muted">(نحن)</span>' : ''}</td><td class="n">${fmt(r.total)}</td><td class="n">${pctS(r.share)}</td>
        <td class="n">${r.total ? pctS(r.positive / r.total) : '—'}</td><td class="n">${r.total ? pctS(r.negative / r.total) : '—'}</td><td class="n">${r.total ? pctS(r.neutral / r.total) : '—'}</td></tr>`).join('')}</tbody></table></div>
      <p class="muted" style="margin:8px 0 0;font-size:13px"><span class="lx-dot" style="background:var(--deep)"></span>إيجابي <span class="lx-dot" style="background:var(--soft)"></span>محايد <span class="lx-dot" style="background:var(--pulse)"></span>سلبي</p>`;
  }

  function drawTrend(sum) {
    const unit = sum.step === 1 ? L('يوم بيوم', 'day by day') : sum.step === 7 ? L('أسبوع بأسبوع', 'week by week') : L('شهر بشهر', 'month by month');
    const max = Math.max(1, ...sum.weeks.map(w => w.positive + w.negative + w.neutral + w.unscored));
    if (!sum.weeks.some(w => w.positive + w.negative + w.neutral + w.unscored)) { $('#trend').innerHTML = '<p class="muted" style="margin:10px 0 0">يبان هنا بعد أول إشارات عن علامتنا.</p>'; return; }
    $('#trend').innerHTML = `<div class="lx-trend" role="img" aria-label="${L('شعور الناس', 'How people felt')} ${unit}">${sum.weeks.map(w => { const t = w.positive + w.negative + w.neutral + w.unscored;
      return `<div class="col" style="height:${Math.max(4, 100 * t / max)}%" title="${t} ${L('إشارة', 'mentions')}: ${w.positive} ${L('إيجابي', 'positive')}, ${w.negative} ${L('سلبي', 'negative')}">${['positive', 'neutral', 'unscored', 'negative'].map(k => w[k] ? `<i style="height:${100 * w[k] / t}%;background:${MOOD[k]}"></i>` : '').join('')}</div>`; }).join('')}</div>
      <div class="lx-trend-l">${sum.weeks.map(w => `<span>${new Date(w.start + 3 * 36e5).toISOString().slice(5, 10)}</span>`).join('')}</div>`;
  }

  function drawAlerts(sum) {
    $('#alerts').innerHTML = sum.alerts.map(a => a.type === 'negative'
      ? `<div class="card lx-alert critical"><b>${L(`الكلام السلبي عن ${esc(a.name)} زاد`, `Negative talk about ${esc(a.name)} went up`)}</b><p style="margin:4px 0 0">${L(`${pctS(a.now)} من الإشارات آخر ${daysWord(sum.window)} سلبية، كانت ${pctS(a.before)} المدة اللي قبلها. افتح الإشارات السلبية تحت وشوف السبب.`, `${pctS(a.now)} of the mentions in the last ${daysWord(sum.window, 'en')} are negative, up from ${pctS(a.before)} in the same length before. Open the negative mentions below to see why.`)}</p></div>`
      : `<div class="card lx-alert"><b>${L(`كلمة "${esc(a.name)}" انذكرت ${fmt(a.count)} مرة آخر ${daysWord(sum.window)}`, `The word "${esc(a.name)}" was mentioned ${fmt(a.count)} times in the last ${daysWord(sum.window, 'en')}`)}</b></div>`).join('');
  }

  function drawMentions() {
    const [from, to] = range ? rangeMs(range.from, range.to) : [0, Infinity];
    const list = filterMentions(M, filt).filter(m => { const t = Date.parse(m.published_at || m.fetched_at || '') || 0; return t >= from && t < to; });
    const name = new Map(W.map(w => [w.id, w.name]));
    $('#ments').innerHTML = list.slice(0, shown).map(m => `<article class="lx-m">${/^https:\/\//i.test(String(m.url || '').trim()) ? `<a href="${esc(m.url)}" target="_blank" rel="noopener noreferrer" dir="auto">${esc(m.title || m.url)}</a>` : `<span dir="auto">${esc(m.title || '')}</span>`}
        ${m.snippet ? `<p class="muted" style="margin:0;font-size:14px" dir="auto">${esc(m.snippet.slice(0, 220))}</p>` : ''}
        <div class="lx-meta"><span class="lx-s ${m.sentiment || 'unscored'}">${SENT[m.sentiment || 'unscored']}</span>${m.reason ? `<span>${esc(m.reason)}</span>` : ''}
          <span>· ${esc(SOURCE[m.source] || m.source)}</span>${m.author ? `<span>· ${esc(m.author)}</span>` : ''}<span>· ${esc(name.get(m.watch_id) || '')}</span><span>· ${day(m.published_at)}</span></div></article>`).join('')
      || `<p class="muted" style="margin:0">${M.length ? 'ما فيه إشارات بهالفلتر.' : 'ما فيه إشارات للحين.'}</p>`;
    $('#more').hidden = list.length <= shown;
  }

  function drawAll() { if (!range) return; const [, to] = rangeMs(range.from, range.to); const sum = summarize(W, M, to, diffDays(range.from, range.to) + 1); drawWatch(); drawBrand(); drawVoice(sum); drawTrend(sum); drawAlerts(sum); drawMentions(); }

  async function load() {
    const d = await api('/api/listening/watch'); setup(d); W = d.watches || [];
    if (!d.missing) await loadMentions(); else drawAll();
  }
  // The mentions of the chosen period (the server cuts them to it); a slower answer for an earlier period is dropped
  async function loadMentions() {
    const mine = ++mseq;
    const m = await api(`/api/listening/mentions?from=${range.from}&to=${range.to}`);
    if (mine !== mseq) return;
    M = m.mentions || []; shown = 15; drawAll();
  }

  $('#wk').addEventListener('change', () => { $('#wl').hidden = $('#wk').value !== 'competitor'; });
  $('#wf').addEventListener('submit', async e => {
    e.preventDefault(); const btn = e.submitter; busy(btn, true);
    try {
      await api('/api/listening/watch', { method: 'POST', body: { kind: $('#wk').value, name: $('#wn').value, keywords: $('#wkw').value,
        links: { instagram: $('#wig').value, tiktok: $('#wtt').value, x: $('#wx').value, website: $('#wweb').value } } });
      ['#wn', '#wkw', '#wig', '#wtt', '#wx', '#wweb'].forEach(s => { $(s).value = ''; });
      say($('#wmsg'), 'انضاف. اضغط "حدّثه" عشان يجيب إشاراته الحين.', true); await load();
    } catch (err) { say($('#wmsg'), err.message); }
    busy(btn, false);
  });
  $('#watch').addEventListener('click', async e => {
    const del = e.target.closest('[data-del]'), run = e.target.closest('[data-run]');
    if (del) {
      if (!confirm('تحذفه مع إشاراته؟')) return;
      busy(del, true); try { await api('/api/listening/unwatch', { method: 'POST', body: { id: +del.dataset.del } }); await load(); say($('#wmsg'), 'انحذف.', true); } catch (err) { say($('#wmsg'), err.message); busy(del, false); }
    }
    if (run) { busy(run, true); await refresh(+run.dataset.run); busy(run, false); }
  });
  // Sources that refused, per watch: "ايفر كير: قوقل رفض (503)"
  const ASKED = { google: 'قوقل', bing: 'Bing', reddit: 'ريديت', youtube: 'يوتيوب', x: 'X', tiktok: 'تيك توك' };
  function failures(report = {}) {
    const bad = Object.entries(report).flatMap(([name, by]) => Object.entries(by || {}).filter(([, v]) => typeof v === 'string')
      .map(([src, v]) => `${name}: ${ASKED[src] || src} رفض (${String(v).replace('error ', '')})`));
    return bad.length ? ` ما جاوب: ${bad.join('، ')}.` : '';
  }
  async function refresh(id) {
    say($('#lmsg'), 'يدوّر في المصادر… ياخذ ثواني', true);
    try {
      const r = await api('/api/listening/refresh', { method: 'POST', body: id ? { id } : {} });
      say($('#lmsg'), r.ran ? `خلص: ${fmt(r.added)} إشارة جديدة، وانصنّف شعور ${fmt(r.scored)}.${failures(r.report)}` : (r.note || 'ما فيه شي يحتاج تحديث.'), true);
      await load();
    } catch (err) { say($('#lmsg'), err.message); }
  }
  $('#refresh').addEventListener('click', async e => { const b = e.currentTarget; busy(b, true); await refresh(0); busy(b, false); });
  ['#fW', '#fS', '#fSrc'].forEach(s => $(s).addEventListener('change', () => { filt = { watch: +$('#fW').value || 0, sentiment: $('#fS').value, source: $('#fSrc').value }; shown = 15; drawMentions(); }));
  $('#more').addEventListener('click', () => { shown += 15; drawMentions(); });

  // One period bar for the whole tab: the shares, the trend, the alerts and the list all follow it. In the address and saved in this browser
  mountPeriod($('#lxPeriod'), { id: 'listening', def: '30', onChange: r => { range = r; if (ready) loadMentions().catch(err => say($('#lmsg'), err.message)); } });
  try { await load(); } catch (err) { say($('#lmsg'), err.message); }
  ready = true;
}

export default async function mount() {
  let organicDone = false;
  const show = tab => {
    $$('[data-tab]').forEach(b => { const on = b.dataset.tab === tab; b.setAttribute('aria-selected', String(on)); b.setAttribute('aria-pressed', String(on)); });
    $('#paneListen').hidden = tab !== 'listen'; $('#paneOrganic').hidden = tab !== 'organic';
    try { const u = new URL(location.href); u.searchParams.set('tab', tab); history.replaceState(history.state, '', u.pathname + u.search); } catch {}
    if (tab === 'organic' && !organicDone) { organicDone = true; organic(); }
  };
  $$('[data-tab]').forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));
  await shell({ active: 'listening', title: 'الرصد' });
  show(new URLSearchParams(location.search).get('tab') === 'organic' ? 'organic' : 'listen');
  await listening();
}
