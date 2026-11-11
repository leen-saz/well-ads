// The Postiz engine: an open-source publisher (AGPL-3.0, github.com/gitroomhq/postiz-app) that we only CALL over its public HTTP API
// (docs.postiz.com/public-api). No Postiz code is in this repo. It publishes TikTok, X and LinkedIn for us.
//
// Rules this file keeps (docs/social-engine.md):
//  - It is called from cron.ts only, after the named approver approved the post. Nothing here knows about approval, and Postiz's own
//    approval/draft features are never used: every post is created with type "now" (publish at once), never "schedule" or "draft".
//  - HTTPS only; every call has a timeout; the key goes in the Authorization header and is never logged or stored in a result.
//  - Postiz has NO idempotency key. So the call that creates the post is made exactly once and never retried by a retry loop;
//    if its answer is lost we look the post up (GET /posts) before deciding anything, and if it cannot be found the result is
//    'unconfirmed' (a person decides). Reads and media uploads are safe to repeat and are retried.
//  - What was done is saved step by step in the platform's result (sending -> processing + the Postiz post id), which is what the
//    claim/recovery logic of cron.ts relies on (#202).
import { Fail, SOCIAL, capCheck, type Ctx, type Draft, type Result, type SocialPlatform, type Tokens } from './engine';

export const POSTIZ_WAIT_MS = 30 * 60_000;    // Postiz gets this long to publish before the result counts as unconfirmed
const TIMEOUT_MS = 15_000;
// Our platform -> the Postiz channel identifiers that carry it (first = preferred when both are connected)
const IDENT: Partial<Record<SocialPlatform, string[]>> = { tiktok: ['tiktok'], x: ['x'], linkedin: ['linkedin-page', 'linkedin'] };
export const postizPlatforms = (Object.keys(IDENT) as SocialPlatform[]);

// ---- Configuration: POSTIZ_URL and POSTIZ_API_KEY (the connectors vault, or Worker secrets of the same names)
export type Conf = { ok: true; base: string; key: string } | { ok: false; why: 'off' | 'url' | 'key' };
export function postizConf(t: Tokens): Conf {
  const raw = String(t.POSTIZ_URL || '').trim(), key = String(t.POSTIZ_API_KEY || '').trim();
  if (!raw && !key) return { ok: false, why: 'off' };
  if (!raw) return { ok: false, why: 'url' };
  if (!key || /\s/.test(key)) return { ok: false, why: 'key' };
  let u: URL;
  try { u = new URL(raw); } catch { return { ok: false, why: 'url' }; }
  const h = u.hostname.toLowerCase();
  // HTTPS only, no embedded credentials, and never a local or private address
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) return { ok: false, why: 'url' };
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h === '[::1]' || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.startsWith('[')) return { ok: false, why: 'url' };
  // Self-hosted serves the API at <domain>/api/public/v1; the cloud at api.postiz.com/public/v1 (give that one in full)
  const path = u.pathname.replace(/\/+$/, '');
  const base = u.origin + (!path ? '/api/public/v1' : path.endsWith('/public/v1') ? path : path + '/public/v1');
  return { ok: true, base, key };
}
// The vault's values, plus Worker secrets of the same names as a fallback (the vault wins)
export function withEngineSecrets(t: Record<string, string>, env: unknown): Record<string, string> {
  const e = (env && typeof env === 'object' ? env : {}) as Record<string, unknown>;
  const out = { ...t };
  for (const k of ['POSTIZ_URL', 'POSTIZ_API_KEY']) if (!out[k] && typeof e[k] === 'string' && e[k]) out[k] = e[k] as string;
  return out;
}

// ---- The HTTP client
class PErr extends Error { constructor(public kind: 'network' | 'timeout' | 'http', public status = 0, public data: unknown = null) { super(kind); } }
interface Opt { body?: unknown; retries?: number; ctx?: Pick<Ctx, 'wait' | 'timeoutMs'> }
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

