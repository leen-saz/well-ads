// Content agent: page facts, fixed SEO/AEO rules, the AI plan with a stubbed model, and safe site URLs.
import { describe, expect, it, vi } from 'vitest';
import { audit, crawl, facts, normalizeSite, parsePlan, plan } from '../../src/lib/content';

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
});
