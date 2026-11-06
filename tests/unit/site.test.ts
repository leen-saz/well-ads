import { beforeEach, describe, expect, it } from 'vitest';
import { KEEP_MS, STALE_MS, clearSiteCache, framable, kept, metaCsp, serveSite, siteKey, siteRedirect } from '../../src/lib/site';

describe('siteKey', () => {
  it('maps dashboard paths to R2 keys', () => {
    expect(siteKey('/')).toBe('site/index.html');
    expect(siteKey('/c/')).toBe('site/c/index.html');
    expect(siteKey('/dept/iv/')).toBe('site/dept/iv/index.html');
    expect(siteKey('/control/ads.json')).toBe('site/control/ads.json');
    expect(siteKey('/dash.json')).toBe('site/dash.json');
    expect(siteKey('/dash-aud.json')).toBe('site/dash-aud.json');
    expect(siteKey('/dash-organic.json')).toBe('site/dash-organic.json');
    expect(siteKey('/thumbs/0123456789abcdef0123.jpg')).toBe('thumbs/0123456789abcdef0123.jpg');
  });
  it('refuses anything else, including traversal', () => {
    for (const p of ['/login/', '/dash-x.json', '/thumbs/../site/csp.txt', '/thumbs/x.jpg', '/dept/../c/', '/site/index.html', '/api/health'])
      expect(siteKey(p)).toBeNull();
  });
});

describe('siteRedirect', () => {
  it('keeps the old Vercel redirects', () => {
    expect(siteRedirect('/organic')).toBe('/?mode=organic');
    expect(siteRedirect('/creative/')).toBe('/?view=creative');
    expect(siteRedirect('/settings/')).toBe('/account/');
    expect(siteRedirect('/')).toBeNull();
  });
});

// R2 stand-in that counts reads and honours etagDoesNotMatch (returns the object without a body when unchanged)
function bucket(files: Record<string, string>, etag = '"e"') {
  const reads: { key: string; onlyIf?: unknown }[] = [];
  const b = {
    reads,
    async get(key: string, o?: { onlyIf?: { etagDoesNotMatch?: string } }) {
      reads.push({ key, onlyIf: o?.onlyIf });
      if (!(key in files)) return null;
      if (o?.onlyIf?.etagDoesNotMatch === etag) return { httpEtag: etag };
      const text = files[key] as string;
      return { body: new Response(text).body, httpEtag: etag, text: async () => text, arrayBuffer: async () => new TextEncoder().encode(text).buffer };
    },
  };
  return b as unknown as R2Bucket & { reads: typeof reads };
}
beforeEach(() => clearSiteCache());

describe('serveSite', () => {
  const b = bucket({ 'site/index.html': '<p>x</p>', 'site/csp.txt': "script-src 'self'\n", 'thumbs/0123456789abcdef0123.png': 'img' });
  it('serves the dashboard with the CSP from the build', async () => {
    const r = await serveSite(new Request('https://x/'), b);
    expect(r?.status).toBe(200);
    expect(r?.headers.get('content-security-policy')).toBe("script-src 'self'; frame-src 'self'");
    expect(r?.headers.get('cache-control')).toBe('private, no-cache');
    expect(await r?.text()).toBe('<p>x</p>');
  });
  it('serves covers as private immutable', async () => {
    const r = await serveSite(new Request('https://x/thumbs/0123456789abcdef0123.png'), b);
    expect(r?.headers.get('content-type')).toBe('image/png');
    expect(r?.headers.get('cache-control')).toBe('private, max-age=604800, immutable');
  });
  it('404 when the pipeline has not uploaded the page yet', async () => {
    expect((await serveSite(new Request('https://x/c/'), b))?.status).toBe(404);
  });
  it('passes other paths and non-GET methods on', async () => {
    expect(await serveSite(new Request('https://x/login/'), b)).toBeNull();
    expect(await serveSite(new Request('https://x/', { method: 'POST' }), b)).toBeNull();
  });
});