async function once(c: Extract<Conf, { ok: true }>, f: typeof fetch, method: string, path: string, o: Opt): Promise<unknown> {
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), o.ctx?.timeoutMs ?? TIMEOUT_MS);
  let res: Response;
  try {
    res = await f(c.base + path, { method, signal: ac.signal, headers: { Authorization: c.key, ...(o.body !== undefined ? { 'Content-Type': 'application/json' } : {}), Accept: 'application/json' },
      ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}) });
  } catch (e) { throw new PErr(ac.signal.aborted ? 'timeout' : 'network', 0, String((e as Error)?.name || '')); }
  finally { clearTimeout(timer); }
  const text = await res.text().catch(() => '');
  let data: unknown = null; try { data = text ? JSON.parse(text) : null; } catch { /* not JSON: the status decides */ }
  if (!res.ok) throw new PErr('http', res.status, data);
  return data;
}
// Safe calls (reads, uploads) are retried on network trouble, 429 and 5xx; the post-creating call has retries = 0
async function call(c: Extract<Conf, { ok: true }>, f: typeof fetch, method: string, path: string, o: Opt = {}): Promise<unknown> {
  const wait = o.ctx?.wait ?? sleep, n = o.retries ?? 0;
  for (let i = 0; ; i++) {
    try { return await once(c, f, method, path, o); }
    catch (e) {
      const retry = e instanceof PErr && (e.kind !== 'http' || e.status === 429 || e.status >= 500);
      if (!retry || i >= n) throw e;
      await wait(300 * 2 ** i);
    }
  }
}
const msgOf = (d: unknown): string => {
  const m = d && typeof d === 'object' ? (d as Record<string, unknown>).message ?? (d as Record<string, unknown>).error : d;
  const s = Array.isArray(m) ? m.join('; ') : typeof m === 'string' ? m : '';
  return s.slice(0, 300);
};
// An error that happened BEFORE anything was posted, in the plain buckets of Code
function classify(e: unknown): Fail {
  if (!(e instanceof PErr)) return new Fail('network');
  if (e.kind !== 'http') return new Fail('network', e.kind);
  const detail = `HTTP ${e.status}${msgOf(e.data) ? ': ' + msgOf(e.data) : ''}`;
  if (e.status === 401 || e.status === 403) return new Fail('token', detail);
  if (e.status === 429) return new Fail('busy', detail);
  if (e.status === 413) return new Fail('media_rejected', detail);
  if (e.status >= 500) return new Fail('network', detail);
  return new Fail('platform', detail);
}

interface Integration { id: string; name: string; identifier: string; disabled: boolean }
const asList = (d: unknown): unknown[] => (Array.isArray(d) ? d : []);
async function integrations(c: Extract<Conf, { ok: true }>, f: typeof fetch, ctx: Ctx): Promise<Integration[]> {
  const d = await call(c, f, 'GET', '/integrations', { retries: 2, ctx });
  return asList(d).flatMap(x => {
    const r = x as Record<string, unknown>;
    return typeof r.id === 'string' && typeof r.identifier === 'string' ? [{ id: r.id, name: String(r.name || ''), identifier: r.identifier, disabled: !!r.disabled }] : [];
  });
}
// The one enabled channel for a platform: none or several is a state the owner must fix, so it fails before anything is sent
function channelFor(p: SocialPlatform, list: Integration[]): { ok: true; ch: Integration } | { ok: false; code: 'none' | 'many'; names: string[] } {
  const live = list.filter(i => !i.disabled);
  // In order of preference (a LinkedIn company page before a profile): the first kind that has a channel must have exactly one
  for (const id of IDENT[p] || []) {
    const mine = live.filter(i => i.identifier === id);
    if (mine.length === 1) return { ok: true, ch: mine[0]! };
    if (mine.length > 1) return { ok: false, code: 'many', names: mine.map(i => i.name) };
  }
  return { ok: false, code: 'none', names: [] };
}

