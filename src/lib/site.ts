// Phase 4.1: the dashboards as the pipeline builds them (pipeline/build.py), served from R2 behind the gateway.
// Same pages and numbers as the live site; later pieces replace them with Astro pages one by one.
import { mediaPath } from '../modules/social/media';
import { ASSET_V } from './assets';

// Pages the pipeline uploads under site/ (see .github/workflows/pipeline.yml)
export function siteKey(pathname: string): string | null {
  if (pathname === '/' || pathname === '/index.html') return 'site/index.html';
  if (/^\/c\/?$/.test(pathname)) return 'site/c/index.html';
  const d = pathname.match(/^\/dept\/([a-z]+)\/?$/);
  if (d) return `site/dept/${d[1]}/index.html`;
  if (pathname === '/control/ads.json') return 'site/control/ads.json';
  if (pathname === '/dash.json') return 'site/dash.json';
  const t = pathname.match(/^\/thumbs\/([a-f0-9]{20}\.(?:jpg|png|webp|gif))$/);
  if (t) return `thumbs/${t[1]}`;
  return null;
}

// Old Vercel redirects (build.py): /organic and /creative open modes of the main dashboard
export function siteRedirect(pathname: string): string | null {
  if (/^\/organic\/?$/.test(pathname)) return '/?mode=organic';
  if (/^\/creative\/?$/.test(pathname)) return '/?view=creative';
  // Settings opens on its first tab (my account); access & sign-in is the second tab
  if (/^\/settings\/?$/.test(pathname)) return '/account/';
  return null;
}

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8', json: 'application/json; charset=utf-8',
  jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
};

// The pages may be framed by our own pages (kept tabs) and may frame our own pages
export function framable(csp: string): string {
  let out = csp.replace("frame-ancestors 'none'", "frame-ancestors 'self'");
  out = /frame-src /.test(out) ? out.replace(/frame-src (?!'self')/, "frame-src 'self' ") : out + "; frame-src 'self'";
  return out;
}

// The page also carries the policy in a <meta> tag (build.py). Both apply, so the meta copy must allow our
// own frames too; frame-ancestors is dropped there because browsers ignore it in <meta> and warn.
export function metaCsp(csp: string): string {
  return framable(csp).split(';').map(d => d.trim()).filter(d => d && !d.startsWith('frame-ancestors')).join('; ');
}

// The dashboard pages, dash.json and csp.txt, kept in this isolate for up to a minute: an R2 read costs ~300 ms and
// every visit needed two in a row. After a minute the copy is revalidated by etag (no body is read if unchanged).
// A pipeline upload therefore shows up within a minute. Covers stay on R2 (immutable; browsers keep them).
type Kept = { etag: string; bytes: ArrayBuffer; at: number };
const KEPT = new Map<string, Kept>(), BUSY = new Map<string, Promise<Kept | null>>();
export const KEEP_MS = 60_000;
const MAX_ONE = 8 * 1024 * 1024, MAX_ALL = 48 * 1024 * 1024;
export const clearSiteCache = () => { KEPT.clear(); BUSY.clear(); };

