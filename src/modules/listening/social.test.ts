// Social listening: source parsing, dedupe, sentiment parsing, watch cleaning, the cron/refresh flow and scoping.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adLibraryUrl, cleanWatch, dedupe, due, missingTable, normUrl, parseBing, parseGdelt, parseNews, isHttps, parseReddit, parseSentiment, parseTikTok, parseX, parseYouTube, mentionsTerm, query, relevant, sentimentPrompt, sources, terms } from './social';
import { batch, collect, cost, store } from './fetcher';
import { raw } from './probe';
// The page's own maths (plain JS in public/)
import { summarize, filterMentions } from '../../../public/modules/listening/social.js';

afterEach(() => vi.unstubAllGlobals());

const RSS = `<rss><channel><item><title><![CDATA[ويل للرعاية المنزلية تطلق خدمة]]></title><link>https://news.example.com/a?utm_source=x</link>
<pubDate>Sun, 01 Nov 2026 10:00:00 GMT</pubDate><description>&lt;b&gt;خبر&lt;/b&gt; جديد</description><source url="https://s">صحيفة</source></item>
<item><title>بدون رابط</title></item></channel></rss>`;
// The same feed with the watch names in the text: collect() keeps only mentions that are about the watch
const RSS_ON = RSS.replace('جديد</description>', 'جديد عن ويل يونيون و Well و wellcare</description>');

describe('sources', () => {
  it('reads Google News RSS without an XML parser', () => {
    const m = parseNews(RSS, 7);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ watch_id: 7, source: 'news', title: 'ويل للرعاية المنزلية تطلق خدمة', author: 'صحيفة', snippet: 'خبر جديد' });
    expect(m[0]?.published_at).toBe('2026-11-01T10:00:00.000Z');
  });
  it('reads Reddit and YouTube search answers', () => {
    const r = parseReddit({ data: { children: [{ data: { permalink: '/r/saudi/x', title: 'تجربتي مع ويل', author: 'u1', created_utc: 1793527200, selftext: 'ممتازين' } }, { data: {} }] } }, 1);
    expect(r).toEqual([{ watch_id: 1, source: 'reddit', url: 'https://www.reddit.com/r/saudi/x', title: 'تجربتي مع ويل', snippet: 'ممتازين', author: 'u1', published_at: new Date(1793527200000).toISOString() }]);
    const y = parseYouTube({ items: [{ id: { videoId: 'abc' }, snippet: { title: 'فيديو', description: 'وصف', channelTitle: 'قناة', publishedAt: '2026-10-30T08:00:00Z' } }, { id: {} }] }, 2);
    expect(y).toHaveLength(1);
    expect(y[0]).toMatchObject({ url: 'https://www.youtube.com/watch?v=abc', author: 'قناة', source: 'youtube' });
    expect(parseReddit(null, 1)).toEqual([]);
    expect(parseYouTube('x', 1)).toEqual([]);
  });
  it('reads Bing News RSS and takes the article out of the click link', () => {
    const xml = `<rss><channel><item><title>ايفركير تنشر مراجعة</title><link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;url=https%3a%2f%2fnews.example.com%2fa&amp;mkt=ar-sa</link>
<description>نص الخبر</description><pubDate>Wed, 14 Oct 2026 14:37:25 GMT</pubDate><News:Source>صحيفة</News:Source></item>
<item><title>بحث</title><link>https://www.bing.com/news/search?q=x</link></item></channel></rss>`;
    expect(parseBing(xml, 4)).toEqual([{ watch_id: 4, source: 'news', url: 'https://news.example.com/a', title: 'ايفركير تنشر مراجعة', snippet: 'نص الخبر', author: 'صحيفة', published_at: '2026-10-14T14:37:25.000Z' }]);
    expect(terms({ kind: 'competitor', name: 'ايفر كير', keywords: ['"evercare"', 'ايفر كير', 'a', 'b'] })).toEqual(['ايفر كير', 'evercare', 'a']);
  });
  it('turns Reddit on only with its app keys', () => {
    expect(sources({}).reddit).toBe(false);
    expect(sources({ REDDIT_CLIENT_ID: 'a', REDDIT_CLIENT_SECRET: 'b' }).reddit).toBe(true);
  });
  it('keeps only real X links from Grok', () => {
    const x = parseX('هذي النتائج: [{"url":"https://x.com/a/status/1","text":"ويل ممتازة","author":"@a","date":"2026-11-01"},{"url":"https://evil.example/x"}]', 3);
    expect(x.map(m => m.url)).toEqual(['https://x.com/a/status/1']);
    expect(parseX('no json', 3)).toEqual([]);
  });
});

