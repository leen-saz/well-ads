// صحة الداتا (للمالكة): بطاقات قراءة فقط. كل بطاقة تجيب أرقامها من /api/maestro/<اسمها>.
import { ownerText } from '/assets/freshness.js';
import { $, api, say, esc, fmt, shell, failure, pageFailure, when } from '/assets/common.js';

const STATUS = { paid: 'مدفوع', unpaid: 'غير مدفوع', pending: 'معلّق', partial: 'مدفوع جزئي', refunded: 'مسترجع', '(empty)': 'فاضي', other: 'قيمة ثانية' };
const FINDING = {
  table_missing: 'جدول الليدز غير موجود: شغّل مايقريشن 011_crm_leads أول.',
  no_leads: 'ما فيه ليدز مخزّنة. تأكد إن CRM_API_KEY موجود وإن مزامنة الـ CRM اشتغلت.',
  no_payments_at_all: 'ما فيه ولا ليد عنده دفع (لا حالة مدفوع ولا مبلغ). المشكلة من الـ CRM نفسه: الدفع ما يوصل لنا.',
  amount_under_other_status: 'فيه ليدز عندها مبلغ مدفوع لكن حالة الدفع مو «مدفوع». هذي ما تنحسب إقفالات: غالباً قيمة حالة الدفع مختلفة عن اللي نتوقعه (انظر الجدول).',
  paid_without_amount: 'فيه ليدز حالتها «مدفوع» بس المبلغ صفر أو فاضي. هذي ما تنحسب إقفالات ولا تدخل في الإيراد.',
  mostly_unlinked: 'أغلب الإقفالات بدون إعلان مربوط، فتطلع في الإجمالي وما تنسب لإعلان.',
  paid_stale: 'آخر دفع مسجّل قبل أكثر من 14 يوم. يمكن الدفع ما يتسجّل في الـ CRM أو ما يوصلنا.',
  sync_stale: 'آخر تحديث وصلنا من الـ CRM قبل أكثر من 3 أيام. المزامنة متوقفة أو ما فيه تغييرات.',
};
const kpi = (n, t) => `<div class="card dh-kpi"><b>${n}</b><span>${t}</span></div>`;
const table = (head, rows) => `<table class="dh-tbl"><thead><tr>${head.map((h, i) => `<th class="${i ? 'n' : ''}">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td class="${i ? 'n' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

export function crmCard(d) {
  const p = d.paid;
  const finds = d.findings.map(f => FINDING[f]).filter(Boolean).map(t => `<p class="dh-find bad">${esc(t)}</p>`).join('') || '<p class="dh-find ok">ما لقينا مشكلة واضحة في الدفع.</p>';
  const status = Object.entries(d.by_status).sort((a, b) => b[1] - a[1]).map(([s, n]) => [esc(STATUS[s] || s) + (STATUS[s] ? ` <span class="muted">(${esc(s)})</span>` : ''), fmt(n)]);
  const other = Object.entries(d.amount_not_paid_status).map(([s, n]) => [esc(STATUS[s] || s), fmt(n)]);
  const months = Object.entries(d.by_month).map(([m, v]) => [esc(m), fmt(v.closings), fmt(v.amount_sar)]);
  return `<section class="card pad dh-sec"><h2>ليدز الـ CRM والدفع</h2><p class="muted" style="margin:0">الإقفالة = حالة الدفع «paid» ومبلغ أكبر من صفر.</p>${finds}
    <div class="dh-kpis">${kpi(fmt(d.leads), 'ليدز مخزّنة')}${kpi(fmt(p.count), 'إقفالات (مدفوع ومبلغ)')}${kpi(fmt(p.amount_sar) + ' ر.س', 'مبلغ الإقفالات')}
      ${kpi(fmt(d.paid_status_no_amount), 'مدفوع بمبلغ صفر أو فاضي')}${kpi(fmt(p.linked), 'إقفالات مربوطة بإعلان')}${kpi(fmt(p.unlinked), 'إقفالات بدون إعلان')}</div>
    <div class="dh-kpis">${kpi(when(d.newest_updated_at), 'أحدث تحديث (updated_at)')}${kpi(when(d.newest_paid_at), 'أحدث دفع (paid_at)')}</div>
    <h3>الليدز حسب حالة الدفع</h3>${status.length ? table(['الحالة', 'ليدز'], status) : '<p class="muted">لا شي.</p>'}
    ${other.length ? `<h3>مبلغ مدفوع تحت حالة غير «مدفوع»</h3>${table(['الحالة', 'ليدز'], other)}` : ''}
    <h3>الإقفالات والمبالغ حسب شهر الدفع</h3>${months.length ? table(['الشهر', 'إقفالات', 'المبلغ (ر.س)'], months) : '<p class="muted">لا شي.</p>'}
    ${p.count ? `<p class="muted">المربوطة بإعلان: ${fmt(p.linked_amount_sar)} ر.س. بدون إعلان: ${fmt(p.unlinked_amount_sar)} ر.س.</p>` : ''}</section>`;
}

