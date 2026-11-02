// Tracking health (التتبع): reads what Well already stores (ads, daily metrics, CRM leads, connections)
// and lists tracking problems with the fix for each. Read-only: nothing is sent to an ad platform.

export type Level = 'critical' | 'warn' | 'info' | 'ok';
export interface Finding { id: string; level: Level; title: string; detail: string; fix: string; platform?: string; count?: number }
export interface AdRow { ad_key: string; platform: string; name?: string; goal?: string; live?: boolean; link?: string | null }
export interface MetricRow { ad_key: string; day: string; spend: number; leads: number }
export interface LeadRow { source_platform?: string | null; ad_id?: string | null; ad_id_quality?: string | null; created_at?: string | null }
export interface ConnRow { platform: string; expires_at?: string | null }
export interface Input { today: string; ads: AdRow[]; metrics: MetricRow[]; leads: LeadRow[]; connections: ConnRow[]; tables: { ads: boolean; metrics: boolean; leads: boolean; connections: boolean } }

export const PLATFORM_AR: Record<string, string> = { meta: 'ميتا', snapchat: 'سناب شات', tiktok: 'تيك توك', google: 'جوجل' };
// CRM sources that come from an ad, and the platform each belongs to
export const AD_SOURCES: Record<string, string> = { meta_form: 'meta', meta_ctwa: 'meta', whatsapp_ad_prefill: 'meta', snapchat_form: 'snapchat', tiktok_form: 'tiktok' };
// Server-side conversion connectors per platform (Connectors page keys)
export const CAPI: Record<string, string> = { meta: 'meta_capi', snapchat: 'snap_capi', tiktok: 'tiktok_events' };

const DAY = 864e5;
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

export function hasUtm(url: string | null | undefined): boolean {
  if (!url) return true;
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol) || /facebook\.com|tiktok\.com|snapchat\.com|google\.com$/.test(u.hostname)) return true;
    return u.searchParams.has('utm_source') && u.searchParams.has('utm_campaign');
  } catch { return true; }
}

