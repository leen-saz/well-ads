// Phase 4.1: the dashboards as the pipeline builds them (pipeline/build.py), served from R2 behind the gateway.
// Same pages and numbers as the live site; later pieces replace them with Astro pages one by one.

// Pages the pipeline uploads under site/ (see .github/workflows/pipeline.yml)
export function siteKey(pathname: string): string | null {
  if (pathname === '/' || pathname === '/index.html') return 'site/index.html';
  if (/^\/c\/?$/.test(pathname)) return 'site/c/index.html';
  const d = pathname.match(/^\/dept\/([a-z]+)\/?$/);
  if (d) return `site/dept/${d[1]}/index.html`;
  if (pathname === '/control/ads.json') return 'site/control/ads.json';
  const t = pathname.match(/^\/thumbs\/([a-f0-9]{20}\.(?:jpg|png|webp|gif))$/);
  if (t) return `thumbs/${t[1]}`;
  return null;
}

// Old Vercel redirects (build.py): /organic and /creative open modes of the main dashboard
export function siteRedirect(pathname: string): string | null {
  if (/^\/organic\/?$/.test(pathname)) return '/?mode=organic';
  if (/^\/creative\/?$/.test(pathname)) return '/?view=creative';
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

export async function serveSite(request: Request, bucket: R2Bucket): Promise<Response | null> {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const url = new URL(request.url);
  const to = siteRedirect(url.pathname);
  if (to) return new Response(null, { status: 302, headers: { location: to, 'cache-control': 'no-store' } });
  const key = siteKey(url.pathname);
  if (!key) return null;
  const obj = await bucket.get(key, { onlyIf: request.headers });
  if (!obj) return new Response('غير موجود', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  const ext = key.slice(key.lastIndexOf('.') + 1);
  const headers = new Headers({ 'content-type': TYPES[ext] ?? 'application/octet-stream', etag: obj.httpEtag });
  // Covers are named by their content hash and sit behind the login: the viewer's browser keeps them.
  headers.set('cache-control', key.startsWith('thumbs/') ? 'private, max-age=604800, immutable' : 'private, no-cache');
  if (ext === 'html') {
    // build.py hashes the page's inline scripts into this policy (same CSP the live site sends)
    const csp = await bucket.get('site/csp.txt');
    if (csp) headers.set('content-security-policy', framable((await csp.text()).trim()));
  }
  if (!('body' in obj)) return new Response(null, { status: 304, headers });
  return new Response(request.method === 'HEAD' ? null : obj.body, { status: 200, headers });
}
