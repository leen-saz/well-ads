// Meta Graph API adapter for organic publishing (Facebook page, Instagram) and the connection check. Moved here from
// src/modules/social/social.ts in M10 (docs/PRD.md §3.0) with no change in behaviour: policy (approval, timing, retries) stays in social.ts
// and cron.ts; this file only speaks to Graph. Tokens arrive as arguments and never leave in a log or an answer.
import { Fail, type Ctx, type Draft, type Result, type Tokens } from '../../modules/social/engine';

export const GRAPH = 'https://graph.facebook.com/v23.0';
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


const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export async function facebook(post: Draft, t: Tokens, f: typeof fetch, prev: Result | undefined, ctx: Ctx): Promise<Result> {
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

export async function instagram(post: Draft, t: Tokens, f: typeof fetch, prev: Result | undefined, ctx: Ctx): Promise<Result> {
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

// Account health (src/lib/account-health.ts): one read of /me with the token in the Authorization header, never in the address.
// ok = answers; fail = the account (a short code, never Meta's message); error = Meta itself is down; none = no token.
export async function graphProbe(token: string | undefined, f: typeof fetch = fetch): Promise<['ok' | 'fail' | 'error' | 'none', string | null]> {
  if (!token) return ['none', null];
  try {
    const r = await f(`${GRAPH}/me?fields=id`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
    if (r.ok) return ['ok', null];
    if (r.status >= 500) return ['error', null];
    const j = (await r.json().catch(() => ({}))) as { error?: { code?: number } };
    return ['fail', `meta_${r.status}_${Number(j.error?.code) || 0}`];
  } catch { return ['error', null]; }
}

// Write access check (M12a): the scopes Meta granted this token, from its own debug record; null when they cannot be read.
export async function grantedScopes(token: string | undefined, f: typeof fetch = fetch): Promise<string[] | null> {
  if (!token) return null;
  try {
    const d = (await call(f, 'GET', 'debug_token', { input_token: token, access_token: token })).data.data as { is_valid?: boolean; scopes?: string[]; granular_scopes?: { scope: string }[] } | undefined;
    if (!d || d.is_valid === false) return null;
    return [...new Set([...(d.scopes || []), ...(d.granular_scopes || []).map(g => g.scope)])];
  } catch { return null; }
}