describe('dedupe and queries', () => {
  it('drops tracking tags and repeats', () => {
    expect(normUrl('https://a.com/p/?utm_source=x&id=2#top')).toBe('https://a.com/p/?id=2');
    const base = { watch_id: 1, source: 'news', title: '', snippet: '', author: '', published_at: null };
    expect(dedupe([{ ...base, url: 'https://a.com/x?utm_medium=y' }, { ...base, url: 'https://a.com/x' }, { ...base, url: 'not a url' }])).toHaveLength(1);
  });
  it('builds one OR query of at most five quoted terms', () => {
    expect(query({ kind: 'brand', name: 'Well', keywords: ['ويل', 'Well', 'رعاية "منزلية"', 'a', 'b', 'c'] })).toBe('"Well" OR "ويل" OR "رعاية منزلية" OR "a" OR "b"');
  });
  it('cleans a watch from the page', () => {
    expect(cleanWatch({ kind: 'competitor', name: ' منافس ', keywords: 'أ، ب,ب\nج', links: { instagram: '@x', bad: 'y' } }))
      .toEqual({ kind: 'competitor', name: 'منافس', keywords: ['أ', 'ب', 'ج'], links: { instagram: '@x' } });
    expect(cleanWatch({ kind: 'other', name: 'x' })).toBeNull();
    expect(cleanWatch({ kind: 'brand', name: '' })).toBeNull();
  });
  it('is due once a day at most', () => {
    const now = Date.parse('2026-11-02T12:00:00Z');
    expect(due({ kind: 'brand', name: 'x', keywords: [], fetched_at: null }, now)).toBe(true);
    expect(due({ kind: 'brand', name: 'x', keywords: [], fetched_at: '2026-11-02T06:00:00Z' }, now)).toBe(false);
    expect(due({ kind: 'brand', name: 'x', keywords: [], fetched_at: '2026-11-01T06:00:00Z' }, now)).toBe(true);
  });
  it('links competitors to the Saudi ad library and spots a missing table', () => {
    expect(adLibraryUrl('منافس')).toContain('country=SA');
    expect(missingTable({ ok: false, status: 404, data: { code: '42P01' } })).toBe(true);
    expect(missingTable({ ok: true, status: 200, data: [] })).toBe(false);
  });
});

describe('sentiment', () => {
  it('parses the model answer and ignores bad rows', () => {
    const got = parseSentiment('```json\n[{"i":0,"s":"Negative","r":"تأخر الموعد"},{"i":5,"s":"positive"},{"i":1,"s":"meh"}]\n```', 2);
    expect(got).toEqual([{ s: 'negative', r: 'تأخر الموعد' }, null]);
    expect(parseSentiment('nothing', 2)).toEqual([null, null]);
    expect(sentimentPrompt([{ title: 'a', snippet: 'b' }], ['Well'])).toContain('0. a b');
  });
});

