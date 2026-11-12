// الرصد: حساب حصة الظهور في الإشارات، والمشاعر عبر الأسابيع، والتنبيهات من الإشارات المحفوظة. يشتغل في المتصفح (بدون كلفة على السيرفر).
const DAY = 864e5;
// Under this many mentions in the period the share of voice moves a lot with one article: the page says so
export const SMALL_SAMPLE = 30;
const at = m => Date.parse(m.published_at || m.fetched_at || '') || 0;

// The period is [now - days, now): `now` is where it ends (the end of its last Riyadh day), `days` how long it is.
// The recent-days alerts look at the last `window` days of it (7, or all of it when it is shorter) against the same length before.
export function summarize(watches, mentions, now = Date.now(), days = 30) {
  const from = now - days * DAY, window = Math.min(7, days), w7 = now - window * DAY, w14 = now - 2 * window * DAY;
  const by = new Map(watches.map(w => [w.id, { ...w, total: 0, positive: 0, negative: 0, neutral: 0, unscored: 0, last7: 0, neg7: 0, prev7: 0, negPrev7: 0 }]));
  for (const m of mentions) {
    const o = by.get(m.watch_id), t = at(m); if (!o || t >= now) continue;
    if (t >= from) { o.total++; o[m.sentiment || 'unscored']++; }
    if (t >= w7) { o.last7++; if (m.sentiment === 'negative') o.neg7++; }
    else if (t >= w14) { o.prev7++; if (m.sentiment === 'negative') o.negPrev7++; }
  }
  const rows = [...by.values()];
  const voice = rows.filter(r => r.kind !== 'alert');
  const all = voice.reduce((s, r) => s + r.total, 0);
  const share = voice.map(r => ({ id: r.id, name: r.name, kind: r.kind, total: r.total, share: all ? r.total / all : 0,
    positive: r.positive, negative: r.negative, neutral: r.neutral, unscored: r.unscored })).sort((a, b) => b.total - a.total);

  // Sentiment for our brand across the period, oldest first: a bar per day (up to 14 days), per week (up to 90) or per 30 days
  const brandIds = new Set(rows.filter(r => r.kind === 'brand').map(r => r.id));
  const step = days <= 14 ? 1 : days <= 90 ? 7 : 30, count = Math.ceil(days / step);
  const weeks = Array.from({ length: count }, (_, i) => ({ start: from + i * step * DAY, positive: 0, negative: 0, neutral: 0, unscored: 0 }));
  for (const m of mentions) {
    if (!brandIds.has(m.watch_id)) continue;
    const t = at(m), i = Math.floor((t - from) / (step * DAY));
    if (t < now && i >= 0 && i < count) weeks[i][m.sentiment || 'unscored']++;
  }

  const alerts = [];
  for (const r of rows) {
    if (r.kind === 'alert' && r.last7) alerts.push({ level: 'warn', type: 'keyword', name: r.name, count: r.last7 });
    if (r.kind === 'brand' && r.last7 >= 5) {
      const now7 = r.neg7 / r.last7, before = r.prev7 ? r.negPrev7 / r.prev7 : 0;
      if (now7 - before >= 0.15) alerts.push({ level: 'critical', type: 'negative', name: r.name, now: now7, before });
    }
  }
  return { share, weeks, step, window, alerts, rows, sample: { total: all, small: all < SMALL_SAMPLE, min: SMALL_SAMPLE } };
}

// قائمة الإشارات بعد الفلتر: الكل، أو جهة وحدة، أو السلبي بس
export function filterMentions(mentions, f) {
  return mentions.filter(m => (f.watch ? m.watch_id === f.watch : true) && (f.sentiment ? m.sentiment === f.sentiment : true) && (f.source ? m.source === f.source : true));
}

// كلمات Well الجاهزة: تنعرض لما تكون "علامتنا" فاضية، وتنضاف بضغطة (ما تنضاف من نفسها)
export const WELL_TERMS = ['ويل يونيون', 'تطبيق ويل', 'wellunion', 'wellcare'];
const low = s => String(s || '').trim().toLowerCase();

// الاقتراحات اللي مو موجودة في علامتنا للحين
export function brandSuggestions(watches, terms = WELL_TERMS) {
  const have = new Set(watches.filter(w => w.kind === 'brand').flatMap(w => [w.name, ...(w.keywords || [])]).map(low));
  return terms.filter(t => !have.has(low(t)));
}

// وش ينرسل لـ /api/listening/watch عشان تنضاف الكلمات: علامة جديدة باسم أول كلمة، أو تنضاف لكلمات علامتنا الموجودة (8 بالكثير)
export function brandAdd(watches, add) {
  const b = watches.find(w => w.kind === 'brand');
  const want = add.filter(t => brandSuggestions(watches, [t]).length);
  if (!want.length) return null;
  if (!b) return { kind: 'brand', name: want[0], keywords: want.slice(1), links: {} };
  return { id: b.id, kind: 'brand', name: b.name, keywords: [...(b.keywords || []), ...want].slice(0, 8), links: b.links || {} };
}

// المصادر اللي ما انفعّلت: وش يضيف كل مصدر لو انفعّل (نص عادي للمستخدم). أسماء المفاتيح وأماكنها بس في صفحة صحة الداتا (للمالكة).
export const KEYS = [
  { src: 'youtube', label: 'يوتيوب', adds: 'فيديوهات ومراجعات تذكرنا وتذكر المنافسين.', cost: 'مجاني (حصة يومية)' },
  { src: 'x', label: 'X وتيك توك عن طريق Grok', adds: 'التغريدات ومقاطع تيك توك اللي تذكرنا، وتحليل شعور أدق.', cost: 'مدفوع لكل بحث' },
  { src: 'reddit', label: 'ريديت', adds: 'نقاشات الناس وأسئلتهم في ريديت.', cost: 'مجاني' },
];
export const missingKeys = (sources = {}) => KEYS.filter(k => !sources[k.src]);
