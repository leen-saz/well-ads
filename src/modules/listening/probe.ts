// GET /api/listening/probe: which listening sources answer from Cloudflare's servers, without signing in.
// Needs the owner's session or, for the Actions workflow, the x-probe-secret header (PROBE_SECRET); anything else gets 401. Runs collect() for a sample watch with the free sources only
// (the paid Grok key is dropped), plus each news source on its own with a term that always has news,
// so "blocked" and "no results" read differently. Writes nothing; cached 10 minutes.
import { handle, json, requireUser } from '../../lib/auth';
import { collect, get, type ListenEnv } from './fetcher';
import { parseBing, parseGdelt, parseNews, type Watch } from './social';

// The brand watch «أضف الكلمات الأربع» creates, so the check shows what Well's own terms bring
export const SAMPLE: Watch & { id: number } = { id: 0, kind: 'brand', name: 'ويل يونيون', keywords: ['تطبيق ويل', 'wellunion', 'wellcare'] };
const CONTROL = 'الرياض';
const BROWSER = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' };

// Each news source alone: the count of items, or the refusal ("error 403")
export async function raw(f: typeof fetch = fetch): Promise<Record<string, number | string>> {
  const q = encodeURIComponent(CONTROL), out: Record<string, number | string> = {};
  const one = async (name: string, url: string, parse: (t: string) => unknown[], init?: RequestInit) => {
    const r = await get(f, url, init);
    out[name] = typeof r === 'string' ? r : parse(await r.text()).length;
  };
  await Promise.all([
    one('google', `https://news.google.com/rss/search?q=${q}&hl=ar&gl=SA&ceid=SA:ar`, t => parseNews(t, 0)),
    one('google_browser_ua', `https://news.google.com/rss/search?q=${q}&hl=ar&gl=SA&ceid=SA:ar`, t => parseNews(t, 0), { headers: BROWSER }),
    one('bing', `https://www.bing.com/news/search?q=${q}&format=rss&cc=SA`, t => parseBing(t, 0)),
    one('bing_browser_ua', `https://www.bing.com/news/search?q=${q}&format=rss&cc=SA`, t => parseBing(t, 0), { headers: BROWSER }),
    one('gdelt', `https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=artlist&format=json&maxrecords=25&sort=datedesc&timespan=7d`, t => parseGdelt(t, 0)),
    one('reddit_anonymous', `https://www.reddit.com/search.json?q=${q}&limit=5`, t => { try { return (JSON.parse(t)?.data?.children || []) as unknown[]; } catch { return []; } }),
  ]);
  return out;
}

// Constant-time comparison of two strings
const same = (a: string, b: string) => { let d = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return d === 0; };

export const probe = { GET: handle(async (request, e: ListenEnv & { PROBE_SECRET?: string }) => {
  // The shared secret opens the source counts only; which keys are configured stays for the owner's session
  const sent = request.headers.get('x-probe-secret') || '';
  const viaSecret = !!e.PROBE_SECRET && e.PROBE_SECRET.length >= 16 && same(sent, e.PROBE_SECRET);
  let owner = false;
  if (!viaSecret) { await requireUser(request, e, 'owner'); owner = true; }
  const cache = owner ? undefined : (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const key = new Request(new URL('/api/listening/probe', request.url).toString());
  const hit = await cache?.match(key);
  if (hit) return hit;
  const free = { ...e } as ListenEnv; delete free.XAI_API_KEY;
  const [sample, news] = await Promise.all([collect(SAMPLE, free), raw()]);
  const res = json(200, {
    at: new Date().toISOString(), sample: { terms: [SAMPLE.name, ...SAMPLE.keywords], bySource: sample.bySource, found: sample.found.length },
    control: { term: CONTROL, bySource: news },
    ...(owner ? { keys: { youtube: !!e.YOUTUBE_API_KEY, reddit: !!(e.REDDIT_CLIENT_ID && e.REDDIT_CLIENT_SECRET), x_grok: !!e.XAI_API_KEY, sentiment_ai: !!e.AI } } : {}),
  }, { 'cache-control': 'max-age=600' });
  await cache?.put(key, res.clone());
  return res;
}) };
