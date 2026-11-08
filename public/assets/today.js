// اليوم: صفحة البداية. كل جزء يطلع بس إذا المستخدم يقدر يفتح الصفحة اللي جاي منها (السيرفر يقرر في /api/today/state).
import { $, api, esc, icon, shell, say, when, day, fmt, sar, LANG, failure } from './common.js';
import { sections } from './sidebar.js';

const READY = new Set(['ok', 'mcp', 'github']);
const STALE_H = 3; // التحديث كل ساعة: أقدم من 3 ساعات = فيه شي واقف
const KIND = { new_campaign: 'حملة جديدة', pause: 'إيقاف', pause_campaign: 'إيقاف الحملة', budget_up: 'رفع الميزانية', budget_down: 'تنزيل الميزانية', refresh_creative: 'مادة إعلانية جديدة', resume: 'إعادة تشغيل' };
const L = (ar, en) => (LANG === 'en' ? en : ar);

export default async function mount() {
  const me = await shell({ active: 'today', title: 'اليوم' });
  const owner = me.role === 'owner', dept = (me.departments || []).length;
  $('#hello').textContent = `أهلاً ${me.name || ''}. ${owner ? 'هذي صورة اليوم للنظام كله.' : dept ? 'هذي صورة اليوم لقسمك.' : 'هذي صورة اليوم للي تشتغل عليه.'}`;

  // أدواتك: نفس أقسام القائمة، بس اللي يفتح لك
  const secs = sections(me, L).map(s => ({ ...s, items: s.items.filter(it => it.state === 'ok' && it.key !== 'today') })).filter(s => s.items.length);
  $('#mytools').innerHTML = secs.length ? secs.map(s => `<div class="td-sec"><h3>${esc(s.label)}</h3><div class="td-links">${s.items.map(it =>
    `<a href="${esc(it.href)}"${it.href === '/' || it.href.startsWith('/?') ? ' data-astro-reload' : ''}>${it.svg ? `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${it.svg}</svg>` : icon(it.ic)}<span>${esc(it.text)}</span></a>`).join('')}</div></div>`).join('')
    : '<p class="muted">ما عندك أدوات مفتوحة للحين. اطلب الصلاحية من مالكة اللوحة.</p>';

  let st;
  try { st = await api('/api/today/state'); } catch (err) { say($('#msg'), err.message); $('#next').hidden = true; failure($('#perf'), err, () => location.reload()); return; }
  const ready = [], miss = [];

  // البيانات
  const d = st.data;
  const age = d?.generated_at ? (Date.now() - Date.parse(d.generated_at)) / 36e5 : null;
  if (!d) $('#perf').textContent = 'أرقام الإعلانات تحتاج صلاحية «الحملات والمنصات» أو «المواد الإعلانية».';
  else if (d.none || !d.now) { $('#perf').textContent = 'ما فيه أرقام للحين.'; miss.push(['ما فيه أرقام إعلانات للحين', 'أول ما يربط حساب إعلاني ويشتغل التحديث الساعي، تطلع هنا.']); }
  else {
    const ch = (a, b, down) => { if (b == null || a == null || !b) return ''; const p = (a - b) / b * 100; const good = down ? p < 0 : p > 0; return ` <small dir="ltr" class="${good ? 'up' : 'down'}">${p > 0 ? '+' : ''}${fmt(p, 0)}%</small>`; };
    const b = d.before || {};
    $('#perf').innerHTML = `<div class="td-kpis">
      <div><small>الصرف</small><b>${sar(d.now.spend)} ر.س${ch(d.now.spend, b.spend)}</b></div>
      <div><small>النتائج</small><b>${fmt(d.now.results)}${ch(d.now.results, b.results)}</b></div>
      <div><small>تكلفة النتيجة</small><b>${sar(d.now.cpr)} ر.س${ch(d.now.cpr, b.cpr, true)}</b></div>
      <div><small>نسبة النقر</small><b>${d.now.ctr == null ? '—' : fmt(d.now.ctr * 100, 2) + '%'}</b></div></div>
      <p class="muted" style="margin:12px 0 0;font-size:13px">آخر 7 أيام كاملة (${esc(day(d.from))} – ${esc(day(d.to))})${d.before ? ' مقارنة بالـ7 اللي قبلها' : '. المقارنة مخفية لأن بيانات منصة ناقصة'}.</p>`;
    if (age != null && age <= STALE_H) ready.push(['البيانات محدّثة', `آخر تحديث ${when(d.generated_at)}`]);
    else miss.push(['البيانات متأخرة', `آخر تحديث ${when(d.generated_at)}. التحديث المفروض كل ساعة.`]);
    if (d.gaps?.length) miss.push(['بيانات ناقصة', `ما وصلت لآخر يوم من: ${d.gaps.join('، ')}`]);
  }

  // الربط
  for (const p of st.setup || []) (READY.has(p.status) ? ready : miss).push([p.name, READY.has(p.status) ? `مربوط · ${p.core}` : `${p.status === 'expired' ? 'انتهى الربط' : p.status === 'partial' ? 'الربط ناقص' : 'مو مربوط'} · يوقف: ${p.core}`]);
  const li = (cls, ic) => ([t, s]) => `<li class="${cls}">${icon(ic)}<span><b>${esc(t)}</b><br><span class="muted">${esc(s)}</span></span></li>`;
  $('#ready').innerHTML = ready.length ? ready.map(li('td-ok', 'check')).join('') : '<li class="muted">ما فيه شي نقدر نأكده من صلاحياتك.</li>';
  $('#miss').innerHTML = miss.length ? miss.map(li('td-miss', 'alert')).join('') : `<li class="td-ok">${icon('check')}<span>ما فيه شي ناقص${st.setup ? '' : ' في اللي تقدر تشوفه'}.</span></li>`;

  // أهم إجراء اليوم: اللي يوقف الشغل أول، بعدها القرارات، بعدها الأرقام
  const missing = (st.setup || []).filter(p => !READY.has(p.status));
  const dc = st.decisions;
  let next;
  if (missing.length) next = ['اربط ' + missing[0].name, `بدونها يوقف: ${missing[0].core}.`, '/connectors/', 'افتح الربط'];
  else if (d && age != null && age > STALE_H) next = ['البيانات متأخرة', `آخر تحديث ${when(d.generated_at)}. شيّك حالة الربط${st.setup ? '' : ' مع مالكة اللوحة'}.`, st.setup ? '/connectors/' : null, 'افتح الربط'];
  else if (dc?.open) {
    const top = dc.top || {};
    next = [`راجع ${dc.open === 1 ? 'اقتراح واحد' : dc.open === 2 ? 'اقتراحين' : `${dc.open} اقتراحات`} في لوحة القرارات`,
      `أولها: ${KIND[top.kind] || top.kind || ''} · ${top.target_name || ''}${top.reason ? ` — ${top.reason}` : ''}`, '/control/', 'افتح لوحة القرارات'];
  } else if (d?.now) next = ['ما فيه شي مستعجل', 'شوف ملخص الأداء وقارن الأسبوع باللي قبله.', secs.some(s => s.items.some(i => i.key === 'overview')) ? '/overview/' : '/', 'افتح ملخص الأداء'];
  else next = ['ابدأ من أدواتك', 'كل اللي تقدر تفتحه تحت.', null, ''];
  const [h, p, href, cta] = next;
  $('#next').innerHTML = `<div><small class="muted">أهم إجراء اليوم</small><h2>${esc(h)}</h2><p class="muted">${esc(p)}</p></div>${href ? `<a class="btn primary" href="${href}"${href === '/' ? ' data-astro-reload' : ''}>${esc(cta)}</a>` : ''}`;
}

