// فورم إطلاق حملة جديدة: تختار المنصة وتطلع خيارات إعلاناتها هي. الخانة الفاضية يعبيها كلود.
// الإرسال يسوي طلب "حملة جديدة" في لوحة القرارات، يمر على المراجع، ويحتاج موافقة لين. ما يطلق شي على المنصة بنفسه.
import { $, $$, esc, api, icon, shell, toast, busy, say } from './common.js';

const DEPTS = { iv: 'المحاليل الوريدية', midwife: 'القبالة / رعاية الحمل', foot: 'تقويم القدم', renan: 'رينان لصحة الطفل' };
const CODE = { iv: 'IV', midwife: 'Midwife', foot: 'Foot', renan: 'Renan' };
const PNAME = { meta: 'Meta', snap: 'Snap', tiktok: 'TikTok', google: 'Google' };
// كلمات تخالف تعليمات وزارة الصحة في الإعلان الصحي (تطلع تحذير قبل الإرسال)
const MOH = ['الأفضل', 'الوحيد', 'الأكثر', 'الخبير', 'مضمون', 'مضمونة', 'علاج فوري', 'نتائج مثبتة', 'تجارب المرضى', 'تجربة مريض', 'شفاء تام', '100%'];

const C = (id, label, type, opt = {}) => ({ id, label, type, ...opt });
const COMMON = [
  C('dept', 'القسم / الخدمة', 'select', { options: DEPTS, required: true }),
  C('name', 'اسم الحملة', 'text', { hint: 'الصيغة: Platform_service_DDMM. تتعبّى لحالها.' }),
  C('objective', 'الهدف', 'seg', { options: { leads: 'Leads', sales: 'Sales' }, value: 'leads', hint: 'Sales أو Leads بس. Traffic ممنوع.' }),
  C('budget', 'الميزانية اليومية (ريال)', 'number', { ai: true }),
  C('start', 'تاريخ البداية', 'date', { required: true }),
  C('end', 'تاريخ النهاية', 'date', { ai: true }),
  C('geo', 'الموقع', 'locked', { value: 'الرياض بس' }),
  C('age_min', 'العمر من', 'number', { value: 30, min: 30 }),
  C('age_max', 'إلى', 'select', { options: { '45': '45', '55': '55', '65': '65+' }, value: '65' }),
  C('gender', 'الجنس', 'seg', { options: { all: 'الكل', female: 'نساء', male: 'رجال' }, value: 'all' }),
  C('lang', 'لغة الإعلان', 'seg', { options: { ar: 'عربي', en: 'إنجليزي' }, value: 'ar' }),
  C('influencer', 'المؤثرة (اختياري)', 'text'),
  C('wa_message', 'رسالة واتساب الخاصة', 'text', { hint: 'لكل مؤثرة رسالة مختلفة عشان نعرف مصدر المحادثة.', ai: true }),
  C('creative', 'رابط الكرييتف (فيديو أو صورة)', 'url', { required: true }),
  C('primary', 'النص الأساسي', 'textarea', { ai: true }),
  C('headline', 'العنوان', 'text', { ai: true }),
  C('cta', 'زر الدعوة', 'select', { options: { whatsapp: 'راسلنا واتساب', book: 'احجز الآن', learn: 'اعرف أكثر', signup: 'سجّل' }, ai: true }),
];
const PLAT = {
  meta: [
    C('destination', 'وين يروح العميل', 'seg', { options: { whatsapp: 'واتساب', form: 'نموذج فوري', site: 'الموقع' }, value: 'whatsapp' }),
    C('optimization', 'التحسين على', 'select', { options: { conversations: 'المحادثات', leads: 'الليدز', purchase: 'الشراء' }, value: 'conversations' }),
    C('placements', 'أماكن الظهور', 'checks', { options: { fb_feed: 'فيسبوك فيد', ig_feed: 'إنستغرام فيد', ig_stories: 'ستوري', ig_reels: 'ريلز' }, value: ['ig_feed', 'ig_stories', 'ig_reels'], hint: 'يدوي. Advantage+ ممنوع.' }),
    C('budget_type', 'نوع الميزانية', 'seg', { options: { abo: 'على المجموعة (ABO)', cbo: 'على الحملة (CBO)' }, value: 'abo' }),
    C('partnership', 'إعلان شراكة مع حساب المؤثرة', 'toggle'),
    C('radius', 'نصف القطر', 'locked', { value: '10 ميل حول الرياض' }),
    C('pixel', 'البكسل', 'locked', { value: 'WELL PIXEL' }),
  ],
  snap: [
    C('ad_type', 'نوع الإعلان', 'seg', { options: { single: 'صورة أو فيديو', story: 'ستوري', collection: 'كولكشن' }, value: 'single' }),
    C('goal', 'الهدف في سناب', 'select', { options: { lead_form: 'نموذج ليد داخل سناب', website: 'سوايب للموقع', pixel_purchase: 'شراء (Pixel)' }, value: 'lead_form' }),
    C('qualify', 'سؤال التأهيل في النموذج', 'text', { hint: 'مثل: متى تبي الجلسة؟', ai: true }),
    C('bid', 'المزايدة', 'seg', { options: { auto: 'تلقائي', target: 'تكلفة مستهدفة' }, value: 'auto' }),
  ],
  tiktok: [
    C('spark', 'Spark Ad (من حساب المؤثرة)', 'toggle', { value: true }),
    C('spark_code', 'كود تفويض Spark', 'text', { hint: 'من المؤثرة: 7 أو 30 أو 60 أو 365 يوم.' }),
    C('optimization', 'التحسين على', 'select', { options: { leads: 'Lead generation', complete_payment: 'Complete Payment' }, value: 'complete_payment' }),
    C('lead_form', 'نموذج فوري', 'toggle'),
    C('pixel', 'البكسل', 'locked', { value: 'WELL Pixel (7655684600528846866)' }),
  ],
  google: [
    C('type', 'نوع الحملة', 'locked', { value: 'Search' }),
    C('keywords', 'الكلمات', 'textarea', { hint: 'كلمة في كل سطر.', ai: true }),
    C('negatives', 'كلمات سلبية', 'textarea', { value: 'وظائف\nتوظيف\nراتب\nدورة\nمجاني\nPDF', ai: true }),
    C('headlines', 'العناوين (8 إلى 15)', 'textarea', { hint: 'عنوان في كل سطر، 30 حرف بالكثير.', ai: true }),
    C('descriptions', 'الأوصاف (2 إلى 4)', 'textarea', { ai: true }),
    C('final_url', 'رابط الصفحة', 'url', { value: 'https://wellcare.sa/' }),
    C('bidding', 'المزايدة', 'select', { options: { max_conv: 'أكبر عدد تحويلات', tcpa: 'تكلفة تحويل مستهدفة' }, value: 'max_conv' }),
  ],
};