describe('fetch flow', () => {
  const cfg = { url: 'https://sb.example', service: 'k', secret: 'x'.repeat(40), owner: 'o@x' };
  it('collects the news and skips the keyed sources without keys', async () => {
    const seen: string[] = [];
    const f = (async (u: string) => { seen.push(String(u));
      if (String(u).includes('news.google')) return new Response(RSS_ON, { status: 200 });
      return new Response('', { status: 500 }); }) as unknown as typeof fetch;
    const r = await collect({ id: 9, kind: 'brand', name: 'Well', keywords: [] }, {} as never, f);
    expect(r.bySource).toEqual({ google: 1 });
    expect(seen.some(u => /bing|reddit|youtube|x\.ai/.test(u))).toBe(false);
  });
  it('falls back to Bing, one term each, when Google refuses, and says why', async () => {
    const seen: string[] = [];
    const bing = (n: number) => `<rss><item><title>evercare t${n}</title><link>http://www.bing.com/news/apiclick.aspx?url=https%3a%2f%2fn.example%2f${n}</link></item></rss>`;
    let n = 0;
    const f = (async (u: string) => { seen.push(String(u));
      if (String(u).includes('news.google')) return new Response('', { status: 503 });
      if (String(u).includes('bing.com')) return new Response(bing(n++), { status: 200 });
      return new Response('', { status: 500 }); }) as unknown as typeof fetch;
    const r = await collect({ id: 9, kind: 'competitor', name: 'ايفر كير', keywords: ['evercare'] }, {} as never, f);
    expect(r.bySource).toEqual({ google: 'error 503', bing: 2 });
    expect(r.found.map(m => m.url)).toEqual(['https://n.example/0', 'https://n.example/1']);
    expect(seen.filter(u => u.includes('bing.com'))).toHaveLength(2);
  });
  it('asks Google one quoted term at a time and keeps what each gives', async () => {
    const seen: string[] = [];
    const f = (async (u: string) => { seen.push(decodeURIComponent(String(u)));
      if (String(u).includes('news.google')) return new Response(seen.length === 1 ? RSS_ON : '<rss></rss>', { status: 200 });
      return new Response('', { status: 500 }); }) as unknown as typeof fetch;
    const r = await collect({ id: 9, kind: 'brand', name: 'ويل يونيون', keywords: ['wellcare', 'تطبيق ويل', 'رابع'] }, {} as never, f);
    expect(r.bySource).toEqual({ google: 1 });
    expect(seen.map(u => u.match(/q=([^&]*)/)![1])).toEqual(['"ويل يونيون"', 'wellcare', '"تطبيق ويل"', 'رابع']);
  });
  it('searches every term of a 4-term brand watch, and Refresh keeps its calls under the Worker limit', async () => {
    const seen: string[] = [];
    const f = (async (u: string) => { seen.push(decodeURIComponent(String(u)));
      return new Response(String(u).includes('wellcare') ? RSS_ON : '<rss></rss>', { status: 200 }); }) as unknown as typeof fetch;
    const brand = { id: 1, kind: 'brand' as const, name: 'ويل يونيون', keywords: ['تطبيق ويل', 'wellunion', 'wellcare'] };
    const r = await collect(brand, {} as never, f);
    expect(seen.filter(u => u.includes('news.google')).map(u => u.match(/q=([^&]*)/)![1])).toEqual(['"ويل يونيون"', '"تطبيق ويل"', 'wellunion', 'wellcare']);
    expect(r.bySource).toEqual({ google: 1 });
    expect(cost(brand)).toBe(18);
    const big = (id: number) => ({ id, kind: 'competitor' as const, name: `c${id}`, keywords: ['a', 'b', 'c', 'd', 'e', 'f'] }); // 5 terms searched: 20 calls
    expect(batch([brand, big(2), big(3)]).map(w => w.id)).toEqual([1, 2]); // 2 + 18 + 20 = 40; a third would make 60
    expect(batch([brand, { ...brand, id: 2 }, { ...brand, id: 3 }]).map(w => w.id)).toEqual([1, 2]); // 2 + 54 > 45
    expect(batch([{ id: 4, kind: 'alert' as const, name: 'x', keywords: [] }, { id: 5, kind: 'alert' as const, name: 'y', keywords: [] }, { id: 6, kind: 'alert' as const, name: 'z', keywords: [] }, { id: 7, kind: 'alert' as const, name: 'w', keywords: [] }]).map(w => w.id)).toEqual([4, 5, 6]);
    expect(batch([big(8)], 10).map(w => w.id)).toEqual([8]); // the first always runs
  });
  it('reads GDELT', () => {
    expect(parseGdelt('Your search contained a keyword that was too short', 1)).toEqual([]);
    expect(parseGdelt(JSON.stringify({ articles: [{ url: 'javascript:x' }, { url: 'https://a/1', title: 't' }] }), 1)).toHaveLength(1);
  });
  it('probes each news source alone and keeps refusals apart from empty answers', async () => {
    const f = (async (u: string) => {
      if (String(u).includes('bing.com')) return new Response('<rss><item><title>a</title><link>https://n.example/1</link></item></rss>', { status: 200 });
      if (String(u).includes('gdeltproject')) return new Response('{"articles":[]}', { status: 200 });
      return new Response('', { status: 403 }); }) as unknown as typeof fetch;
    expect(await raw(f)).toEqual({ google: 'error 403', google_browser_ua: 'error 403', bing: 1, bing_browser_ua: 1, gdelt: 0, reddit_anonymous: 'error 403' });
  });
  it('searches Reddit with an app token when the keys exist', async () => {
    const seen: { u: string; auth: string }[] = [];
    const f = (async (u: string, init?: RequestInit) => { seen.push({ u: String(u), auth: String((init?.headers as Record<string, string>)?.authorization || '') });
      if (String(u).includes('access_token')) return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 });
      if (String(u).includes('oauth.reddit.com')) return new Response(JSON.stringify({ data: { children: [{ data: { permalink: '/r/x/1', title: 'Well a' } }] } }), { status: 200 });
      if (String(u).includes('news.google')) return new Response(RSS_ON, { status: 200 });
      return new Response('', { status: 500 }); }) as unknown as typeof fetch;
    const r = await collect({ id: 9, kind: 'brand', name: 'Well', keywords: [] }, { REDDIT_CLIENT_ID: 'id', REDDIT_CLIENT_SECRET: 'sec' } as never, f);
    expect(r.bySource).toEqual({ google: 1, reddit: 1 });
    expect(seen.find(s => s.u.includes('access_token'))!.auth).toBe(`Basic ${btoa('id:sec')}`);
    expect(seen.find(s => s.u.includes('oauth.reddit.com'))!.auth).toBe('Bearer tok');
  });
  it('stores mentions with the company id and scores them in one call', async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(String(init.body)) : null });
      if (url.includes('sentiment=is.null')) return new Response(JSON.stringify([{ id: 1, watch_id: 9, source: 'news', url: 'https://n/1', title: 't', snippet: '', author: '', published_at: null }]), { status: 200 });
      return new Response(JSON.stringify([{ id: 1 }]), { status: 201 });
    });
    const ai = { run: async () => ({ response: '[{"i":0,"s":"positive","r":"مدح الخدمة"}]' }) };
    const co = '00000000-0000-0000-0000-000000000002';
    const s = await store(cfg, co, { id: 9, kind: 'brand', name: 'Well', keywords: [] }, [{ watch_id: 9, source: 'news', url: 'https://n/1', title: 't', snippet: '', author: '', published_at: null }], { AI: ai } as never);
    expect(s).toEqual({ added: 1, scored: 1 });
    const ins = calls[0]!;
    expect((ins.body as { company_id: string }[])[0]?.company_id).toBe(co);
    expect(calls.some(c => c.url.includes('sentiment=is.null') && c.url.includes(`company_id=eq.${co}`))).toBe(true);
    const up = calls.find(c => c.method === 'POST' && Array.isArray(c.body) && (c.body as { sentiment?: string }[])[0]?.sentiment);
    expect((up!.body as { sentiment: string; reason: string }[])[0]).toMatchObject({ sentiment: 'positive', reason: 'مدح الخدمة' });
    expect(calls.at(-1)!.url).toContain(`listen_watch?id=eq.9&company_id=eq.${co}`);
  });
});