describe('in-isolate cache of the pages', () => {
  it('reads the page and its policy together once, then answers from memory for a minute', async () => {
    const b = bucket({ 'site/index.html': '<p>x</p>', 'site/csp.txt': "script-src 'self'" });
    await serveSite(new Request('https://x/'), b);
    expect(b.reads.map(r => r.key).sort()).toEqual(['site/csp.txt', 'site/index.html']);
    const again = await serveSite(new Request('https://x/'), b);
    expect(await again?.text()).toBe('<p>x</p>');
    expect(again?.headers.get('content-security-policy')).toBe("script-src 'self'; frame-src 'self'");
    expect(b.reads).toHaveLength(2);
  });
  it('answers If-None-Match with a 304 from memory, and a stale copy is revalidated by etag', async () => {
    const b = bucket({ 'site/dash.json': '{"a":1}' });
    const first = await serveSite(new Request('https://x/dash.json'), b);
    const r = await serveSite(new Request('https://x/dash.json', { headers: { 'if-none-match': first!.headers.get('etag')! } }), b);
    expect(r?.status).toBe(304);
    expect(b.reads).toHaveLength(1);
    const later = await kept(b, 'site/dash.json', Date.now() + KEEP_MS + 1);
    expect(b.reads[1]?.onlyIf).toEqual({ etagDoesNotMatch: '"e"' });
    expect(new TextDecoder().decode(later!.bytes)).toBe('{"a":1}');
  });
  it('answers a copy under 10 minutes old at once and revalidates it after the response', async () => {
    const b = bucket({ 'site/dash.json': '{"a":1}' });
    await kept(b, 'site/dash.json');
    const later: Promise<unknown>[] = [];
    const k = await kept(b, 'site/dash.json', Date.now() + KEEP_MS + 1, p => later.push(p));
    expect(new TextDecoder().decode(k!.bytes)).toBe('{"a":1}');
    expect(later).toHaveLength(1);
    await Promise.all(later);
    expect(b.reads[1]?.onlyIf).toEqual({ etagDoesNotMatch: '"e"' });
    // Older than that: the visit waits for R2
    const old: Promise<unknown>[] = [];
    await kept(b, 'site/dash.json', Date.now() + STALE_MS + KEEP_MS + 1, p => old.push(p));
    expect(old).toHaveLength(0);
    expect(b.reads).toHaveLength(3);
  });
  it('the main dashboard starts dash.json with its headers; other pages do not', async () => {
    const b = bucket({ 'site/index.html': '<p>x</p>', 'site/c/index.html': '<p>c</p>', 'site/csp.txt': 'x' });
    expect((await serveSite(new Request('https://x/'), b))?.headers.get('link')).toBe('</dash.json>; rel=preload; as=fetch; crossorigin');
    expect((await serveSite(new Request('https://x/c/'), b))?.headers.get('link')).toBeNull();
  });
  it('many requests at once make one R2 read', async () => {
    const b = bucket({ 'site/c/index.html': '<p>c</p>', 'site/csp.txt': 'x' });
    await Promise.all([1, 2, 3].map(() => serveSite(new Request('https://x/c/'), b)));
    expect(b.reads.filter(r => r.key === 'site/c/index.html')).toHaveLength(1);
  });
});

describe('framable', () => {
  it('lets our own pages frame the dashboards and be framed by them', () => {
    const built = "default-src 'none'; script-src 'self' 'sha256-x'; frame-src https://www.tiktok.com https://www.instagram.com; frame-ancestors 'none'";
    expect(framable(built)).toBe("default-src 'none'; script-src 'self' 'sha256-x'; frame-src 'self' https://www.tiktok.com https://www.instagram.com; frame-ancestors 'self'");
  });
});

describe('metaCsp', () => {
  it('allows our frames and drops frame-ancestors (ignored in <meta>)', () => {
    expect(metaCsp("default-src 'none'; frame-src https://www.tiktok.com; frame-ancestors 'none'")).toBe("default-src 'none'; frame-src 'self' https://www.tiktok.com");
  });
});
