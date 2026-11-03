// Fetches mentions for one watch from the news (Google, else Bing), plus Reddit, YouTube, and X and TikTok through Grok when their keys exist,
// stores new ones (deduped by URL per company) and scores up to 20 unscored mentions (Grok when keyed, else Workers AI).
// Every outside call is I/O; parsing is regex/JSON on small bodies, to stay inside the free 10 ms CPU.
import { env as authEnv, sb, type AuthEnv, type Cfg } from '../../lib/auth';
import { type AiRun } from '../content/content';
import { generate, grokSearch, pick } from '../../lib/llm';
import {
  dedupe, due, parseBing, parseNews, parseReddit, parseSentiment, parseTikTok, parseX, parseYouTube, query, sentimentPrompt,
  terms, type Mention, type Watch,
} from './social';

export type ListenEnv = AuthEnv & {
  YOUTUBE_API_KEY?: string; XAI_API_KEY?: string; XAI_MODEL?: string; REDDIT_CLIENT_ID?: string; REDDIT_CLIENT_SECRET?: string; AI?: { run: AiRun };
};
const UA = 'well-ads-listening/1.0 (social listening for Well; contact via well-ads.pages.dev)';

// The answer, or why not ("error 403", "error network"): the page shows it next to the source
export async function get(f: typeof fetch, url: string, init?: RequestInit): Promise<Response | string> {
  try { const r = await f(url, { ...init, headers: { 'user-agent': UA, ...(init?.headers || {}) } }); return r.ok ? r : `error ${r.status}`; } catch { return 'error network'; }
}

// Reddit app-only token (client credentials). Reddit blocks anonymous searches from servers.
async function redditToken(f: typeof fetch, e: ListenEnv): Promise<string | null> {
  const r = await get(f, 'https://www.reddit.com/api/v1/access_token', {
    method: 'POST', body: 'grant_type=client_credentials',
    headers: { authorization: `Basic ${btoa(`${e.REDDIT_CLIENT_ID}:${e.REDDIT_CLIENT_SECRET}`)}`, 'content-type': 'application/x-www-form-urlencoded' },
  });
  if (typeof r === 'string') return null;
  const j = await r.json().catch(() => ({})) as { access_token?: string };
  return j.access_token || null;
}

// News terms per watch: the name and up to 4 keywords, each its own request on Google (and on Bing when Google gives nothing)
export const NEWS_TERMS = 5;
// Outside calls one watch can make: news 2 per term at worst, Reddit 2, YouTube 1, Grok 2, Grok sentiment 1, Supabase 4 (store)
export const cost = (w: Watch) => 2 * terms(w, NEWS_TERMS).length + 10;
// Workers allow 50 subrequests per request; 2 go to the session and the watch list, the rest is kept as margin
export const BUDGET = 45;
// "Refresh now": due watches in order while their calls fit the budget (the first always runs), at most 3
export function batch<T extends Watch>(list: T[], budget = BUDGET): T[] {
  const out: T[] = [];
  let used = 2;
  for (const w of list) {
    if (out.length === 3 || (out.length && used + cost(w) > budget)) break;
    out.push(w); used += cost(w);
  }
  return out;
}

