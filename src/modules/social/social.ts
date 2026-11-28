// السوشال: التحقق من المنشور، وحدود كل منصة، والنشر. فيسبوك وانستقرام ينشرهم كودنا مباشرة (Graph API)،
// وتيك توك وX ولينكدإن عبر Postiz كمحرك نشر إضافي (src/mcp/adapters/postiz.ts)؛ كلهم بعد اعتماد المعتمد بس. الباقي يتحفظ كتذكير (ADR-0006).
// التوكنات من الخزنة (صفحة الربط) بأسماء المتغيرات، وما ترجع للمتصفح أبداً.
import { check, notice, type Rule } from '../compliance/compliance';
import { SOCIAL, Fail, capCheck, engineOf, textLength, type Code, type Ctx, type Draft, type Media, type Overrides, type Result, type Results, type SocialPlatform, type Tokens } from './engine';
import { postizPublish, platformLive, type EngineStatus } from '../../mcp/adapters/postiz';
import { facebook, instagram, checkConnection, VIDEO_WAIT_MS, type Level, type Check, type Connection } from '../../mcp/adapters/meta-graph';
export { checkConnection };
export type { Level, Check, Connection };
export { SOCIAL, capCheck, engineOf };
export type { Code, Ctx, Draft, Media, Overrides, Result, Results, SocialPlatform };

/** The text a platform publishes: its own override when there is one, else the shared text. */
export const bodyFor = (post: Pick<Draft, 'body' | 'overrides'>, p: SocialPlatform): string => {
  const o = post.overrides?.[p]?.body;
  return typeof o === 'string' && o.trim() ? o : post.body;
};
// Keeps only the chosen platforms' texts that really differ from the shared one (trimmed, at most 5000 characters each)
export function cleanOverrides(v: unknown, platforms: SocialPlatform[], body: string): Overrides {
  const out: Overrides = {};
  if (!v || typeof v !== 'object') return out;
  for (const p of platforms) {
    const raw = (v as Record<string, unknown>)[p];
    const t = String((raw && typeof raw === 'object' ? (raw as { body?: unknown }).body : '') ?? '').trim().slice(0, 5000);
    if (t && t !== body) out[p] = { body: t };
  }
  return out;
}

// Compliance (one list, src/modules/compliance) plus the company's forbidden words: a precise notice, never a block (Leen's rule).
// The notice shows when a post is scheduled and on the post itself, so its approver sees it too.
// isLive = can this platform go out by itself right now (engine set up and account connected); default: it has an engine
export function validate(input: Record<string, unknown>, now = Date.now(), extra: Rule[] = [], isLive: (p: SocialPlatform) => boolean = p => SOCIAL[p].live): { draft?: Draft; error?: string; notices: string[] } {
  const platforms = [...new Set(Array.isArray(input.platforms) ? input.platforms : [])].filter((p): p is SocialPlatform => typeof p === 'string' && p in SOCIAL);
  const body = String(input.body || '').trim();
  const media = (Array.isArray(input.media) ? input.media : []).flatMap(m => {
    const url = String((m as Media)?.url || '');
    return /^https:\/\/\S+$/.test(url) ? [{ url, type: (m as Media).type === 'video' ? 'video' : 'image' } as Media] : [];
  }).slice(0, 10);
  const at = Date.parse(String(input.publish_at || ''));
  // Leen: nothing goes out without the named approver, so every post waits for approval (no auto mode)
  const mode = 'manual' as const;
  const notices = check(body, extra).map(notice);
  if (!platforms.length) return { error: 'اختر منصة وحدة على الأقل', notices };
  const overrides = cleanOverrides(input.overrides, platforms, body);
  // Each platform's own text is checked too, said with the platform's name
  for (const [p, o] of Object.entries(overrides) as [SocialPlatform, { body: string }][]) for (const n of check(o.body, extra).map(notice)) notices.push(`${SOCIAL[p].name}: ${n}`);
  const draftOf = { body, overrides };
  const videos = media.filter(m => m.type === 'video').length;
  if (videos > 1) return { error: 'فيديو واحد بس لكل منشور', notices };
  if (videos && media.length > 1) return { error: 'فيديو واحد أو صور، مو الاثنين مع بعض', notices };
  if (!media.length && platforms.some(p => !bodyFor(draftOf, p))) return { error: 'اكتب نص أو أضف صورة/فيديو', notices };
  if (!Number.isFinite(at)) return { error: 'حدد وقت النشر', notices };
  if (at < now - 60_000) return { error: 'وقت النشر راح', notices };
  for (const p of platforms) {
    const s = SOCIAL[p];
    const own = bodyFor(draftOf, p);
    if (textLength(p, own) > s.max) return { error: `النص أطول من حد ${s.name} (${s.max} حرف)`, notices };
    if ('needsMedia' in s && s.needsMedia && !media.length) return { error: `${s.name} يحتاج صورة أو فيديو`, notices };
    // What the platform accepts of the media (count, video format), said now and not at the post's time
    const fit = capCheck(p, { body: own, media });
    if (fit) return { error: fit, notices };
  }
  if (platforms.some(p => !isLive(p))) notices.push('بعض المنصات المختارة ما ينشر لها تلقائي للحين، وبتنحفظ كتذكير.');
  return { draft: { platforms, body, media, publish_at: new Date(at).toISOString(), mode, ...(Object.keys(overrides).length ? { overrides } : {}) }, notices };
}

