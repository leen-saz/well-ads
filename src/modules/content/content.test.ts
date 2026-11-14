// Content agent: page facts, fixed SEO/AEO rules, the AI plan with a stubbed model, and safe site URLs.
import { describe, expect, it, vi } from 'vitest';
import { audit, crawl, facts, normalizeSite, parsePlan, plan } from './content';

const PAGE = `<html lang="ar"><head><title>رعاية منزلية في الرياض | Well</title><meta name="description" content="زيارات منزلية">
<link rel="canonical" href="https://x.sa/"><script type="application/ld+json">{"@type":"MedicalClinic"}</script></head>
<body><h1>رعاية منزلية</h1><p>${'كلمة '.repeat(300)}</p></body></html>`;

describe('content agent', () => {
  it('only allows public https sites', () => {
    expect(normalizeSite('wellcare.sa')).toBe('https://wellcare.sa');
    expect(normalizeSite('https://wellcare.sa/ar/page')).toBe('https://wellcare.sa');
    expect(normalizeSite('http://wellcare.sa')).toBeNull();
    expect(normalizeSite('https://localhost')).toBeNull();
    expect(normalizeSite('https://192.168.1.2')).toBeNull();
  });

  it('reads page facts', () => {
    const f = facts('https://x.sa/', 200, PAGE);
    expect(f).toMatchObject({ title: 'رعاية منزلية في الرياض | Well', description: 'زيارات منزلية', h1: ['رعاية منزلية'], schema: ['MedicalClinic'], faq: false, lang: 'ar', canonical: true });
    expect(f.words).toBeGreaterThan(300);
  });

  it('rules flag missing FAQ but not what is already there', () => {
    const titles = audit([facts('https://x.sa/', 200, PAGE)]).map(i => i.title);
    expect(titles.some(t => t.includes('أسئلة شائعة'))).toBe(true);
    expect(titles.some(t => t.includes('schema للمنشأة'))).toBe(false);
    const bad = audit([facts('https://x.sa/a', 404, ''), facts('https://x.sa/b', 200, '<h1>a</h1><h1>b</h1>')]).map(i => i.title);
    expect(bad[0]).toContain('ما تفتح');
    expect(bad.some(t => t.includes('H1'))).toBe(true);
  });

  it('crawls the sitemap on the same site only', async () => {
    const seen: string[] = [];
    const f = vi.fn(async (u: string) => {
      seen.push(u);
      if (u.endsWith('sitemap.xml')) return new Response('<urlset><url><loc>https://x.sa/a</loc></url><url><loc>https://evil.com/b</loc></url></urlset>');
      return new Response(PAGE);
    }) as unknown as typeof fetch;
    const pages = await crawl('https://x.sa', f);
    expect(pages.map(p => p.url)).toEqual(['https://x.sa/', 'https://x.sa/a']);
    expect(seen).not.toContain('https://evil.com/b');
  });

  it('the site address follows the same rules as the video brief: no private or internal-looking hosts', () => {
    for (const bad of ['https://172.16.0.5', 'https://172.31.255.1', 'https://0.0.0.0', 'https://[::1]', 'https://[fd00::1]', 'https://100.64.0.1', 'https://db.internal', 'https://printer.local',
      'https://x.sa:8443', 'https://user:pw@x.sa', 'https://169.254.169.254']) expect(normalizeSite(bad), bad).toBeNull();
    expect(normalizeSite('https://172.32.0.1')).toBe('https://172.32.0.1');   // just outside 172.16/12: a public address, as safe-fetch decides
    expect(normalizeSite('x.sa')).toBe('https://x.sa');
  });

  it('a redirect to an internal address is never followed, and redirects are re-checked at every hop (3 at most)', async () => {
    const seen: string[] = [];
    const f = vi.fn(async (u: string, init?: RequestInit) => {
      seen.push(u);
      expect(init?.redirect).toBe('manual');
      if (u === 'https://x.sa/') return new Response('', { status: 302, headers: { location: 'https://10.0.0.7/admin' } });
      if (u.endsWith('sitemap.xml')) return new Response('', { status: 301, headers: { location: 'https://x.sa/map2.xml' } });
      if (u.endsWith('map2.xml')) return new Response('<urlset><url><loc>https://x.sa/a</loc></url></urlset>');
      if (u === 'https://x.sa/a') return new Response('', { status: 302, headers: { location: 'https://x.sa/b' } });
      if (u === 'https://x.sa/b') return new Response(PAGE);
      return new Response('', { status: 404 });
    }) as unknown as typeof fetch;
    const pages = await crawl('https://x.sa', f);
    expect(seen).not.toContain('https://10.0.0.7/admin');
    expect(pages[0]).toMatchObject({ url: 'https://x.sa/', status: 0 });   // the home page redirected inside: reported as not opening, no fetch of the internal address
    expect(pages[1]).toMatchObject({ url: 'https://x.sa/a', status: 200 });   // an ordinary redirect (and the sitemap's) still works
    const loop = vi.fn(async () => new Response('', { status: 302, headers: { location: 'https://x.sa/again' } })) as unknown as typeof fetch;
    expect((await crawl('https://x.sa', loop))[0]).toMatchObject({ status: 0 });
    expect((loop as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(5 * 4);   // bounded, never an endless loop
  });

  it('builds the plan from the model, and falls back to rules', async () => {
    const pages = [facts('https://x.sa/', 200, PAGE)];
    const ai = vi.fn(async () => ({ response: 'هذا البلان: {"position":"رعاية منزلية","niche":"الرياض","items":[{"kind":"faq","title":"كم سعر زيارة الممرض؟","why":"بحث متكرر","priority":1},{"kind":"bad","title":"مقال","priority":9}]}' }));
    const p = await plan(ai, 'https://x.sa', '', ['منافس'], pages, []);
    expect(p.engine).toBe('workers-ai');
    expect(p.analysis).toMatchObject({ position: 'رعاية منزلية', niche: 'الرياض' });
    expect(p.items.filter(i => i.id.startsWith('a')).map(i => [i.kind, i.priority])).toEqual([['faq', 1], ['article', 2]]);
    expect((await plan(undefined, 'https://x.sa', '', [], pages, [])).engine).toBe('rules');
    expect((await plan(vi.fn(async () => { throw new Error('quota'); }), 'https://x.sa', '', [], pages, [])).engine).toBe('rules');
    expect(parsePlan('no json')).toBeNull();
  });

  it('reads a JSON-mode object answer, and retries once when the first answer has no items', async () => {
    const pages = [facts('https://x.sa/', 200, PAGE)];
    const obj = { response: { position: 'p', niche: 'n', items: [{ kind: 'faq', title: 'سؤال', why: 'w', priority: 1 }] } };
    expect((await plan(vi.fn(async () => obj), 'https://x.sa', '', [], pages, [])).items.some(i => i.title === 'سؤال')).toBe(true);
    const calls: unknown[] = [];
    const ai = vi.fn(async (_m: string, input: unknown) => { calls.push(input); return calls.length === 1 ? { response: 'سوري' } : obj; });
    const p = await plan(ai, 'https://x.sa', '', [], pages, []);
    expect(calls.length).toBe(2);
    expect((calls[0] as { response_format?: unknown }).response_format).toBeTruthy();
    expect(p.engine).toBe('workers-ai');
  });
});

describe('plan items say what they rest on', () => {
  it('marks an item as search only when its query came from Search Console', () => {
    const raw = JSON.stringify({ position: 'p', niche: 'n', items: [
      { kind: 'article', title: 'فيتامين سي بالوريد في البيت', why: 'w', priority: 1, query: 'فيتامين سي بالوريد' },
      { kind: 'faq', title: 'أسئلة الحمل', why: 'w', priority: 2, query: 'كلمة مخترعة' },
      { kind: 'page', title: 'صفحة', why: 'w', priority: 3 }] });
    const r = parsePlan(raw, [{ query: 'فيتامين سي بالوريد', clicks: 3, impressions: 90, position: 7 }])!;
    expect(r.items.map(i => i.basis)).toEqual(['search', 'idea', 'idea']);
    expect(r.items[0]!.query).toBe('فيتامين سي بالوريد');
  });
});