// ---- What Postiz needs per platform (settings.__type must match the channel's identifier)
function settingsFor(p: SocialPlatform, ch: Integration, body: string): Record<string, unknown> {
  if (p === 'tiktok') return { __type: 'tiktok', title: body.split('\n')[0]!.trim().slice(0, 90), privacy_level: 'PUBLIC_TO_EVERYONE', duet: false, stitch: false, comment: true, autoAddMusic: 'no',
    brand_content_toggle: false, brand_organic_toggle: false, video_made_with_ai: false, content_posting_method: 'DIRECT_POST' };
  if (p === 'x') return { __type: 'x', who_can_reply_post: 'everyone', community: '', made_with_ai: false, paid_partnership: false };
  return { __type: ch.identifier };   // linkedin and linkedin-page (post_as_images_carousel is optional)
}

interface PostRow { id: string; content: string; state: string; error: string | null; publishDate: string; releaseURL?: string; integration?: { id?: string } }
const plain = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
async function listPosts(c: Extract<Conf, { ok: true }>, f: typeof fetch, sinceIso: string, now: number, ctx: Ctx): Promise<PostRow[]> {
  const q = new URLSearchParams({ startDate: new Date(Date.parse(sinceIso) - 3600e3).toISOString(), endDate: new Date(now + 3600e3).toISOString() });
  const d = (await call(c, f, 'GET', `/posts?${q}`, { retries: 2, ctx })) as { posts?: unknown } | null;
  return asList(d?.posts).flatMap(x => {
    const r = x as Record<string, unknown>;
    return typeof r.id === 'string' ? [{ id: r.id, content: String(r.content || ''), state: String(r.state || ''), error: typeof r.error === 'string' ? r.error : null, publishDate: String(r.publishDate || ''),
      ...(typeof r.releaseURL === 'string' ? { releaseURL: r.releaseURL } : {}), integration: (r.integration || {}) as { id?: string } }] : [];
  });
}
// The post we may have created: same channel, same text, created after we started (a draft or an errored one does not count)
async function findOurs(c: Extract<Conf, { ok: true }>, f: typeof fetch, channel: string, body: string, since: string, now: number, ctx: Ctx): Promise<PostRow | undefined> {
  const from = Date.parse(since) - 120_000;
  return (await listPosts(c, f, since, now, ctx)).find(p => p.integration?.id === channel && ['QUEUE', 'PUBLISHED'].includes(p.state) && plain(p.content) === plain(body) && Date.parse(p.publishDate) >= from);
}

// Follow a post we know the id of: published = done, error = failed, anything else = the next run looks again (bounded)
async function settle(c: Extract<Conf, { ok: true }>, f: typeof fetch, id: string, prev: Result, ctx: Ctx, now: number): Promise<Result> {
  const since = prev.since || new Date(now).toISOString(), wait = ctx.wait ?? sleep, polls = ctx.polls ?? 3;
  const keep: Result = { ok: false, state: 'processing', creation_id: id, since, ...(prev.channel ? { channel: prev.channel } : {}) };
  for (let i = 0; i < polls; i++) {
    let row: PostRow | undefined;
    try { row = (await listPosts(c, f, since, now, ctx)).find(p => p.id === id); }
    catch { return keep; }                       // cannot read right now: the post exists, ask again next run
    if (row?.state === 'PUBLISHED') return { ok: true, id };
    if (row?.state === 'ERROR') return { ok: false, code: 'platform', detail: row.error ? `Postiz: ${row.error.slice(0, 300)}` : 'Postiz: publishing failed' };
    if (i < polls - 1) await wait(ctx.pollMs ?? 3000);
  }
  if (now - Date.parse(since) > POSTIZ_WAIT_MS) return { ok: false, code: 'unconfirmed', detail: `still not published after ${Math.round(POSTIZ_WAIT_MS / 60000)} min` };
  return keep;
}

