import { describe, expect, it } from 'vitest';
import { framable, metaCsp, serveSite, siteKey, siteRedirect } from '../../src/lib/site';

describe('siteKey', () => {
  it('maps dashboard paths to R2 keys', () => {
    expect(siteKey('/')).toBe('site/index.html');
    expect(siteKey('/c/')).toBe('site/c/index.html');
    expect(siteKey('/dept/iv/')).toBe('site/dept/iv/index.html');
    expect(siteKey('/control/ads.json')).toBe('site/control/ads.json');
    expect(siteKey('/thumbs/0123456789abcdef0123.jpg')).toBe('thumbs/0123456789abcdef0123.jpg');
  });
  it('refuses anything else, including traversal', () => {
    for (const p of ['/login/', '/thumbs/../site/csp.txt', '/thumbs/x.jpg', '/dept/../c/', '/site/index.html', '/api/health'])
      expect(siteKey(p)).toBeNull();
  });
});

describe('siteRedirect', () => {
  it('keeps the old Vercel redirects', () => {
    expect(siteRedirect('/organic')).toBe('/?mode=organic');
    expect(siteRedirect('/creative/')).toBe('/?view=creative');
    expect(siteRedirect('/')).toBeNull();
  });
});

function bucket(files: Record<string, string>): R2Bucket {
  return {
    async get(key: string) {
      if (!(key in files)) return null;
      const text = files[key] as string;
      return { body: new Response(text).body, httpEtag: '"e"', text: async () => text };
    },
  } as unknown as R2Bucket;
}

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