async function fetchKept(bucket: R2Bucket, key: string, now: number): Promise<Kept | null> {
  const old = KEPT.get(key);
  const obj = await bucket.get(key, old ? { onlyIf: { etagDoesNotMatch: old.etag } } : undefined);
  if (!obj) { KEPT.delete(key); return null; }
  // Unchanged since the copy we have: R2 sends the object without a body
  if (old && !('body' in obj)) { const k = { ...old, at: now }; KEPT.set(key, k); return k; }
  const k: Kept = { etag: obj.httpEtag, bytes: await (obj as R2ObjectBody).arrayBuffer(), at: now };
  if (k.bytes.byteLength <= MAX_ONE) {
    KEPT.delete(key); KEPT.set(key, k);
    let total = 0;
    for (const v of KEPT.values()) total += v.bytes.byteLength;
    for (const [kk, v] of KEPT) { if (total <= MAX_ALL) break; KEPT.delete(kk); total -= v.bytes.byteLength; }   // oldest first
  }
  return k;
}
// One R2 read at a time per key, however many requests arrive together
export function kept(bucket: R2Bucket, key: string, now = Date.now()): Promise<Kept | null> {
  const c = KEPT.get(key);
  if (c && now - c.at < KEEP_MS) return Promise.resolve(c);
  let p = BUSY.get(key);
  if (!p) { p = fetchKept(bucket, key, now).finally(() => BUSY.delete(key)); BUSY.set(key, p); }
  return p;
}
const etagIn = (header: string | null, etag: string) => !!header && header.split(',').some(t => t.trim().replace(/^W\//, '') === etag.replace(/^W\//, ''));

export async function serveSite(request: Request, bucket: R2Bucket): Promise<Response | null> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const url = new URL(request.url);
  // Post media (public, unguessable name): Meta fetches it from here when the post is published
  const media = mediaPath(url.pathname);
  if (media) {
    const obj = await bucket.get(media);
    if (!obj) return new Response('غير موجود', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    const h = new Headers({ 'content-type': obj.httpMetadata?.contentType || 'application/octet-stream', 'cache-control': 'public, max-age=31536000, immutable', etag: obj.httpEtag });
    return new Response(request.method === 'HEAD' ? null : obj.body, { headers: h });
  }
  const to = siteRedirect(url.pathname);
  if (to) return new Response(null, { status: 302, headers: { location: to, 'cache-control': 'no-store' } });
  const key = siteKey(url.pathname);
  if (!key) return null;
  if (key.startsWith('site/')) return servePage(request, bucket, key);
  // Covers (thumbs/): named by their content hash and behind the login, so the viewer's browser keeps them
  const obj = await bucket.get(key, { onlyIf: request.headers });
  if (!obj) return new Response('غير موجود', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  const ext = key.slice(key.lastIndexOf('.') + 1);
  const headers = new Headers({ 'content-type': TYPES[ext] ?? 'application/octet-stream', etag: obj.httpEtag, 'cache-control': 'private, max-age=604800, immutable' });
  if (!('body' in obj)) return new Response(null, { status: 304, headers });
  return new Response(request.method === 'HEAD' ? null : obj.body, { status: 200, headers });
}

async function servePage(request: Request, bucket: R2Bucket, key: string): Promise<Response> {
  const ext = key.slice(key.lastIndexOf('.') + 1), html = ext === 'html';
  // The page and its policy are read together, not one after the other
  const [page, csp] = await Promise.all([kept(bucket, key), html ? kept(bucket, 'site/csp.txt') : Promise.resolve(null)]);
  if (!page) return new Response('غير موجود', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  // The HTML points at this deploy's versioned scripts (src/lib/assets.ts), so a new deploy is a new page for the browser
  const etag = html && ASSET_V ? page.etag.replace(/"$/, `-${ASSET_V}"`) : page.etag;
  const headers = new Headers({ 'content-type': TYPES[ext] ?? 'application/octet-stream', etag, 'cache-control': 'private, no-cache' });
  // build.py hashes the page's inline scripts into this policy (same CSP the live site sends)
  if (csp) headers.set('content-security-policy', framable(new TextDecoder().decode(csp.bytes).trim()));
  if (etagIn(request.headers.get('if-none-match'), etag)) return new Response(null, { status: 304, headers });
  const res = new Response(request.method === 'HEAD' ? null : page.bytes, { status: 200, headers });
  if (!html || typeof HTMLRewriter === 'undefined') return res;
  return new HTMLRewriter().on('meta[http-equiv="Content-Security-Policy"]', {
    element(el) { const c = el.getAttribute('content'); if (c) el.setAttribute('content', metaCsp(c)); },
  }).transform(res);
}