export async function postizPublish(platform: SocialPlatform, post: Draft, t: Tokens, f: typeof fetch, prev: Result | undefined, ctx: Ctx = {}): Promise<Result> {
  const conf = postizConf(t), now = ctx.now ?? Date.now();
  // Not set up: the post is kept as a reminder, exactly as before this engine existed
  if (!conf.ok) return conf.why === 'off' ? { ok: false, code: 'unsupported' } : { ok: false, code: 'not_connected', detail: conf.why === 'url' ? 'POSTIZ_URL is not a valid https address' : 'POSTIZ_API_KEY is missing' };
  const bad = capCheck(platform, post);
  if (bad) return { ok: false, code: !post.media.length && 'needsMedia' in SOCIAL[platform] ? 'no_media' : 'invalid', detail: bad };
  // An answer that was lost stays lost: only a person's retry (which clears this entry) may send it again
  if (prev?.code === 'unconfirmed') return prev;
  try {
    // A run that already created the post only follows it
    if (prev?.creation_id) return await settle(conf, f, prev.creation_id, prev, ctx, now);
    // The create call started in an earlier run that never reported back: the post may exist. Look; never create again by ourselves
    if (prev?.state === 'sending') {
      const hit = prev.channel && prev.since ? await findOurs(conf, f, prev.channel, post.body, prev.since, now, ctx).catch(() => undefined) : undefined;
      if (!hit) return { ok: false, code: 'unconfirmed' };
      const adopted: Result = { ok: false, state: 'processing', creation_id: hit.id, since: prev.since!, channel: prev.channel! };
      await ctx.save?.(adopted);
      return await settle(conf, f, hit.id, adopted, ctx, now);
    }
    // Fresh start (also a start that was only held back by the rate limit: nothing was created then)
    const first = prev?.since || new Date(now).toISOString();   // when this post first tried (bounds the wait for the rate limit)
    const found = channelFor(platform, await integrations(conf, f, ctx));
    if (!found.ok) return { ok: false, code: found.code === 'none' ? 'not_connected' : 'many_accounts', ...(found.names.length ? { detail: found.names.join(', ') } : {}) };
    const channel = found.ch;
    // Media: Postiz fetches our public /m/ link itself (POST /upload-from-url); the returned id and path go into the post
    const media: { id: string; path: string }[] = prev?.media ? [...prev.media] : [];
    if (media.length !== post.media.length) {
      media.length = 0;
      for (const m of post.media) {
        try {
          const d = (await call(conf, f, 'POST', '/upload-from-url', { body: { url: m.url }, retries: 2, ctx })) as Record<string, unknown> | null;
          if (typeof d?.id !== 'string' || typeof d?.path !== 'string') throw new Fail('media_rejected', 'upload answered without id/path');
          media.push({ id: d.id, path: d.path });
        } catch (e) { if (e instanceof PErr && e.kind === 'http' && e.status === 400) throw new Fail('media_rejected', `HTTP 400${msgOf(e.data) ? ': ' + msgOf(e.data) : ''}`); throw e; }
      }
    }
    // The point of no return: written down first, so a crash from here on is known to be "maybe created"
    const since = new Date(now).toISOString();   // from here on a look-up only accepts posts created after this
    await ctx.save?.({ ok: false, state: 'sending', channel: channel.id, since, media });
    let created: unknown;
    try {
      created = await call(conf, f, 'POST', '/posts', { retries: 0, ctx, body: {
        type: 'now', date: new Date(now).toISOString(), shortLink: false, tags: [],
        posts: [{ integration: { id: channel.id }, value: [{ content: post.body, image: media }], settings: settingsFor(platform, channel, post.body) }] } });
    } catch (e) {
      // 4xx answers (and 429) mean it was refused: nothing exists. Anything else (timeout, 5xx, lost connection) is unknown: look it up
      if (e instanceof PErr && e.kind === 'http' && e.status < 500) {
        if (e.status === 429 && now - Date.parse(first) < POSTIZ_WAIT_MS) return { ok: false, state: 'processing', since: first, media };   // not created: the next run tries again
        throw classify(e);
      }
      const hit = await findOurs(conf, f, channel.id, post.body, since, now, ctx).catch(() => undefined);
      if (!hit) return { ok: false, code: 'unconfirmed', detail: e instanceof PErr ? `${e.kind}${e.status ? ' ' + e.status : ''}` : '' };
      created = [{ postId: hit.id }];
    }
    const id = (asList(created)[0] as { postId?: unknown } | undefined)?.postId;
    if (typeof id !== 'string' || !id) {
      const hit = await findOurs(conf, f, channel.id, post.body, since, now, ctx).catch(() => undefined);
      if (!hit) return { ok: false, code: 'unconfirmed', detail: 'answer without a post id' };
      return await settle(conf, f, hit.id, { ok: false, since, channel: channel.id }, ctx, now);
    }
    const next: Result = { ok: false, state: 'processing', creation_id: id, since, channel: channel.id };
    await ctx.save?.(next);
    return await settle(conf, f, id, next, ctx, now);
  } catch (e) {
    if (e instanceof Fail) return { ok: false, code: e.code, ...(e.detail ? { detail: e.detail } : {}) };
    const x = classify(e);
    // Held back by the rate limit before anything was created: keep trying on the next runs, for a bounded time
    if (x.code === 'busy' && now - Date.parse(prev?.since || new Date(now).toISOString()) < POSTIZ_WAIT_MS) return { ok: false, state: 'processing', since: prev?.since || new Date(now).toISOString() };
    return { ok: false, code: x.code, ...(x.detail ? { detail: x.detail } : {}) };
  }
}