let platform = new URLSearchParams(location.search).get('p') || 'meta';
if (!PLAT[platform]) platform = 'meta';

function field(f) {
  const v = f.value ?? '';
  const ai = f.ai ? `<span class="chip line ai" data-tip="إذا خليتها فاضية يعبيها كلود">${icon('pen')}يعبيها كلود</span>` : '';
  const lab = `<label for="${f.id}">${f.label}${f.required ? ' <span class="req">*</span>' : ''} ${ai}</label>`;
  const hint = f.hint ? `<div class="muted">${f.hint}</div>` : '';
  let input;
  if (f.type === 'select') input = `<select id="${f.id}" name="${f.id}">${f.ai ? '<option value="">— كلود يختار —</option>' : ''}${Object.entries(f.options).map(([k, t]) => `<option value="${k}"${String(v) === k ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
  else if (f.type === 'seg') input = `<span class="seg" role="radiogroup" data-seg="${f.id}">${Object.entries(f.options).map(([k, t]) => `<button type="button" data-v="${k}" aria-pressed="${v === k}">${t}</button>`).join('')}</span><input type="hidden" name="${f.id}" value="${v}">`;
  else if (f.type === 'checks') input = `<div class="checks">${Object.entries(f.options).map(([k, t]) => `<label><input type="checkbox" name="${f.id}" value="${k}"${(v || []).includes(k) ? ' checked' : ''}> ${t}</label>`).join('')}</div>`;
  else if (f.type === 'toggle') input = `<label class="toggle"><input type="checkbox" name="${f.id}"${v ? ' checked' : ''}> <span>نعم</span></label>`;
  else if (f.type === 'locked') input = `<div class="locked">${icon('lock')}<span>${esc(v)}</span></div>`;
  else if (f.type === 'textarea') input = `<textarea id="${f.id}" name="${f.id}" placeholder="${f.ai ? 'فاضي = يعبيه كلود' : ''}">${esc(v)}</textarea>`;
  else input = `<input type="${f.type === 'url' ? 'url' : f.type}" id="${f.id}" name="${f.id}" value="${esc(v)}"${f.min ? ` min="${f.min}"` : ''} placeholder="${f.ai ? 'فاضي = يعبيه كلود' : ''}"${f.type === 'number' ? ' inputmode="decimal"' : ''}>`;
  return `<div class="fld fld-${f.type}">${lab}${input}${hint}</div>`;
}

function draw() {
  $('#plat').innerHTML = Object.entries(PNAME).map(([k, t]) => `<button type="button" role="tab" data-p="${k}" aria-selected="${k === platform}">${t}</button>`).join('');
  $('#f').innerHTML = `
    <section class="card pad"><h2>الأساسيات</h2><div class="grid2">${COMMON.slice(0, 6).map(field).join('')}</div></section>
    <section class="card pad"><h2>الجمهور</h2><div class="grid2">${COMMON.slice(6, 11).map(field).join('')}</div></section>
    <section class="card pad"><h2>خيارات ${PNAME[platform]}</h2><div class="grid2">${PLAT[platform].map(field).join('')}</div></section>
    <section class="card pad"><h2>الكرييتف والنص</h2><div class="grid2">${COMMON.slice(11).map(field).join('')}</div><div id="moh" class="msg"></div></section>
    <section class="card pad bar launch-foot"><span class="muted">الطلب يروح للوحة القرارات، يمر على المراجع، ويحتاج موافقة لين قبل أي إطلاق.</span><span class="grow"></span>
      <button class="btn primary" type="submit">${icon('check')}أرسل للموافقة</button><div class="msg" id="msg" role="status" style="flex-basis:100%"></div></section>`;
  $('#start').value = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
  autoName();
}
function autoName() {
  const n = $('#name'); if (!n || n.dataset.touched) return;
  const d = $('#dept').value, s = $('#start').value;
  const dd = s ? s.slice(8, 10) + s.slice(5, 7) : '';
  n.value = d ? `${PNAME[platform]}_${CODE[d]}_${dd}` : '';
}
function values() {
  const fd = new FormData($('#f')), out = {};
  for (const f of [...COMMON, ...PLAT[platform]]) {
    if (f.type === 'locked') { out[f.id] = f.value; continue; }
    if (f.type === 'checks') { out[f.id] = fd.getAll(f.id); continue; }
    if (f.type === 'toggle') { out[f.id] = fd.get(f.id) === 'on'; continue; }
    const v = fd.get(f.id); out[f.id] = v == null ? '' : String(v).trim();
  }
  return out;
}
function mohCheck(v) {
  const text = [v.primary, v.headline, v.wa_message, v.headlines, v.descriptions].join(' ');
  return MOH.filter(w => text.includes(w));
}

$('#f').addEventListener('click', e => {
  const b = e.target.closest('[data-seg] button'); if (!b) return;
  const seg = b.closest('[data-seg]');
  $$('button', seg).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  $(`input[name="${seg.dataset.seg}"]`).value = b.dataset.v;
});
$('#f').addEventListener('input', e => {
  if (e.target.id === 'name') e.target.dataset.touched = '1';
  if (e.target.id === 'dept' || e.target.id === 'start') autoName();
  const bad = mohCheck(values());
  const m = $('#moh');
  m.className = 'msg' + (bad.length ? ' err' : '');
  m.innerHTML = bad.length ? icon('alert') + esc(`كلمات تخالف تعليمات وزارة الصحة: ${bad.join('، ')}`) : '';
});
$('#plat').addEventListener('click', e => {
  const b = e.target.closest('[data-p]'); if (!b || b.dataset.p === platform) return;
  platform = b.dataset.p; history.replaceState(null, '', `?p=${platform}`); draw();
});
$('#f').addEventListener('submit', async e => {
  e.preventDefault();
  const v = values();
  if (!v.dept || !v.start || !v.creative) { say($('#msg'), 'عبّئ الخانات المطلوبة (*)'); return; }
  if (+v.age_min < 30) { say($('#msg'), 'العمر يبدأ من 30'); return; }
  const btn = e.submitter; busy(btn, true);
  try {
    const r = await api('/api/control/campaigns', { method: 'POST', body: { platform, fields: v } });
    toast('انرسل الطلب للموافقة');
    setTimeout(() => { location.href = `/control/?open=${r.id}`; }, 700);
  } catch (err) { say($('#msg'), err.message); busy(btn, false); }
});

shell({ active: 'control', title: 'حملة جديدة', badge: '<span class="chip line">تحتاج موافقة لين</span>' })
  .then(draw)
  .catch(err => { $('#content').innerHTML = `<div class="card empty">${icon('alert')}<div>${esc(err.message)}</div></div>`; });