// Who may approve: the company's named approvers; none named = the owner only (checked when approving).
export const canApprove = (email: string, approvers: string[], owner: boolean): boolean =>
  approvers.length ? approvers.includes(email.toLowerCase()) : owner;

// A post goes out at its time only once approved. With named approvers, the approval must still be one of
// theirs when it is due (an approver removed meanwhile does not publish).
export const due = (p: { status: string; approved_at?: string | null; approved_by?: string | null; publish_at: string }, approvers: string[] = [], now = Date.now()) =>
  p.status === 'scheduled' && Date.parse(p.publish_at) <= now && !!p.approved_at
  && (!approvers.length || approvers.includes(String(p.approved_by || '').toLowerCase()));

export const cleanApprovers = (v: unknown): string[] =>
  [...new Set((Array.isArray(v) ? v : []).map(x => String(x || '').trim().toLowerCase()).filter(x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)))].slice(0, 10);


export const STALE_MS = 15 * 60_000;          // a post 'publishing' longer than this lost its Worker
export { VIDEO_WAIT_MS };

// Before scheduling: can this platform go out on its own with the accounts connected? '' = yes, else why not.
// `engine` = what the Postiz engine reported (routes.ts); without it a Postiz platform counts as not available.
export function readiness(platform: SocialPlatform, t: Tokens, engine: EngineStatus | null = null): string {
  const e = engineOf(platform);
  if (!e) return 'النشر التلقائي لهالمنصة قريباً: بينحفظ كتذكير';
  if (e === 'postiz') return platformLive(engine, platform) ? '' : 'غير متاح الحين: بينحفظ كتذكير';
  if (platform === 'facebook' && (!t.META_PAGE_ACCESS_TOKEN || !t.META_PAGE_ID)) return 'صفحة فيسبوك مو مربوطة: اربطها من صفحة الربط قبل الموعد';
  if (platform === 'instagram' && (!t.META_PAGE_ACCESS_TOKEN || !t.IG_USER_ID)) return 'حساب انستقرام مو مربوط: اربطه من صفحة الربط قبل الموعد';
  return '';
}

export async function publishOne(platform: SocialPlatform, post: Draft, t: Tokens, f: typeof fetch = fetch, prev?: Result, ctx: Ctx = {}): Promise<Result> {
  if (prev?.ok) return prev;
  const eng = engineOf(platform);
  if (!eng) return { ok: false, code: 'unsupported' };
  if (eng === 'postiz') {
    // Params are checked inside before any call; a Postiz platform is only reached with an approved post (cron.ts)
    try { return await postizPublish(platform, post, t, f, prev, ctx); } catch { return { ok: false, code: 'network' }; }
  }
  const token = t.META_PAGE_ACCESS_TOKEN;
  try {
    if (platform === 'facebook') {
      if (!token || !t.META_PAGE_ID) return { ok: false, code: 'not_connected' };
      return await facebook(post, t, f, prev, ctx);
    }
    if (platform === 'instagram') {
      if (!token || !t.IG_USER_ID) return { ok: false, code: 'not_connected' };
      if (!post.media.length) return { ok: false, code: 'no_media' };
      return await instagram(post, t, f, prev, ctx);
    }
  } catch (e) {
    if (e instanceof Fail) return { ok: false, code: e.code, ...(e.detail ? { detail: e.detail } : {}) };
    return { ok: false, code: 'network' };
  }
  return { ok: false, code: 'unsupported' };
}

export type Outcome = 'published' | 'partial' | 'failed' | 'pending';
export const pending = (r: Result | undefined) => !!r && !r.ok && r.state === 'processing' && !r.code;
export function outcomeOf(platforms: string[], results: Results): Outcome {
  if (platforms.some(p => pending(results[p]))) return 'pending';
  const ok = platforms.filter(p => results[p]?.ok).length;
  return ok === platforms.length ? 'published' : ok ? 'partial' : 'failed';
}

