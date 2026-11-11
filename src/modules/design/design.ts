// Design (التصميم): a creative brief built from what already works in our ads, headline variants
// (Workers AI when bound, fixed templates otherwise), each checked against the compliance rules.
// Text is never baked into the photo: the page draws it as a layer on top, per size.
import { check } from '../compliance/compliance';
import { notEnabled } from '../../lib/auth';
import type { ImageOut } from '../../lib/llm';

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

const flagsOf = (v: { headline: string; sub: string; cta: string }) => check(`${v.headline}\n${v.sub}\n${v.cta}`).map(h => ({ level: h.level, title: h.title, match: h.match, fix: h.fix, source: h.source }));

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

// The model answers with JSON lines: only well-formed, length-capped variants are kept ([] when none)
export function variantsFrom(raw: string): Variant[] {
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
  return out.slice(0, 4);
}
// Anything unparsable falls back to the templates
export function parseVariants(raw: string, offer: string, audience: string): Variant[] {
  const out = variantsFrom(raw);
  return out.length ? out : templates(offer, audience);
}

// Reference images (product photo and style references): Workers AI vision describes each one in a short line.
export const VISION_MODEL = '@cf/llava-hf/llava-1.5-7b-hf';
export const VISION_PROMPT = 'Describe this image for an ad designer in one short sentence: the product or subject, main colors, composition and mood.';
const DATA_URL = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/;
// At most 5 images (1 product + 4 references), each a small downscaled data URL; anything else is dropped
export function images(list: unknown, max = 5, maxB64 = 200_000): { kind: 'product' | 'ref'; bytes: number[] }[] {
  const out: { kind: 'product' | 'ref'; bytes: number[] }[] = [];
  for (const x of Array.isArray(list) ? list.slice(0, max) : []) {
    const o = (x || {}) as { kind?: string; data?: string };
    const m = String(o.data || '').match(DATA_URL);
    if (!m || (m[2] || '').length > maxB64) continue;
    const bin = atob(m[2] || '');
    const bytes = new Array<number>(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    out.push({ kind: o.kind === 'product' ? 'product' : 'ref', bytes });
  }
  return out;
}

export function prompt(input: { type: string; offer: string; audience: string; dept: string }, hooks: string[], looks: { product: string[]; refs: string[] } = { product: [], refs: [] }): string {
  return `أنت كاتب إعلانات لشركة رعاية صحية منزلية في السعودية اسمها Well.
اكتب 4 خيارات لنص تصميم ${TYPES[input.type] || 'إعلان'} عن: ${input.offer || 'خدماتنا'}${input.dept ? ` (قسم: ${input.dept})` : ''}.
الفئة: ${input.audience || 'عامة'}.
عبارات افتتاحية نجحت قبل: ${hooks.join(' | ') || 'ما فيه'}.${looks.product.length ? `\nصورة المنتج: ${looks.product.join(' ')}` : ''}${looks.refs.length ? `\nالمراجع اللي نبي نمشي على أسلوبها: ${looks.refs.join(' | ')}` : ''}
القواعد: لهجة سعودية واضحة وودودة، مخاطبة المذكر، بدون ضمان نتائج، بدون "علاج نهائي"، بدون "الأفضل"، بدون أرقام وعود.
headline أقل من 6 كلمات، sub جملة وحدة، cta كلمتين.
رد JSON فقط: [{"headline":"","sub":"","cta":""}]`;
}

export function stylePrompt(looks: { product: string[]; refs: string[] }): string {
  return `هذي أوصاف صور أرسلها مصمم (منتج ومراجع). لخّصها بالعربي في سطرين لمصمم إعلانات: وش المنتج، والألوان، وطريقة التكوين، والإحساس. بدون مقدمة.
المنتج: ${looks.product.join(' ') || 'ما فيه'}
المراجع: ${looks.refs.join(' | ') || 'ما فيه'}`;
}

// The background the image model draws. The page puts the text on top, so the image itself has none.
// Health-ad rules (MOH): no before/after, no bodies or faces showing a result, no medical claims in the picture.
export function backgroundPrompt(input: { type: string; offer: string; audience: string; dept: string }, colors: string[], style: string, product = false): string {
  return `${product ? `Keep the product in this photo exactly as it is: same shape, label, colours and printed text, nothing added on it. Replace everything around it with a new scene and lighting for the ad, the product clearly the hero.
` : ''}${product ? 'Ad photo' : 'Background photo'} for a ${input.type === 'story' ? 'vertical story' : 'social media'} ad of Well, a home healthcare company in Saudi Arabia.
Subject: ${input.offer || 'home healthcare visit'}${input.dept ? ` (${input.dept})` : ''}. Audience: ${input.audience || 'Saudi families'}.
Look: clean, calm, premium, warm natural light, Saudi home setting, colour palette ${(colors.length ? colors : WELL_PALETTE).join(' ')}.${style ? ` Style notes: ${style}` : ''}
Fill the whole frame edge to edge with the scene: no empty, flat or plain areas. Keep the subject in the centre: the picture is cropped to square, portrait, story and landscape.
Keep the lower 40% of the frame simple and fairly dark, text goes there.
No text, letters, numbers, logos or watermarks. No before/after, no bodies or faces showing a treatment result, no syringes in skin, no children as the subject, no patients as testimonials, modest dress.`;
}

// Well palette v2.1 (brand guide): ivory, white, Pulse Purple, Well Indigo, Purple Soft, Pulse Pink (one touch only), Purple Deep
export const WELL_PALETTE = ['#F6F0E3', '#FFFFFF', '#7E57FD', '#1D1069', '#ACA6E1', '#F86080', '#221196'];

// One picture for every chosen size, cropped to each in the browser: the shape that loses least.
// Only landscape → wide; only square → square; anything vertical (story, portrait) → tall.
export function imageSize(sizes: unknown): '1024x1536' | '1024x1024' | '1536x1024' {
  const s = (Array.isArray(sizes) ? sizes : []).map(String).filter(k => k in SIZES);
  if (s.length && s.every(k => k === 'landscape')) return '1536x1024';
  if (s.length && s.every(k => k === 'square')) return '1024x1024';
  return '1024x1536';
}

// The product photo for the image model: a JPEG or PNG data URL up to ~1.5 MB (the page sends it at 1024 px)
export function productPhoto(data: unknown): { bytes: Uint8Array<ArrayBuffer>; mime: string } | null {
  const m = String(data || '').match(/^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/);
  if (!m || m[2]!.length > 2_000_000) return null;
  const bin = atob(m[2]!), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, mime: m[1]! };
}

// Why there is no picture, in words the user can act on; retry only where trying again can help
export function imageMiss(out: ImageOut, user: { role: string } | null | undefined): { code: string; message: string; retry: boolean } | null {
  switch (out.miss) {
    case undefined: return null;
    case 'no_key': return { code: 'no_key', message: notEnabled(user, 'رسم الخلفيات بالذكاء الاصطناعي', 'OPENAI_API_KEY'), retry: false };
    case 'capped': return { code: 'capped', message: 'وصل الصرف الشهري لتاب التصميم، فما انرسمت خلفية. النصوص جاهزة، وبلّغ الإدارة إذا تبي ترفع السقف.', retry: false };
    case 'refused': return { code: 'refused', message: 'خدمة الصور رفضت الطلب لأنه يخالف سياسة المحتوى. غيّر وصف الإعلان أو الصورة وجرّب مرة ثانية.', retry: true };
    default: return { code: 'failed', message: `خدمة الصور ما ردّت هالمرة${out.status ? ` (رمز ${out.status})` : ''}. جرّب مرة ثانية.`, retry: true };
  }
}