const PLAT = { meta: 'Meta', snap: 'Snapchat', tiktok: 'TikTok', google: 'Google' };
const TABLE = { ads: 'الإعلانات', ad_metrics: 'أرقام الإعلانات اليومية', crm_leads: 'ليدز الـ CRM', listen_watch: 'قوائم الرصد', listen_mentions: 'الإشارات', knowledge: 'المعرفة', brand_assets: 'الهوية والبصريات', copy_projects: 'مشاريع الكتابة', motion_projects: 'مشاريع الموشن', social_posts: 'منشورات السوشال', audit_log: 'سجل النشاط' };
const DUP = { ads: 'إعلانات (نفس المنصة والاسم والحملة)', leads: 'ليدز (نفس العميل والمصدر ووقت الإنشاء)', mentions: 'إشارات (نفس المصدر والعنوان)', knowledge: 'بنود معرفة (نفس النوع والعنوان والنص)', library: 'عناصر الهوية (نفس النوع والعنوان)' };
const ORPHAN = { ads: 'إعلانات', crm_leads: 'ليدز', audit_log: 'سجل نشاط', connections: 'ربط منصات' };
const age = iso => { if (!iso) return ['—', 'bad']; const h = (Date.now() - Date.parse(iso)) / 36e5; return [when(iso), h > 48 ? 'bad' : '']; };
const dayAge = d => { if (!d) return ['—', 'bad']; const h = (Date.now() - Date.parse(d + 'T00:00:00+03:00')) / 36e5; return [esc(d), h > 72 ? 'bad' : '']; };
const cell = ([t, bad]) => (bad ? `<b style="color:#8A2A1B">${t}</b>` : t);

const WHYTXT = { id: 'مربوطة برقم الإعلان', name: 'مربوطة باسم الإعلان', via_customer: 'منسوبة لإعلان سابق لنفس العميل', source: 'مصدرها مو إعلان (واتساب عضوي، يدوي…)', no_id: 'مصدرها إعلان بس بدون رقم إعلان', broken_id: 'رقم الإعلان تالف من الاستيراد', not_in_ads: 'رقم الإعلان مو بين الإعلانات المسحوبة' };
const attribution = A => !A || !A.paid ? '' : `<h3>وين راحت الإقفالات المدفوعة؟</h3>${table(['السبب', 'إقفالات'], Object.entries(A.why).filter(([, n]) => n).map(([k, n]) => [esc(WHYTXT[k] || k), fmt(n)]))}`
  + (Object.keys(A.unmatched_sources).length ? `<p class="muted">مصادر الإقفالات اللي بدون إعلان: ${Object.entries(A.unmatched_sources).map(([k, n]) => `<code>${esc(k)}</code> ${fmt(n)}`).join('، ')}</p>` : '');

const STEP = { tiktok: 'تيك توك (MCP)', crm: 'سحب الـ CRM', suggest: 'اقتراحات لوحة القرارات', learn: 'حلقة التعلّم', critic: 'المراجع (critic)', execute: 'تنفيذ القرارات المعتمدة' };
// Each non-blocking step of the hourly run: did it work last time, and when did it last work
const stepsTable = S => {
  const rows = Object.entries(S || {}).map(([k, v]) => [esc(STEP[k] || k), v.ok === false ? '<b style="color:#8A2A1B">فشلت</b>' : v.ok ? 'اشتغلت' : '—', cell(age(v.at)), cell(age(v.last_ok))]);
  return rows.length ? table(['الخطوة', 'آخر مرة', 'وقتها', 'آخر نجاح'], rows) : '<p class="muted">ما فيه حالة خطوات للحين (تظهر بعد أول تحديث ساعي).</p>';
};

