// الرصد: حساب حصة الصوت، والمشاعر عبر الأسابيع، والتنبيهات من الإشارات المحفوظة. يشتغل في المتصفح (بدون كلفة على السيرفر).
const DAY = 864e5;
const at = m => Date.parse(m.published_at || m.fetched_at || '') || 0;

export function summarize(watches, mentions, now = Date.now(), days = 30) {
  const from = now - days * DAY, w7 = now - 7 * DAY, w14 = now - 14 * DAY;
  const by = new Map(watches.map(w => [w.id, { ...w, total: 0, positive: 0, negative: 0, neutral: 0, unscored: 0, last7: 0, neg7: 0, prev7: 0, negPrev7: 0 }]));
  for (const m of mentions) {
    const o = by.get(m.watch_id), t = at(m); if (!o) continue;
    if (t >= from) { o.total++; o[m.sentiment || 'unscored']++; }
    if (t >= w7) { o.last7++; if (m.sentiment === 'negative') o.neg7++; }
    else if (t >= w14) { o.prev7++; if (m.sentiment === 'negative') o.negPrev7++; }
  }
  const rows = [...by.values()];
  const voice = rows.filter(r => r.kind !== 'alert');
  const all = voice.reduce((s, r) => s + r.total, 0);
  const share = voice.map(r => ({ id: r.id, name: r.name, kind: r.kind, total: r.total, share: all ? r.total / all : 0,
    positive: r.positive, negative: r.negative, neutral: r.neutral, unscored: r.unscored })).sort((a, b) => b.total - a.total);

  // Weekly sentiment for our brand (8 weeks, oldest first)
  const brandIds = new Set(rows.filter(r => r.kind === 'brand').map(r => r.id));
  const weeks = Array.from({ length: 8 }, (_, i) => ({ start: now - (8 - i) * 7 * DAY, positive: 0, negative: 0, neutral: 0, unscored: 0 }));
  for (const m of mentions) {
    if (!brandIds.has(m.watch_id)) continue;
    const t = at(m), i = Math.floor((t - (now - 56 * DAY)) / (7 * DAY));
    if (i >= 0 && i < 8) weeks[i][m.sentiment || 'unscored']++;
  }

  const alerts = [];
  for (const r of rows) {
    if (r.kind === 'alert' && r.last7) alerts.push({ level: 'warn', type: 'keyword', name: r.name, count: r.last7 });
    if (r.kind === 'brand' && r.last7 >= 5) {
      const now7 = r.neg7 / r.last7, before = r.prev7 ? r.negPrev7 / r.prev7 : 0;
      if (now7 - before >= 0.15) alerts.push({ level: 'critical', type: 'negative', name: r.name, now: now7, before });
    }
  }
  return { share, weeks, alerts, rows };
}

// قائمة الإشارات بعد الفلتر: الكل، أو جهة وحدة، أو السلبي بس
export function filterMentions(mentions, f) {
  return mentions.filter(m => (f.watch ? m.watch_id === f.watch : true) && (f.sentiment ? m.sentiment === f.sentiment : true) && (f.source ? m.source === f.source : true));
}