export function diagnose(x: Input): { findings: Finding[]; summary: Record<string, number>; platforms: Record<string, { spend7: number; leads7: number; lastDay: string | null; crm7: number }> } {
  const out: Finding[] = [];
  const byKey = new Map(x.ads.map(a => [a.ad_key, a]));
  const since7 = addDays(x.today, -7);
  const plat: Record<string, { spend7: number; leads7: number; lastDay: string | null; crm7: number; leadSpend7: number }> = {};
  const P = (p: string) => (plat[p] ||= { spend7: 0, leads7: 0, lastDay: null, crm7: 0, leadSpend7: 0 });
  const perAd = new Map<string, { spend: number; leads: number }>();

  for (const m of x.metrics) {
    const a = byKey.get(m.ad_key); if (!a) continue;
    const p = P(a.platform || '?');
    if (!p.lastDay || m.day > p.lastDay) p.lastDay = m.day;
    if (m.day >= since7) {
      p.spend7 += Number(m.spend) || 0; p.leads7 += Number(m.leads) || 0;
      if (a.goal === 'lead') p.leadSpend7 += Number(m.spend) || 0;
      const o = perAd.get(m.ad_key) || { spend: 0, leads: 0 }; o.spend += Number(m.spend) || 0; o.leads += Number(m.leads) || 0; perAd.set(m.ad_key, o);
    }
  }

  // 1) Data stopped arriving from a platform
  for (const [p, v] of Object.entries(plat)) {
    if (!v.lastDay) continue;
    const late = Math.round((Date.parse(x.today) - Date.parse(v.lastDay)) / DAY);
    // Yesterday's numbers often land during the day, so two days late is normal; three is not
    if (late >= 3) out.push({ id: `stale:${p}`, level: late >= 5 ? 'critical' : 'warn', platform: p,
      title: `بيانات ${PLATFORM_AR[p] || p} واقفة من ${late} أيام`, detail: `آخر يوم فيه أرقام: ${v.lastDay}.`,
      fix: 'افتح صفحة الربط وتأكد إن الربط شغال، أو أعد الربط. بعدها التحديث القادم يسحب الأيام الناقصة.' });
  }

  // 2) Lead campaigns spending with no leads: the conversion event is likely not firing
  const silent = [...perAd.entries()].filter(([k, v]) => byKey.get(k)?.goal === 'lead' && v.spend >= 100 && v.leads === 0);
  const silentBy: Record<string, { n: number; spend: number; names: string[] }> = {};
  for (const [k, v] of silent) { const a = byKey.get(k)!; const s = (silentBy[a.platform] ||= { n: 0, spend: 0, names: [] }); s.n++; s.spend += v.spend; if (s.names.length < 3) s.names.push(a.name || k); }
  for (const [p, s] of Object.entries(silentBy)) {
    const all = plat[p];
    const whole = all && all.leadSpend7 > 0 && all.leads7 === 0;
    out.push({ id: `noleads:${p}`, level: whole ? 'critical' : 'warn', platform: p, count: s.n,
      title: whole ? `${PLATFORM_AR[p] || p}: صرف على الليدز وصفر ليدز من المنصة كلها` : `${s.n} إعلان ليدز في ${PLATFORM_AR[p] || p} صرف بدون ولا ليد`,
      detail: `آخر 7 أيام: ${fmt(s.spend)} ر.س. أمثلة: ${s.names.join('، ')}.`,
      fix: whole ? 'غالباً حدث التحويل ما يوصل: افحص البكسل أو النموذج في مدير الإعلانات، وتأكد إن الحدث المختار في الحملة هو نفسه اللي يطلع من الموقع.'
        : 'راجع هالإعلانات: لو الفورم أو الرابط شغال والمشكلة بالأداء، وقفها من لوحة القرارات. لو الليدز توصل للـ CRM بس ما تنحسب، المشكلة بالتتبع.' });
  }

  // 3) Platform leads vs CRM leads (last 7 days): a big gap means one side is not counting
  const crmBy: Record<string, number> = {};
  const unattributed: Record<string, { all: number; none: number }> = {};
  for (const l of x.leads) {
    const p = AD_SOURCES[l.source_platform || '']; if (!p) continue;
    const u = (unattributed[l.source_platform || ''] ||= { all: 0, none: 0 }); u.all++;
    if (!l.ad_id || l.ad_id_quality === 'broken_by_import') u.none++;
    if ((l.created_at || '').slice(0, 10) >= since7) crmBy[p] = (crmBy[p] || 0) + 1;
  }
  for (const [p, n] of Object.entries(crmBy)) P(p).crm7 = n;
  for (const [p, v] of Object.entries(plat)) {
    if (!x.tables.leads || v.leads7 < 10) continue;
    const gap = Math.abs(v.leads7 - v.crm7) / Math.max(v.leads7, 1);
    if (gap >= 0.3) out.push({ id: `gap:${p}`, level: 'warn', platform: p,
      title: `${PLATFORM_AR[p] || p}: الليدز في المنصة ${fmt(v.leads7)} وفي الـ CRM ${fmt(v.crm7)}`, detail: `فرق ${pct(Math.abs(v.leads7 - v.crm7), v.leads7)}% آخر 7 أيام.`,
      fix: v.crm7 < v.leads7 ? 'ليدز تضيع بين المنصة والـ CRM: تأكد إن ربط النماذج (Lead forms) بالـ CRM شغال لكل حملة.' : 'الـ CRM يستقبل أكثر من المنصة: غالباً ليدز داخلة بمصدر إعلان وهي من مصدر ثاني، أو المنصة ما تحسب كل التحويلات.' });
  }

  // 4) CRM leads from ads without an ad id: the dashboard cannot credit them to an ad
  for (const [src, u] of Object.entries(unattributed)) {
    if (u.all < 20 || pct(u.none, u.all) < 20) continue;
    out.push({ id: `attr:${src}`, level: pct(u.none, u.all) >= 60 ? 'critical' : 'warn', platform: AD_SOURCES[src] || src, count: u.none,
      title: `${pct(u.none, u.all)}% من ليدز ${src} بدون رقم إعلان`, detail: `${fmt(u.none)} من ${fmt(u.all)} ليد آخر 30 يوم ما نقدر نربطها بإعلانها.`,
      fix: 'خل نموذج الليد أو رابط الواتساب يمرر رقم الإعلان (ad_id) للـ CRM، مثل {{ad.id}} في ميتا و __CID__ في سناب.' });
  }

  // 5) Server-side conversions (CAPI) missing for platforms that spend
  const conns = new Set(x.connections.map(c => c.platform));
  if (x.tables.connections) for (const [p, v] of Object.entries(plat)) {
    const key = CAPI[p]; if (!key || v.spend7 < 1 || conns.has(key)) continue;
    out.push({ id: `capi:${p}`, level: 'info', platform: p, title: `${PLATFORM_AR[p] || p}: ما فيه تحويلات من السيرفر (CAPI)`,
      detail: 'المنصة تعتمد على البكسل بالمتصفح بس، واللي يحجب الكوكيز ما ينحسب.', fix: 'اربط Conversions API من صفحة الربط عشان المنصة تتعلم من الليدز الحقيقية.' });
  }
  for (const c of x.connections) {
    if (!c.expires_at) continue;
    const left = Math.round((Date.parse(c.expires_at) - Date.parse(x.today)) / DAY);
    if (left <= 7) out.push({ id: `exp:${c.platform}`, level: left < 0 ? 'critical' : 'warn', title: left < 0 ? `ربط ${c.platform} منتهي` : `ربط ${c.platform} ينتهي بعد ${left} أيام`,
      detail: `تاريخ الانتهاء: ${c.expires_at.slice(0, 10)}.`, fix: 'افتح صفحة الربط واضغط "أعد الربط".' });
  }

  // 6) Website links without UTM: GA4 cannot tell which ad brought the visit
  const noUtm = x.ads.filter(a => a.live && a.link && !hasUtm(a.link));
  if (noUtm.length) out.push({ id: 'utm', level: 'warn', count: noUtm.length, title: `${noUtm.length} إعلان نشط رابطه بدون UTM`,
    detail: `أمثلة: ${noUtm.slice(0, 3).map(a => a.name || a.ad_key).join('، ')}.`, fix: 'أضف utm_source و utm_medium و utm_campaign لرابط الإعلان (أو Tracking template في جوجل).' });

  if (!x.tables.metrics) out.push({ id: 'nodata', level: 'critical', title: 'ما قدرت أقرأ أرقام الإعلانات', detail: 'جدول ad_metrics ما رد.', fix: 'تأكد إن التحديث كل ساعة شغال (Actions → refresh).' });

  const rank: Record<Level, number> = { critical: 0, warn: 1, info: 2, ok: 3 };
  out.sort((a, b) => rank[a.level] - rank[b.level]);
  const summary = { critical: 0, warn: 0, info: 0 } as Record<string, number>;
  for (const f of out) summary[f.level] = (summary[f.level] || 0) + 1;
  const platforms = Object.fromEntries(Object.entries(plat).map(([k, v]) => [k, { spend7: Math.round(v.spend7), leads7: Math.round(v.leads7), lastDay: v.lastDay, crm7: v.crm7 }]));
  return { findings: out, summary, platforms };
}
