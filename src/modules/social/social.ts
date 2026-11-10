// السوشال: التحقق من المنشور، وحدود كل منصة، والنشر. فيسبوك وانستقرام ينشرهم كودنا مباشرة (Graph API)،
// وتيك توك وX ولينكدإن عبر Postiz كمحرك نشر إضافي (postiz.ts)؛ كلهم بعد اعتماد المعتمد بس. الباقي يتحفظ كتذكير (ADR-0006).
// التوكنات من الخزنة (صفحة الربط) بأسماء المتغيرات، وما ترجع للمتصفح أبداً.
import { check, notice, type Rule } from '../compliance/compliance';
import { SOCIAL, Fail, capCheck, engineOf, type Code, type Ctx, type Draft, type Media, type Result, type Results, type SocialPlatform, type Tokens } from './engine';
import { postizPublish, platformLive, type EngineStatus } from './postiz';
export { SOCIAL, capCheck, engineOf };
export type { Code, Ctx, Draft, Media, Result, Results, SocialPlatform };

const GRAPH = 'https://graph.facebook.com/v23.0';

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
  const videos = media.filter(m => m.type === 'video').length;
  if (videos > 1) return { error: 'فيديو واحد بس لكل منشور', notices };
  if (videos && media.length > 1) return { error: 'فيديو واحد أو صور، مو الاثنين مع بعض', notices };
  if (!body && !media.length) return { error: 'اكتب نص أو أضف صورة/فيديو', notices };
  if (!Number.isFinite(at)) return { error: 'حدد وقت النشر', notices };
  if (at < now - 60_000) return { error: 'وقت النشر راح', notices };
  for (const p of platforms) {
    const s = SOCIAL[p];
    if (body.length > s.max) return { error: `النص أطول من حد ${s.name} (${s.max} حرف)`, notices };
    if ('needsMedia' in s && s.needsMedia && !media.length) return { error: `${s.name} يحتاج صورة أو فيديو`, notices };
    // What the platform accepts of the media (count, video format), said now and not at the post's time
    const fit = capCheck(p, { body, media });
    if (fit) return { error: fit, notices };
  }
  if (platforms.some(p => !isLive(p))) notices.push('بعض المنصات المختارة ما ينشر لها تلقائي للحين، وبتنحفظ كتذكير.');
  return { draft: { platforms, body, media, publish_at: new Date(at).toISOString(), mode }, notices };
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
export const VIDEO_WAIT_MS = 20 * 60_000;     // Instagram gets this long to prepare a video before it counts as failed

type Reply = { ok: boolean; status: number; data: { id?: string; post_id?: string; status_code?: string; error?: { message?: string; code?: number; error_subcode?: number } } & Record<string, unknown> };