describe('page maths', () => {
  const now = Date.parse('2026-11-02T12:00:00Z'), d = (n: number) => new Date(now - n * 864e5).toISOString();
  const W = [{ id: 1, kind: 'brand', name: 'Well' }, { id: 2, kind: 'competitor', name: 'منافس' }, { id: 3, kind: 'alert', name: 'شكوى' }];
  const M = [
    ...Array.from({ length: 6 }, (_, i) => ({ watch_id: 1, published_at: d(1 + (i % 5)), sentiment: i < 3 ? 'negative' : 'positive' })),
    ...Array.from({ length: 4 }, () => ({ watch_id: 1, published_at: d(10), sentiment: 'positive' })),
    { watch_id: 2, published_at: d(2), sentiment: 'neutral' }, { watch_id: 3, published_at: d(1), sentiment: null },
  ];
  it('splits share of voice, weeks and alerts', () => {
    const s = summarize(W, M, now, 30);
    expect(s.share.map((r: { name: string; total: number }) => [r.name, r.total])).toEqual([['Well', 10], ['منافس', 1]]);
    expect(s.share[0]?.share).toBeCloseTo(10 / 11);
    expect(s.weeks).toHaveLength(5); // 30 days: five bars of a week, the last one shorter
    expect(s.alerts.map((a: { type: string }) => a.type).sort()).toEqual(['keyword', 'negative']);
  });
  it('says when the sample is small', () => {
    expect(summarize(W, M, now, 30).sample).toEqual({ total: 11, small: true, min: 30 });
    const big = Array.from({ length: 30 }, () => ({ watch_id: 1, published_at: d(2), sentiment: 'positive' }));
    expect(summarize(W, big, now, 30).sample.small).toBe(false);
  });
  it('filters mentions', () => {
    expect(filterMentions(M, { sentiment: 'negative' })).toHaveLength(3);
    expect(filterMentions(M, { watch: 2 })).toHaveLength(1);
  });
});

describe('parseTikTok', () => {
  it('keeps tiktok.com links only', () => {
    const raw = 'نتائج: [{"url":"https://www.tiktok.com/@well/video/1","text":"تجربة","author":"a","date":"2026-11-01"},{"url":"https://evil.example/x","text":"no"}]';
    const out = parseTikTok(raw, 7);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ source: 'tiktok', watch_id: 7, url: 'https://www.tiktok.com/@well/video/1' });
  });
});