// One watch: each source on its own; a failing source never stops the others. Returns what each source gave.
export async function collect(w: Watch & { id: number }, e: ListenEnv, f: typeof fetch = fetch): Promise<{ found: Mention[]; bySource: Record<string, number | string> }> {
  const q = query(w), found: Mention[] = [], bySource: Record<string, number | string> = {};
  const add = (src: string, list: Mention[]) => { bySource[src] = list.length; found.push(...list); };
  const jobs: Promise<void>[] = [];
  // News: Google News, one quoted term per request (an OR of rare terms gives 0 results there), then Bing News the same way.
  // Both answer from Cloudflare (Actions > listening-probe, 2026-11-03).
  jobs.push((async () => {
    const each = async (src: string, url: (t: string) => string, parse: (xml: string, id: number) => Mention[]) => {
      const list: Mention[] = [];
      let failed = '';
      for (const t of terms(w, NEWS_TERMS)) {
        const r = await get(f, url(t));
        if (typeof r === 'string') failed = r; else list.push(...parse(await r.text(), w.id));
      }
      bySource[src] = list.length || !failed ? list.length : failed;
      found.push(...list);
      return list.length;
    };
    const phrase = (t: string) => encodeURIComponent(/\s/.test(t) ? `"${t}"` : t);
    if (await each('google', t => `https://news.google.com/rss/search?q=${phrase(t)}&hl=ar&gl=SA&ceid=SA:ar`, parseNews)) return;
    await each('bing', t => `https://www.bing.com/news/search?q=${encodeURIComponent(t)}&format=rss&cc=SA`, parseBing);
  })());
  if (e.REDDIT_CLIENT_ID && e.REDDIT_CLIENT_SECRET) jobs.push((async () => {
    const token = await redditToken(f, e);
    if (!token) { bySource.reddit = 'error token'; return; }
    const r = await get(f, `https://oauth.reddit.com/search?q=${encodeURIComponent(q)}&sort=new&limit=25&raw_json=1`, { headers: { authorization: `Bearer ${token}` } });
    if (typeof r === 'string') bySource.reddit = r; else add('reddit', parseReddit(await r.json().catch(() => ({})), w.id));
  })());
  if (e.YOUTUBE_API_KEY) jobs.push((async () => {
    const u = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=date&maxResults=15&regionCode=SA&relevanceLanguage=ar&q=${encodeURIComponent(q)}&key=${encodeURIComponent(e.YOUTUBE_API_KEY!)}`;
    const r = await get(f, u);
    if (typeof r === 'string') bySource.youtube = r; else add('youtube', parseYouTube(await r.json().catch(() => ({})), w.id));
  })());
  // Grok (optional, PAID per use) with its live X search tool: lists the posts it found as JSON. parseX keeps x.com links only.
  if (e.XAI_API_KEY) jobs.push((async () => {
    const text = await grokSearch(e, [{ role: 'user', content: `ابحث في X (تويتر) عن آخر التغريدات اللي تذكر: ${q}. رد JSON فقط: [{"url":"https://x.com/...","text":"","author":"","date":"YYYY-MM-DD"}]` }], ['x'], 2000, f);
    if (text !== null) add('x', parseX(text, w.id)); else bySource.x = 'Grok ما رد';
  })());
  // TikTok has no open search API: Grok's web search over tiktok.com (same key, PAID per search). parseTikTok keeps tiktok.com links only.
  if (e.XAI_API_KEY) jobs.push((async () => {
    const text = await grokSearch(e, [{ role: 'user', content: `ابحث في tiktok.com عن آخر الفيديوهات اللي تذكر: ${q}. رد JSON فقط: [{"url":"https://www.tiktok.com/@.../video/...","text":"وصف الفيديو","author":"","date":"YYYY-MM-DD"}]` }], ['web'], 2000, f);
    if (text !== null) add('tiktok', parseTikTok(text, w.id)); else bySource.tiktok = 'Grok ما رد';
  })());
  await Promise.all(jobs);
  return { found: dedupe(found), bySource };
}

// Store new mentions, then score the unscored ones of this company (one AI call, at most 20)
export async function store(cfg: Cfg, co: string, w: Watch & { id: number }, found: Mention[], e: ListenEnv): Promise<{ added: number; scored: number }> {
  let added = 0, scored = 0;
  if (found.length) {
    const ins = await sb<Mention[]>(cfg, '/rest/v1/listen_mentions?on_conflict=company_id,url', {
      method: 'POST', admin: true, headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: found.map(m => ({ ...m, company_id: co })),
    });
    added = ins.ok && Array.isArray(ins.data) ? ins.data.length : 0;
  }
  // Sentiment: Grok when XAI_API_KEY is set, else Workers AI (src/lib/llm.ts)
  if (pick(e, 'listening')) {
    const todo = await sb<(Mention & { id: number })[]>(cfg, `/rest/v1/listen_mentions?select=id,watch_id,source,url,title,snippet,author,published_at&company_id=eq.${co}&sentiment=is.null&order=published_at.desc.nullslast&limit=20`, { admin: true });
    const list = todo.ok && Array.isArray(todo.data) ? todo.data : [];
    if (list.length) {
      try {
        const out = await generate(e, 'listening', { messages: [{ role: 'user', content: sentimentPrompt(list, [w.name]) }], max_tokens: 900 });
        const got = parseSentiment(out.response, list.length);
        const rows = list.map((m, i) => got[i] ? { ...m, company_id: co, sentiment: got[i]!.s, reason: got[i]!.r } : null).filter(Boolean);
        if (rows.length) {
          const up = await sb(cfg, '/rest/v1/listen_mentions?on_conflict=company_id,url', { method: 'POST', admin: true, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: rows });
          if (up.ok) scored = rows.length;
        }
      } catch { /* AI busy: retried next run */ }
    }
  }
  await sb(cfg, `/rest/v1/listen_watch?id=eq.${w.id}&company_id=eq.${co}`, { method: 'PATCH', admin: true, body: { fetched_at: new Date().toISOString() } });
  return { added, scored };
}

// Cron (every 5 minutes): the one watch that has waited longest, if it is due. Cheap: about 6 outside calls.
export async function runListening(e: ListenEnv, now = Date.now(), f: typeof fetch = fetch): Promise<number> {
  let cfg: Cfg;
  try { cfg = authEnv(e); } catch { return 0; }
  const r = await sb<(Watch & { id: number; company_id: string })[]>(cfg, '/rest/v1/listen_watch?select=*&order=fetched_at.asc.nullsfirst&limit=1', { admin: true });
  const w = r.ok && Array.isArray(r.data) ? r.data[0] : undefined; // table missing or empty: nothing to do
  if (!w || !due(w, now)) return 0;
  const { found } = await collect(w, e, f);
  return (await store(cfg, w.company_id, w, found, e)).added;
}