export function healthCards(h) {
  const f = h.freshness, J = h.joins;
  const warn = (h.data_status ? ownerText(h.data_status) : []).map(t => `<p class="dh-find bad">${esc(t)}</p>`).join('');
  const fresh = h.data_status && h.data_status.level === 'ok' ? '<p class="dh-find ok">الأرقام محدّثة والتحديث الساعي يشتغل.</p>' : '';
  const plat = table(['المنصة', 'إعلانات', 'آخر تحديث للإعلانات', 'آخر يوم أرقام', 'انتهاء الربط'], f.platforms.map(p => [esc(PLAT[p.platform] || p.platform), fmt(p.ads), cell(age(p.newest_ad_update)), cell(dayAge(p.newest_metric_day)), p.token_expires_at ? when(p.token_expires_at) : '—']));
  const other = table(['المصدر', 'آخر مرة'], [
    ['مزامنة الـ CRM (آخر تشغيل)', cell(age(f.crm?.last_run_at))], ['أحدث تحديث وصل من الـ CRM', cell(age(f.crm?.last_updated_at))],
    ['جلب الرصد', cell(age(f.listening_last_fetch))], ['رفع ملف الأرقام (dash.json)', cell(age(f.dash_json_uploaded))]]);
  const counts = table(['الجدول', 'الصفوف'], Object.entries(h.counts).map(([t, n]) => [esc(TABLE[t] || t), n == null ? '<span class="muted">ما انقرا</span>' : fmt(n)]));
  const joins = J ? table(['الربط', 'العدد', 'النسبة'], [['ليدز CRM', fmt(J.leads), ''], ['مربوطة بإعلان', fmt(J.matched), J.matched_pct == null ? '—' : J.matched_pct + '%'], ['بدون إعلان', fmt(J.unmatched), ''],
    ['كل الإقفالات', fmt(J.closings_all), ''], ['إقفالات مربوطة بإعلان', fmt(J.closings_with_ad), J.closings_pct == null ? '—' : J.closings_pct + '%'], ['منسوبة بالعميل لإعلان سابق', fmt(J.credited_via_customer), '']])
    : '<p class="muted">ما فيه dash.json مرفوع للحين.</p>';
  const attr = J ? attribution(J.attribution) : '';
  const dups = table(['المكرر', 'الصفوف الزايدة'], Object.entries(h.duplicates).map(([k, n]) => [esc(DUP[k] || k), cell([fmt(n), n > 0])]));
  const orph = table(['الجدول', 'صفوف شركتها محذوفة'], Object.entries(h.orphans).map(([k, n]) => [esc(ORPHAN[k] || k), n == null ? '<span class="muted">ما انقرا</span>' : cell([fmt(n), n > 0])]));
  const miss = h.migrations_missing.length
    ? `<p class="dh-find bad">مايقريشنات ما انطبقت (بالترتيب): ${[...new Set(h.migrations_missing.map(m => m.migration))].map(m => `<code>${esc(m)}</code>`).join('، ')}</p>` + table(['المايقريشن', 'الجدول', 'ناقص'], h.migrations_missing.map(m => [esc(m.migration), esc(m.table), m.reason === 'table' ? 'الجدول كله' : esc(m.columns.join(', '))]))
    : '<p class="dh-find ok">كل الجداول والأعمدة اللي يقراها الكود موجودة.</p>';
  const sec = (t, body, note = '') => `<section class="card pad dh-sec"><h2>${t}</h2>${note ? `<p class="muted" style="margin:0 0 8px">${note}</p>` : ''}${body}</section>`;
  return (warn || fresh ? sec('حالة التحديث', warn + fresh + (h.data_status ? stepsTable(h.data_status.steps) : ''), 'عمر الأرقام، وهل بدأ التحديث الساعي. ما يلمس الداتابيس.') : '') + sec('حداثة المصادر', plat + other, 'آخر مرة وصلتنا بيانات كل منصة. الأحمر = أقدم من يومين.') + sec('الربط بين الليدز والإعلانات', joins + attr, 'من آخر ملف أرقام انرفع.')
    + sec('المكرر', dups) + sec('اليتيم', orph, 'صفوف تشير إلى شركة ما عاد لها وجود.') + sec('عدد الصفوف', counts) + sec('المايقريشنات', miss);
}