// Meta's error codes, in plain buckets: a bad or expired token, a missing permission, a rate limit, media Meta could not use
function classify(e: { message?: string; code?: number; error_subcode?: number } | undefined, status: number): Fail {
  const c = e?.code ?? 0, detail = `${e?.message || 'HTTP ' + status}${c ? ` (#${c}${e?.error_subcode ? '/' + e.error_subcode : ''})` : ''}`;
  if (c === 190 || c === 102 || status === 401) return new Fail('token', detail);
  if (c === 10 || (c >= 200 && c <= 299) || c === 3) return new Fail('permission', detail);
  if ([4, 17, 32, 341, 613].includes(c)) return new Fail('busy', detail);
  if (c === 9004 || c === 9007 || String(e?.error_subcode || '').startsWith('2207') || c === 352 || c === 1366046) return new Fail('media_rejected', detail);
  return new Fail('platform', detail);
}
// final = the call that makes the post appear: if it dies without an answer we cannot know whether it went out
async function call(f: typeof fetch, method: 'GET' | 'POST', path: string, params: Record<string, string>, final = false): Promise<Reply> {
  let res: Response;
  try {
    res = method === 'GET' ? await f(`${GRAPH}/${path}?${new URLSearchParams(params)}`) : await f(`${GRAPH}/${path}`, { method: 'POST', body: new URLSearchParams(params) });
  } catch { throw new Fail(final ? 'unconfirmed' : 'network'); }
  const data = (await res.json().catch(() => null)) as Reply['data'] | null;
  if (final && (res.status >= 500 || !data)) throw new Fail('unconfirmed', `HTTP ${res.status}`);
  if (!data) throw new Fail('platform', `HTTP ${res.status}`);
  if (data.error || !res.ok) throw classify(data.error, res.status);
  return { ok: true, status: res.status, data };
}
const need = (r: Reply, what: string): string => { const id = r.data.id; if (!id) throw new Fail('platform', `no id for ${what}`); return id; };

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

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function facebook(post: Draft, t: Tokens, f: typeof fetch, prev: Result | undefined, ctx: Ctx): Promise<Result> {
  const token = t.META_PAGE_ACCESS_TOKEN!, page = t.META_PAGE_ID!;
  // The post call already started in an earlier run that never reported back: it may be live, so it is never repeated by itself
  if (prev?.state === 'sending') return { ok: false, code: 'unconfirmed' };
  await ctx.save?.({ ok: false, state: 'sending' });
  const video = post.media.find(m => m.type === 'video'), imgs = post.media.filter(m => m.type === 'image');
  let r: Reply;
  if (video) r = await call(f, 'POST', `${page}/videos`, { file_url: video.url, description: post.body, access_token: token }, true);
  else if (imgs.length === 1) r = await call(f, 'POST', `${page}/photos`, { url: imgs[0]!.url, caption: post.body, access_token: token }, true);
  else if (imgs.length > 1) {
    // Several photos: each is uploaded unpublished, then one feed post carries them all
    const ids: string[] = [];
    for (const m of imgs) ids.push(need(await call(f, 'POST', `${page}/photos`, { url: m.url, published: 'false', access_token: token }), 'photo'));
    r = await call(f, 'POST', `${page}/feed`, { message: post.body, access_token: token, ...Object.fromEntries(ids.map((id, i) => [`attached_media[${i}]`, JSON.stringify({ media_fbid: id })])) }, true);
  } else r = await call(f, 'POST', `${page}/feed`, { message: post.body, access_token: token }, true);
  return { ok: true, id: r.data.post_id || need(r, 'post') };
}

async function instagram(post: Draft, t: Tokens, f: typeof fetch, prev: Result | undefined, ctx: Ctx): Promise<Result> {
  const token = t.META_PAGE_ACCESS_TOKEN!, ig = t.IG_USER_ID!;
  const now = ctx.now ?? Date.now();
  const video = post.media.find(m => m.type === 'video'), imgs = post.media.filter(m => m.type === 'image');
  let cid = prev?.creation_id, since = prev?.since || new Date(now).toISOString();
  if (!cid) {
    // Making a container posts nothing, so a crash before it is simply started again
    await ctx.save?.({ ok: false, state: 'sending' });
    const cap = { caption: post.body, access_token: token };
    if (video) cid = need(await call(f, 'POST', `${ig}/media`, { ...cap, media_type: 'REELS', video_url: video.url }), 'reel');
    else if (imgs.length > 1) {
      const kids: string[] = [];
      for (const m of imgs) kids.push(need(await call(f, 'POST', `${ig}/media`, { image_url: m.url, is_carousel_item: 'true', access_token: token }), 'carousel item'));
      cid = need(await call(f, 'POST', `${ig}/media`, { ...cap, media_type: 'CAROUSEL', children: kids.join(',') }), 'carousel');
    } else cid = need(await call(f, 'POST', `${ig}/media`, { ...cap, image_url: imgs[0]!.url }), 'photo');
    since = new Date(now).toISOString();
    await ctx.save?.({ ok: false, state: 'processing', creation_id: cid, since });
  }
  // A video (and a carousel) is prepared on Meta's side: publish only once the container says FINISHED
  if (video || imgs.length > 1) {
    const wait = ctx.wait ?? sleep, polls = ctx.polls ?? 2;   // two looks per run (2 subrequests); the cron run five minutes later looks again, so no run ever waits long
    let st = '';
    for (let i = 0; i < polls; i++) {
      st = String((await call(f, 'GET', cid, { fields: 'status_code', access_token: token })).data.status_code || '');
      if (st !== 'IN_PROGRESS') break;
      if (i < polls - 1) await wait(ctx.pollMs ?? 3000);
    }
    if (st === 'PUBLISHED') return { ok: true };       // an earlier run got it out before it could write the answer down
    if (st === 'ERROR' || st === 'EXPIRED') throw new Fail(video ? 'video_failed' : 'media_rejected', `container ${st}`);
    if (st !== 'FINISHED') {
      if (now - Date.parse(since) > VIDEO_WAIT_MS) throw new Fail('video_timeout', `still ${st || 'unknown'} after ${Math.round(VIDEO_WAIT_MS / 60000)} min`);
      return { ok: false, state: 'processing', creation_id: cid, since }; // the next run continues from here
    }
  } else if (prev?.state === 'publishing') {
    // The publish call started in an earlier run: ask the container whether it landed before calling it again
    const st = String((await call(f, 'GET', cid, { fields: 'status_code', access_token: token })).data.status_code || '');
    if (st === 'PUBLISHED') return { ok: true };
  }
  await ctx.save?.({ ok: false, state: 'publishing', creation_id: cid, since });
  const r = await call(f, 'POST', `${ig}/media_publish`, { creation_id: cid, access_token: token }, true);
  return { ok: true, id: need(r, 'post') };
}

// prev = what an earlier run stored for this platform: an ok result is never repeated, an unfinished one is continued
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
    try { results[p] = await publishOne(p, post, t, f, results[p], { ...o, save }); } catch { results[p] = { ok: false, code: 'network' }; }
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
export type Level = 'ok' | 'warn' | 'block';
export interface Check { platform: 'facebook' | 'instagram'; level: Level; code: string }
export interface Connection { page: string | null; instagram: string | null; checks: Check[] }
export async function checkConnection(t: Tokens, f: typeof fetch = fetch, now = Date.now()): Promise<Connection> {
  const checks: Check[] = [], out: Connection = { page: null, instagram: null, checks };
  const add = (platform: Check['platform'], level: Level, code: string) => checks.push({ platform, level, code });
  const token = t.META_PAGE_ACCESS_TOKEN;
  if (!token || !t.META_PAGE_ID) { add('facebook', 'block', 'fb_not_connected'); add('instagram', 'block', 'ig_not_connected'); return out; }
  let linked: { id?: string; username?: string } | undefined, pageOk = true;
  try {
    const r = await call(f, 'GET', t.META_PAGE_ID, { fields: 'id,name,instagram_business_account{id,username}', access_token: token });
    out.page = String(r.data.name || '') || null;
    linked = r.data.instagram_business_account as typeof linked;
  } catch (e) {
    pageOk = false;
    if (e instanceof Fail && e.code === 'token') { add('facebook', 'block', 'fb_token'); add('instagram', 'block', 'ig_token'); return out; }
    add('facebook', 'block', 'fb_page');
  }
  // Permissions and expiry, from the token's own debug record
  let scopes: string[] = [];
  try {
    const d = (await call(f, 'GET', 'debug_token', { input_token: token, access_token: token })).data.data as { is_valid?: boolean; scopes?: string[]; granular_scopes?: { scope: string }[]; expires_at?: number } | undefined;
    if (d?.is_valid === false) { add('facebook', 'block', 'fb_token'); add('instagram', 'block', 'ig_token'); return out; }
    if (d) {
      scopes = [...(d.scopes || []), ...(d.granular_scopes || []).map(g => g.scope)];
      if (d.expires_at && d.expires_at * 1000 - now < 3 * 864e5) add('facebook', 'warn', 'fb_expiring');
    }
  } catch { /* permissions that cannot be read are said as unknown below */ }
  const has = (s: string) => scopes.includes(s);
  if (pageOk) {
    if (!scopes.length) add('facebook', 'warn', 'perm_unknown');
    else if (!has('pages_manage_posts')) add('facebook', 'block', 'fb_perm');
    if (!checks.some(c => c.platform === 'facebook' && c.level === 'block')) add('facebook', 'ok', 'fb_ok');
  }
  if (!t.IG_USER_ID) add('instagram', 'block', linked?.id ? 'ig_not_saved' : 'ig_not_linked');
  else if (pageOk && !linked?.id) add('instagram', 'block', 'ig_not_linked');
  else if (linked?.id && linked.id !== t.IG_USER_ID) add('instagram', 'block', 'ig_mismatch');
  else if (scopes.length && !has('instagram_content_publish')) add('instagram', 'block', 'ig_perm');
  else {
    try {
      out.instagram = String((await call(f, 'GET', t.IG_USER_ID, { fields: 'id,username', access_token: token })).data.username || '') || null;
      add('instagram', 'ok', 'ig_ok');
    } catch { add('instagram', 'block', 'ig_page'); }
  }
  return out;
}

// "اكتب لي نص": the post written by the social model (Grok when keyed) from what the user typed, within the
// shortest limit of the chosen platforms. Checked like any post; the user edits it before scheduling.
export function suggestPrompt(brief: string, platforms: SocialPlatform[]): string {
  const max = Math.min(...platforms.map(p => SOCIAL[p].max), 600);
  return `اكتب منشور سوشال بالسعودي لشركة رعاية صحية منزلية في الرياض، مخاطبة المذكر، للمنصات: ${platforms.map(p => SOCIAL[p].name).join('، ')}.
الفكرة: ${brief}
القواعد: جمل قصيرة، الفائدة قبل الميزة، دعوة واضحة للحجز، بدون وعد بشفاء أو نتيجة، بدون "الأفضل" أو "الوحيد"، بدون تجارب مرضى، بدون سعر إلا لو موجود في المعرفة ومعه الإجمالي.
الحد ${max} حرف. رد بنص المنشور بس، بدون شرح وبدون علامات تنصيص.`;
}
export function cleanSuggestion(raw: string, platforms: SocialPlatform[]): string {
  const max = Math.min(...platforms.map(p => SOCIAL[p].max), 600);
  const t = String(raw || '').trim().replace(/^["«“]+|["»”]+$/g, '').replace(/^(المنشور|النص)\s*:\s*/, '').trim();
  return t.length > max ? t.slice(0, max).replace(/\s+\S*$/, '') : t;
}