// Runs the platforms one after the other. `prev` (the stored results) makes a second run harmless: what is ok is skipped,
// what was unfinished continues, what never started starts. `save` gets the results after every step.
export async function publishPost(post: Draft, t: Tokens, f: typeof fetch = fetch, prev: Results = {}, o: Omit<Ctx, 'save'> & { save?: (r: Results) => Promise<void> } = {}): Promise<{ status: Outcome; results: Results }> {
  const results: Results = { ...prev };
  for (const p of post.platforms) {
    // 'unsaved' = it went out but the result could not be saved: it is never sent again, a person checks it
    if (results[p]?.ok || results[p]?.code === 'unsaved') continue;
    const save = async (r: Result) => { results[p] = r; await o.save?.(results); };
    // each platform gets its own text (overrides); everything else about the post is shared
    try { results[p] = await publishOne(p, { ...post, body: bodyFor(post, p) }, t, f, results[p], { ...o, save }); } catch { results[p] = { ok: false, code: 'network' }; }
    try { await o.save?.(results); }
    catch {
      // The platform answered but the database did not take the result. Mark it so a recovery run never publishes it again;
      // try to store that mark too (the next save of this run usually works), and carry on with the other platforms.
      if (results[p]?.ok) {
        results[p] = { ...results[p], ok: false, code: 'unsaved' };
        try { await o.save?.(results); } catch { /* the in-memory mark still reaches the final patch of cron.ts */ }
      }
    }
  }
  return { status: outcomeOf(post.platforms, results), results };
}

// A post that stayed 'publishing' past STALE_MS lost its Worker. It is picked up again from its stored results.
export const stale = (p: { status: string; claimed_at?: string | null; publish_at: string }, now = Date.now()) =>
  p.status === 'publishing' && now - Date.parse(p.claimed_at || p.publish_at) > STALE_MS;

// One retry, only of the platforms that failed (never those that went out), only once per post.
// A platform whose answer was lost ('unconfirmed') may be live already: it is retried only because the approver says so.
export function retryPlan(p: { status: string; platforms: string[]; results?: Results | null; retried_at?: string | null }): { results: Results } | { error: 'not_failed' | 'retried' | 'nothing' } {
  if (!['failed', 'partial'].includes(p.status)) return { error: 'not_failed' };
  if (p.retried_at) return { error: 'retried' };
  const results: Results = { ...(p.results || {}) };
  let any = false;
  for (const k of p.platforms) {
    const r = results[k];
    if (!r || r.ok || r.code === 'unsupported' || r.code === 'unsaved' || !SOCIAL[k as SocialPlatform]?.live) continue;
    delete results[k]; any = true;
  }
  return any ? { results } : { error: 'nothing' };
}

// ---- Dry run: is the connection able to post? Reads only (page fields, the Instagram link, the token's permissions);
// nothing is posted. Codes only; the Social tab words them.

// "اكتب لي نص": the post written by the social model (Grok when keyed) from what the user typed, within the
// shortest limit of the chosen platforms. Checked like any post; the user edits it before scheduling.
export function suggestPrompt(brief: string, platforms: SocialPlatform[]): string {
  const max = Math.min(...platforms.map(p => SOCIAL[p].max), 600);
  return `اكتب منشور سوشال بالسعودي لشركة رعاية صحية منزلية في الرياض، مخاطبة المذكر، للمنصات: ${platforms.map(p => SOCIAL[p].name).join('، ')}.
الفكرة: ${brief}
القواعد: جمل قصيرة، الفائدة قبل الميزة، دعوة واضحة للحجز، بدون وعد بشفاء أو نتيجة، بدون "الأفضل" أو "الوحيد"، بدون تجارب مرضى، بدون سعر إلا لو موجود في المعرفة ومعه الإجمالي.
الحد ${max} حرف. رد بنص المنشور بس، بدون شرح وبدون علامات تنصيص.`;
}
// A suggestion is cut to what every chosen platform accepts, measured the way that platform measures (engine.ts textLength), so
// what the page shows is never refused a moment later by validate(). On X an ellipsis, a rial sign or an emoji weighs 2 and a
// link weighs 23 whatever its length (https://docs.x.com/fundamentals/counting-characters, read 2026-11-24), so a plain
// .length cut kept texts X refuses and shortened texts X accepts. Whole words go first; a text with no space left to cut at
// loses whole characters (never half an emoji).
const SUGGEST_MAX = 600;
const LAST = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export function cleanSuggestion(raw: string, platforms: SocialPlatform[]): string {
  const fits = (s: string) => s.length <= SUGGEST_MAX && platforms.every(p => textLength(p, s) <= SOCIAL[p].max);
  const t = String(raw || '').trim().replace(/^["«“]+|["»”]+$/g, '').replace(/^(المنشور|النص)\s*:\s*/, '').trim();
  if (fits(t)) return t;
  let cut = t.slice(0, SUGGEST_MAX + 1);
  while (cut && !fits(cut)) {
    const words = cut.replace(/\s+\S*$/, '');
    cut = words.length < cut.length ? words : [...LAST.segment(cut)].slice(0, -1).map(g => g.segment).join('').trimEnd();
  }
  return cut;
}