// «الأداء»: Core Web Vitals of the last 24 hours per page (75th percentile). Green = inside Google's target.
const TG = { lcp: 2500, inp: 200, cls: 0.1, ttfb: 800 };
export function vitalsCard(d) {
  if (d.missing) return `<section class="card pad dh-sec"><h2>الأداء (آخر 24 ساعة)</h2><p class="dh-find bad">${esc(d.missing)}</p></section>`;
  const c = (v, key, fmtV) => v == null ? '<td class="n">—</td>' : `<td class="n"><b style="color:${v <= TG[key] ? '#1F6B3A' : '#8A2A1B'}">${fmtV(v)}</b></td>`;
  const s = v => fmt(v / 1000, 2), ms = v => fmt(v, 0), cls = v => fmt(v, 3);
  const rows = d.pages.map(p => `<tr><td dir="ltr" style="text-align:start">${esc(p.path)}</td><td class="n">${fmt(p.n)}</td>${c(p.lcp, 'lcp', s)}${c(p.inp, 'inp', ms)}${c(p.cls, 'cls', cls)}${c(p.ttfb, 'ttfb', ms)}</tr>`).join('');
  return `<section class="card pad dh-sec"><h2>الأداء (آخر 24 ساعة)</h2><p class="muted" style="margin:0">من زيارات حقيقية، لكل صفحة: الرقم اللي يغطي 75% من الزيارات. الهدف: أكبر عنصر ≤ 2.5 ثانية، التفاعل ≤ 200 مللي، الاهتزاز ≤ 0.1. بدون أي بيانات شخصية.</p>
    ${d.pages.length ? `<table class="dh-tbl"><thead><tr><th>الصفحة</th><th class="n">زيارات</th><th class="n">أكبر عنصر (ث)</th><th class="n">التفاعل (مللي)</th><th class="n">الاهتزاز</th><th class="n">رد الخادم (مللي)</th></tr></thead><tbody>${rows}</tbody></table>
    ${d.capped ? '<p class="muted">الأرقام من آخر 1000 تقرير.</p>' : ''}` : '<p class="muted">ما وصل أي تقرير آخر 24 ساعة.</p>'}</section>`;
}

export default async function mount() {
  shell({ active: 'maestro', title: 'صحة الداتا' }).then(async () => {
    const box = $('#sections');
    // The cards sit in their final order from the start, and every request starts at once, but each card is FILLED in that order.
    // A card that arrives early waits for the ones above it: filling out of order (or prepending) pushed the visible ones down (layout shift).
    const vbox = document.createElement('div'), lbox = document.createElement('div'), cbox = document.createElement('div'), holder = document.createElement('div');
    box.replaceChildren(vbox, lbox, cbox, holder);
    // Listening sources that are off, with the key names and where to get them (owner only: the Listening tab shows plain words)
    const LISTEN = [
      { src: 'youtube', label: 'يوتيوب', keys: 'YOUTUBE_API_KEY', where: 'Google Cloud ← APIs ← YouTube Data API v3 ← Credentials ← API key' },
      { src: 'x', label: 'X وتيك توك عن طريق Grok', keys: 'XAI_API_KEY', where: 'console.x.ai ← API keys' },
      { src: 'reddit', label: 'ريديت', keys: 'REDDIT_CLIENT_ID و REDDIT_CLIENT_SECRET', where: 'reddit.com/prefs/apps ← create app ← نوع script' },
    ];
    const loadVitals = async (first) => { try { vbox.innerHTML = vitalsCard(await (first || api('/api/maestro/vitals'))); } catch (err) { failure(vbox, err, () => loadVitals()); } };
    const loadListen = async (first) => {
      try {
        const d = await (first || api('/api/listening/watch'));
        const off = d.missing ? [] : LISTEN.filter(k => !d.sources?.[k.src]);
        lbox.innerHTML = d.missing ? `<section class="card pad"><h2 style="margin:0 0 6px">الرصد: ما اكتمل تجهيزه</h2><p class="muted" style="margin:0">جداول الرصد ناقصة. شغّل <code>013_listening.sql</code> من مجلد supabase/migrations في Supabase ← SQL Editor، وبعدها ارجع هنا.</p></section>`
          : off.length ? `<section class="card pad"><h2 style="margin:0 0 6px">الرصد: مصادر ما انفعّلت</h2><p class="muted" style="margin:0 0 8px">أسرار في Cloudflare: Workers ← well-ads ← Settings ← Variables and Secrets ← Add ← Secret.</p>
            <ul>${off.map(k => `<li><b>${esc(k.label)}</b>: <code>${esc(k.keys)}</code> · من ${esc(k.where)}</li>`).join('')}</ul></section>` : '';
      } catch (err) { failure(lbox, err, () => loadListen()); }
    };
    // The requests start together; the cards fill top to bottom
    const pV = api('/api/maestro/vitals'), pL = api('/api/listening/watch'), pC = api('/api/maestro/crm');
    for (const p of [pV, pL, pC]) p.catch(() => {});
    await loadVitals(pV);
    await loadListen(pL);
    try { cbox.innerHTML = crmCard(await pC); } catch (err) { failure(cbox, err, () => location.reload()); }
    // One request per part: each stays under the platform's per-request call limit
    const h = { duplicates: {}, counts: {}, orphans: {}, migrations_missing: [], freshness: { platforms: [] }, joins: null };
    for (const part of ['sources', 'content', 'counts', 'schema']) {
      try { const r = await api('/api/maestro/health?part=' + part); Object.assign(h, r, { duplicates: { ...h.duplicates, ...(r.duplicates || {}) } }); holder.innerHTML = healthCards(h); }
      catch (err) { say($('#msg'), err.message); }
    }
  }).catch(pageFailure);
}
