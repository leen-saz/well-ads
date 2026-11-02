// الرصد: وش يتفاعل معه الناس في منشوراتنا (فيسبوك، انستقرام، تيك توك)، الكلمات اللي نتابعها، والطلب من الـ CRM.
// التحليل يشتغل في المتصفح من بيانات اللوحة نفسها، والسيرفر يرجع عدد الليدز لكل مصدر بس.
import { $, $$, api, say, esc, shell, fmt } from '/assets/common.js';
import { analyze, postsOf, demandAlerts } from '/modules/listening/analyze.js';

const NET = { facebook: 'فيسبوك', instagram: 'انستقرام', tiktok: 'تيك توك' };
const SRC = { meta_form: 'نموذج ميتا', meta_ctwa: 'واتساب من إعلان', whatsapp_ad_prefill: 'واتساب من إعلان', snapchat_form: 'نموذج سناب', tiktok_form: 'نموذج تيك توك',
  whatsapp_organic: 'واتساب بدون إعلان', manual: 'يدوي', cold_outreach: 'تواصل مباشر', website: 'الموقع', voice: 'اتصال', late_import: 'استيراد متأخر', partner_other: 'شركاء' };
const KEY = 'well-listen-kw';
const DEFAULT_KW = ['محاليل', 'فيتامين', 'ولادة', 'رعاية منزلية', 'قدم السكري'];
const pct = x => x == null ? 'جديد' : `${x > 0 ? '+' : ''}${Math.round(x * 100)}%`;
const lift = x => x == null ? '—' : `${x.toFixed(1)}×`;

async function organicData() {
  // The dashboard page carries the data as JSON; read it the same way the dashboard does (same origin, same login)
  const html = await (await fetch('/', { credentials: 'same-origin', cache: 'no-store' })).text();
  const m = html.match(/<script type="application\/json" id="data">([\s\S]*?)<\/script>/);
  return m ? (JSON.parse(m[1]).organic || {}) : {};
}

export default async function mount() {
  let kw = DEFAULT_KW, days = 90, posts = [];
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
    const r = analyze(posts, kw, days);
    $('#sumO').innerHTML = `<div class="card"><b>${fmt(r.posts)}</b><span>منشور آخر ${days} يوم</span></div><div class="card"><b>${fmt(r.avg, 1)}</b><span>متوسط التفاعل للمنشور</span></div>`
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
      const d = await api('/api/listening/demand');
      const alerts = demandAlerts(d.sources || []);
      $('#demand').innerHTML = (d.sources || []).length ? `<div class="tbl"><table class="dg-plat"><thead><tr><th>المصدر</th><th>هالأسبوع</th><th>الأسبوع اللي قبله</th><th>التغيّر</th></tr></thead><tbody>
          ${d.sources.map(s => { const a = alerts.find(x => x.source === s.source); return `<tr${a ? ' class="ls-alert"' : ''}><td>${esc(SRC[s.source] || s.source)}</td><td class="n">${fmt(s.now)}</td><td class="n">${fmt(s.prev)}</td><td class="n">${s.prev ? pct((s.now - s.prev) / s.prev) : '—'}</td></tr>`; }).join('')}
          </tbody></table></div>${alerts.length ? `<p class="dg-fix" style="margin:10px 0 0"><b>انتبه:</b> ${alerts.map(a => `${esc(SRC[a.source] || a.source)} ${pct(a.change)}`).join('، ')}</p>` : ''}`
        : '<p class="muted">ما فيه ليدز آخر أسبوعين.</p>';
    } catch (err) { $('#demand').innerHTML = `<p class="muted">${esc(err.message)}</p>`; }
  }

  $('#addKw').addEventListener('submit', e => { e.preventDefault(); const v = $('#kwIn').value.trim(); if (v && !kw.includes(v)) { kw = [...kw, v].slice(0, 20); save(); draw(); } $('#kwIn').value = ''; });
  $('#kw').addEventListener('click', e => { const b = e.target.closest('[data-del]'); if (!b) return; kw = kw.filter((_, i) => i !== +b.dataset.del); save(); draw(); });
  $$('[data-days]').forEach(b => b.addEventListener('click', () => { days = +b.dataset.days; $$('[data-days]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); draw(); }));

  await shell({ active: 'listening', title: 'الرصد' });
  demand();
  try { posts = postsOf(await organicData()); } catch (err) { say($('#msg'), 'ما قدرت أقرأ المنشورات العضوية: ' + err.message); }
  draw();
}