describe('our brand and missing keys (page)', () => {
  it('suggests Well terms that are not watched yet and adds them in one request', async () => {
    const { brandSuggestions, brandAdd, missingKeys, WELL_TERMS } = await import('../../../public/modules/listening/social.js');
    const comp = { id: 1, kind: 'competitor', name: 'ايفر كير', keywords: [] };
    expect(brandSuggestions([comp])).toEqual(WELL_TERMS);
    expect(brandAdd([comp], WELL_TERMS)).toEqual({ kind: 'brand', name: 'ويل يونيون', keywords: ['تطبيق ويل', 'wellunion', 'wellcare'], links: {} });
    const brand = { id: 2, kind: 'brand', name: 'ويل يونيون', keywords: ['WellUnion'], links: { x: '@well' } };
    expect(brandSuggestions([comp, brand])).toEqual(['تطبيق ويل', 'wellcare']);
    expect(brandAdd([comp, brand], ['wellcare'])).toEqual({ id: 2, kind: 'brand', name: 'ويل يونيون', keywords: ['WellUnion', 'wellcare'], links: { x: '@well' } });
    expect(brandAdd([comp, brand], ['wellunion'])).toBeNull();
    expect(missingKeys({ news: true, youtube: true }).map(k => k.src)).toEqual(['x', 'reddit']);
  });
});

describe('listening: only https links are kept', () => {
  const item = (link: string) => `<item><title>t</title><link>${link}</link><description>d</description></item>`;
  it('news items with http, javascript or data links are dropped', () => {
    const xml = `<rss><channel>${item('https://news.example.com/a')}${item('http://news.example.com/b')}${item('javascript:alert(1)')}${item('data:text/html;base64,AAAA')}${item('//news.example.com/c')}${item('')}</channel></rss>`;
    expect(parseNews(xml, 1).map(m => m.url)).toEqual(['https://news.example.com/a']);
  });
  it('isHttps accepts only https', () => {
    expect(isHttps(' https://a.example/x ')).toBe(true);
    for (const u of ['http://a.example', 'javascript:x', 'JAVASCRIPT:x', 'ftp://a', '', null, undefined]) expect(isHttps(u)).toBe(false);
  });
  it('gdelt and bing drop plain http too', () => {
    expect(parseGdelt(JSON.stringify({ articles: [{ url: 'http://a.example/1', title: 't' }] }), 1)).toEqual([]);
  });
});

describe('only mentions about the watch are kept', () => {
  it('Arabic: diacritics, alef and taa marbuta forms, and attached prefixes', () => {
    expect(mentionsTerm('تعلن ويل للرعاية المنزلية عن خدمة', 'ويل')).toBe(true);
    expect(mentionsTerm('عيادة الرِّعايه', 'الرعاية')).toBe(true);
    expect(mentionsTerm('اتفاق سياسي دولي', 'ويل')).toBe(false);
  });
  it('Latin: whole words only, and a short name keeps its capital', () => {
    expect(mentionsTerm('Well Care launches a service', 'Well')).toBe(true);
    expect(mentionsTerm('WELL announces', 'Well')).toBe(true);
    expect(mentionsTerm('as well as stocks', 'Well')).toBe(false);
    expect(mentionsTerm('Wellington markets', 'Well')).toBe(false);
    expect(mentionsTerm('everything is wellcare', 'wellcare')).toBe(true);
    expect(mentionsTerm('x', '')).toBe(false);
  });
  it('relevant() looks at the title and the snippet for the name or any keyword', () => {
    const w = { kind: 'brand' as const, name: 'Well', keywords: ['ويل'] };
    expect(relevant({ title: 'أسهم وأخبار دولية', snippet: 'Stocks fell as well as bonds' }, w)).toBe(false);
    expect(relevant({ title: 'ويل تفتح فرع', snippet: '' }, w)).toBe(true);
    expect(relevant({ title: 'a', snippet: 'Well is hiring' }, w)).toBe(true);
  });
  it('collect drops off-topic news and says how many', async () => {
    const rss = (t: string) => `<rss><channel><item><title>${t}</title><link>https://n.example/${encodeURIComponent(t)}</link></item></channel></rss>`;
    const f = (async (u: string) => new Response(String(u).includes('news.google') ? rss(String(u).includes('%D9%88%D9%8A%D9%84') ? 'ويل تطلق خدمة' : 'Stocks rally as well as bonds') : '', { status: 200 })) as unknown as typeof fetch;
    const r = await collect({ id: 9, kind: 'brand', name: 'Well', keywords: ['ويل'] }, {} as never, f);
    expect(r.found.map(m => m.title)).toEqual(['ويل تطلق خدمة']);
    expect(r.dropped).toBe(1);
  });
});