// ---- Readiness: is the engine reachable, is the key valid, which of our platforms have a connected channel.
// Names of channels only (never a key or a token). Codes only; the Social tab words them.
export type EngineCode = 'ok' | 'off' | 'url' | 'key' | 'down';
export interface PlatformChannel { platform: SocialPlatform; code: 'ok' | 'none' | 'many'; names: string[] }
export interface EngineStatus { code: EngineCode; channels: PlatformChannel[] }
export async function postizStatus(t: Tokens, f: typeof fetch = fetch, ctx: Ctx = {}): Promise<EngineStatus> {
  const conf = postizConf(t);
  if (!conf.ok) return { code: conf.why === 'off' ? 'off' : conf.why === 'url' ? 'url' : 'key', channels: [] };
  try {
    const r = (await call(conf, f, 'GET', '/is-connected', { retries: 1, ctx })) as { connected?: boolean } | null;
    if (r?.connected === false) return { code: 'key', channels: [] };
  } catch (e) { return { code: e instanceof PErr && e.kind === 'http' && (e.status === 401 || e.status === 403) ? 'key' : 'down', channels: [] }; }
  let list: Integration[];
  try { list = await integrations(conf, f, ctx); } catch (e) { return { code: e instanceof PErr && e.kind === 'http' && (e.status === 401 || e.status === 403) ? 'key' : 'down', channels: [] }; }
  return { code: 'ok', channels: postizPlatforms.map(platform => {
    const r = channelFor(platform, list);
    return { platform, code: r.ok ? 'ok' : r.code, names: r.ok ? [r.ch.name] : r.names };
  }) };
}
export const platformLive = (s: EngineStatus | null, p: SocialPlatform): boolean => !!s && s.code === 'ok' && s.channels.some(c => c.platform === p && c.code === 'ok');

// The pages and the scheduling form ask for this on every load: a short memory per Worker keeps Postiz from being asked each time.
// A failure is remembered shorter, so a recovered engine shows up quickly.
const memo = new Map<string, { at: number; s: EngineStatus }>();
export async function cachedStatus(t: Tokens, f: typeof fetch = fetch, now = Date.now(), fresh = false): Promise<EngineStatus> {
  const conf = postizConf(t);
  if (!conf.ok) return postizStatus(t, f);
  const k = conf.base + '|' + conf.key.slice(-6), hit = memo.get(k);
  if (!fresh && hit && now - hit.at < (hit.s.code === 'ok' ? 60_000 : 20_000)) return hit.s;
  const s = await postizStatus(t, f, { timeoutMs: 5000 });
  memo.set(k, { at: now, s });
  return s;
}
export const _clearStatusCache = () => memo.clear();
