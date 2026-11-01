// السوشال: التحقق من المنشور، وحدود كل منصة، والنشر. النشر الفعلي الحين لفيسبوك وانستقرام (Graph API)،
// والباقي يطلع "قريباً" لين يكون عندنا تطبيق معتمد لكل منصة (ADR-0006).
// التوكنات من الخزنة (صفحة الربط) بأسماء المتغيرات، وما ترجع للمتصفح أبداً.

export const SOCIAL = {
  facebook: { name: 'فيسبوك', max: 63206, live: true },
  instagram: { name: 'انستقرام', max: 2200, live: true, needsMedia: true },
  tiktok: { name: 'تيك توك', max: 2200, live: false, needsMedia: true },
  x: { name: 'X', max: 280, live: false },
  linkedin: { name: 'لينكدإن', max: 3000, live: false },
  snapchat: { name: 'سناب شات', max: 250, live: false, needsMedia: true },
} as const;
export type SocialPlatform = keyof typeof SOCIAL;
export interface Media { url: string; type: 'image' | 'video' }
export interface Draft { platforms: SocialPlatform[]; body: string; media: Media[]; publish_at: string; mode: 'auto' | 'manual' }

const GRAPH = 'https://graph.facebook.com/v23.0';
// Saudi MOH advertising: a reminder, never a block (Leen's rule: compliance is a notice)
const MOH_WORDS = ['علاج نهائي', 'مضمون', 'شفاء تام', '100%', 'بدون أضرار', 'أفضل طبيب', 'الأرخص'];

export function validate(input: Record<string, unknown>, now = Date.now()): { draft?: Draft; error?: string; notices: string[] } {
  const platforms = [...new Set(Array.isArray(input.platforms) ? input.platforms : [])].filter((p): p is SocialPlatform => typeof p === 'string' && p in SOCIAL);
  const body = String(input.body || '').trim();
  const media = (Array.isArray(input.media) ? input.media : []).flatMap(m => {
    const url = String((m as Media)?.url || '');
    return /^https:\/\/\S+$/.test(url) ? [{ url, type: (m as Media).type === 'video' ? 'video' : 'image' } as Media] : [];
  }).slice(0, 10);
  const at = Date.parse(String(input.publish_at || ''));
  const mode = input.mode === 'auto' ? 'auto' : 'manual';
  const notices = MOH_WORDS.filter(w => body.includes(w)).map(w => `تنبيه امتثال (وزارة الصحة): "${w}" ممكن تعتبر ادعاء. راجعها قبل النشر.`);
  if (!platforms.length) return { error: 'اختر منصة وحدة على الأقل', notices };
  if (!body && !media.length) return { error: 'اكتب نص أو أضف صورة/فيديو', notices };
  if (!Number.isFinite(at)) return { error: 'حدد وقت النشر', notices };
  if (at < now - 60_000) return { error: 'وقت النشر راح', notices };
  for (const p of platforms) {
    const s = SOCIAL[p];
    if (body.length > s.max) return { error: `النص أطول من حد ${s.name} (${s.max} حرف)`, notices };
    if ('needsMedia' in s && s.needsMedia && !media.length) return { error: `${s.name} يحتاج صورة أو فيديو`, notices };
  }
  if (platforms.some(p => !SOCIAL[p].live)) notices.push('بعض المنصات المختارة ما ينشر لها تلقائي للحين، وبتنحفظ كتذكير.');
  return { draft: { platforms, body, media, publish_at: new Date(at).toISOString(), mode }, notices };
}

// manual posts wait for approval; auto posts go at their time
export const due = (p: { status: string; mode: string; approved_at?: string | null; publish_at: string }, now = Date.now()) =>
  p.status === 'scheduled' && Date.parse(p.publish_at) <= now && (p.mode === 'auto' || !!p.approved_at);

type Tokens = Record<string, string | undefined>;
type Result = { ok: boolean; id?: string; error?: string };
async function graph(f: typeof fetch, path: string, params: Record<string, string>): Promise<{ id?: string; error?: { message?: string } }> {
  const res = await f(`${GRAPH}/${path}`, { method: 'POST', body: new URLSearchParams(params) });
  return res.json();
}

export async function publishOne(platform: SocialPlatform, post: Draft, t: Tokens, f: typeof fetch = fetch): Promise<Result> {
  if (!SOCIAL[platform].live) return { ok: false, error: 'النشر التلقائي لهالمنصة قريباً' };
  const token = t.META_PAGE_ACCESS_TOKEN;
  if (platform === 'facebook') {
    if (!token || !t.META_PAGE_ID) return { ok: false, error: 'اربط صفحة فيسبوك من صفحة الربط' };
    const img = post.media.find(m => m.type === 'image');
    const r = img ? await graph(f, `${t.META_PAGE_ID}/photos`, { url: img.url, caption: post.body, access_token: token })
      : await graph(f, `${t.META_PAGE_ID}/feed`, { message: post.body, access_token: token });
    return r.id ? { ok: true, id: r.id } : { ok: false, error: r.error?.message || 'فشل النشر' };
  }
  if (platform === 'instagram') {
    if (!token || !t.IG_USER_ID) return { ok: false, error: 'اربط حساب انستقرام من صفحة الربط' };
    const m = post.media[0];
    if (!m) return { ok: false, error: 'انستقرام يحتاج صورة أو فيديو' };
    const c = await graph(f, `${t.IG_USER_ID}/media`, { caption: post.body, access_token: token,
      ...(m.type === 'video' ? { media_type: 'REELS', video_url: m.url } : { image_url: m.url }) });
    if (!c.id) return { ok: false, error: c.error?.message || 'ما انرفعت الصورة' };
    const r = await graph(f, `${t.IG_USER_ID}/media_publish`, { creation_id: c.id, access_token: token });
    return r.id ? { ok: true, id: r.id } : { ok: false, error: r.error?.message || 'فشل النشر' };
  }
  return { ok: false, error: 'منصة غير معروفة' };
}

export async function publishPost(post: Draft, t: Tokens, f: typeof fetch = fetch): Promise<{ status: 'published' | 'partial' | 'failed'; results: Record<string, Result> }> {
  const results: Record<string, Result> = {};
  for (const p of post.platforms) {
    try { results[p] = await publishOne(p, post, t, f); } catch { results[p] = { ok: false, error: 'تعذر الاتصال بالمنصة' }; }
  }
  const ok = Object.values(results).filter(r => r.ok).length;
  return { status: ok === post.platforms.length ? 'published' : ok ? 'partial' : 'failed', results };
}
