// Design (التصميم): a creative brief built from what already works in our ads, headline variants
// (Workers AI when bound, fixed templates otherwise), each checked against the compliance rules.
// Text is never baked into the photo: the page draws it as a layer on top, per size.
import { check } from '../compliance/compliance';

export const SIZES: Record<string, { w: number; h: number; label: string }> = {
  square: { w: 1080, h: 1080, label: 'مربع 1080×1080 (بوست)' },
  story: { w: 1080, h: 1920, label: 'ستوري وريلز 1080×1920' },
  portrait: { w: 1080, h: 1350, label: 'طولي 1080×1350' },
  landscape: { w: 1200, h: 628, label: 'عرضي 1200×628 (رابط)' },
};
export const TYPES: Record<string, string> = { ad: 'إعلان', post: 'بوست عضوي', story: 'ستوري' };

export interface AdIn { ad_key: string; platform: string; name?: string | null; format?: string | null; goal?: string | null; text?: string | null }
export interface MetIn { ad_key: string; spend: number; leads: number; clicks?: number; impressions?: number }
export interface Variant { headline: string; sub: string; cta: string; flags: { level: string; title: string; match: string }[] }

// Winners: lead ads with at least 3 leads, ranked by cost per lead; their copy and format are the reference
export function winners(ads: AdIn[], metrics: MetIn[], n = 5) {
  const by = new Map<string, { spend: number; leads: number; clicks: number; impr: number }>();
  for (const m of metrics) { const o = by.get(m.ad_key) || { spend: 0, leads: 0, clicks: 0, impr: 0 }; o.spend += +m.spend || 0; o.leads += +m.leads || 0; o.clicks += +(m.clicks || 0); o.impr += +(m.impressions || 0); by.set(m.ad_key, o); }
  const list = ads.map(a => ({ ...a, ...(by.get(a.ad_key) || { spend: 0, leads: 0, clicks: 0, impr: 0 }) }))
    .filter(a => a.goal === 'lead' && a.leads >= 3 && a.spend > 0).map(a => ({ ...a, cpl: a.spend / a.leads, ctr: a.impr ? (100 * a.clicks) / a.impr : null }))
    .sort((x, y) => x.cpl - y.cpl);
  const top = list.slice(0, n);
  const formats: Record<string, number> = {};
  for (const a of top) formats[a.format || '—'] = (formats[a.format || '—'] || 0) + 1;
  const lens = top.map(a => (a.text || '').split(/\s+/).filter(Boolean).length).filter(Boolean).sort((x, y) => x - y);
  // Openings to learn from, minus any that break the compliance rules (we do not want to repeat them)
  const hooks = top.map(a => (a.text || '').split(/[\n.!؟?]/)[0]?.trim()).filter((h): h is string => !!h && h.length > 3 && !check(h).some(x => x.level === 'critical')).slice(0, 5);
  return { top: top.map(({ ad_key, platform, name, format, cpl, ctr, leads, text }) => ({ ad_key, platform, name, format, cpl: Math.round(cpl * 100) / 100, ctr, leads, text: (text || '').slice(0, 200) })),
    formats, medianWords: lens.length ? lens[lens.length >> 1] : null, hooks };
}

const flagsOf = (v: { headline: string; sub: string; cta: string }) => check(`${v.headline}\n${v.sub}\n${v.cta}`).map(h => ({ level: h.level, title: h.title, match: h.match }));

// No AI: three honest variants from the offer and the audience
export function templates(offer: string, audience: string): Variant[] {
  const o = offer.trim() || 'خدمتنا الطبية في البيت', a = audience.trim();
  const base = [
    { headline: o, sub: a ? `مصممة ${a.startsWith('لل') ? a : 'لـ' + a}، وفريقنا الطبي المرخّص يجيك البيت` : 'فريقنا الطبي المرخّص يجيك البيت', cta: 'احجز موعدك' },
    { headline: `${o} بدون ما تطلع من البيت`, sub: 'تقييم طبي أول، وبعدها الجلسة في الوقت اللي يناسبك', cta: 'تواصل معنا' },
    { headline: 'صحتك تستاهل وقتك', sub: `${o}، بخطوات بسيطة ومتابعة من فريق مختص`, cta: 'اعرف أكثر' },
  ];
  return base.map(v => ({ ...v, flags: flagsOf(v) }));
}

// The model answers with JSON lines; anything unparsable falls back to the templates
export function parseVariants(raw: string, offer: string, audience: string): Variant[] {
  const out: Variant[] = [];
  const m = raw.match(/\[[\s\S]*\]/);
  if (m) {
    try {
      for (const x of JSON.parse(m[0]) as Record<string, unknown>[]) {
        const v = { headline: String(x.headline || '').slice(0, 60).trim(), sub: String(x.sub || '').slice(0, 110).trim(), cta: String(x.cta || '').slice(0, 24).trim() };
        if (v.headline) out.push({ ...v, flags: flagsOf(v) });
      }
    } catch { /* fall through */ }
  }
  return out.length ? out.slice(0, 4) : templates(offer, audience);
}

export function prompt(input: { type: string; offer: string; audience: string; dept: string }, hooks: string[]): string {
  return `أنت كاتب إعلانات لشركة رعاية صحية منزلية في السعودية اسمها Well.
اكتب 4 خيارات لنص تصميم ${TYPES[input.type] || 'إعلان'} عن: ${input.offer || 'خدماتنا'}${input.dept ? ` (قسم: ${input.dept})` : ''}.
الفئة: ${input.audience || 'عامة'}.
عبارات افتتاحية نجحت قبل: ${hooks.join(' | ') || 'ما فيه'}.
القواعد: لهجة سعودية واضحة وودودة، مخاطبة المذكر، بدون ضمان نتائج، بدون "علاج نهائي"، بدون "الأفضل"، بدون أرقام وعود.
headline أقل من 6 كلمات، sub جملة وحدة، cta كلمتين.
رد JSON فقط: [{"headline":"","sub":"","cta":""}]`;
}
