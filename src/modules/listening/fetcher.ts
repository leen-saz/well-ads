// Fetches mentions for one watch from the free sources (plus YouTube and Grok when their keys exist),
// stores new ones (deduped by URL per company) and scores up to 20 unscored mentions with Workers AI.
// Every outside call is I/O; parsing is regex/JSON on small bodies, to stay inside the free 10 ms CPU.
import { env as authEnv, sb, type AuthEnv, type Cfg } from '../../lib/auth';
import { AI_MODEL, type AiRun } from '../content/content';
import {
  dedupe, due, parseNews, parseReddit, parseSentiment, parseX, parseYouTube, query, sentimentPrompt,
  type Mention, type Watch,
} from './social';

export type ListenEnv = AuthEnv & { YOUTUBE_API_KEY?: string; XAI_API_KEY?: string; XAI_MODEL?: string; AI?: { run: AiRun } };
const UA = 'well-ads-listening/1.0 (social listening for Well; contact via well-ads.pages.dev)';

async function get(f: typeof fetch, url: string, init?: RequestInit): Promise<Response | null> {
  try { const r = await f(url, { ...init, headers: { 'user-agent': UA, ...(init?.headers || {}) } }); return r.ok ? r : null; } catch { return null; }
}

// One watch: each source on its own; a failing source never stops the others. Returns what each source gave.
export async function collect(w: Watch & { id: number }, e: ListenEnv, f: typeof fetch = fetch): Promise<{ found: Mention[]; bySource: Record<string, number | string> }> {
  const q = query(w), found: Mention[] = [], bySource: Record<string, number | string> = {};
  const add = (src: string, list: Mention[]) => { bySource[src] = list.length; found.push(...list); };
  const jobs: Promise<void>[] = [];
  jobs.push((async () => {
    const r = await get(f, `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ar&gl=SA&ceid=SA:ar`);
    if (r) add('news', parseNews(await r.text(), w.id)); else bySource.news = 'error';
  })());
  jobs.push((async () => {
    const r = await get(f, `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=new&limit=25&raw_json=1`);
    if (r) add('reddit', parseReddit(await r.json().catch(() => ({})), w.id)); else bySource.reddit = 'error';
  })());
  if (e.YOUTUBE_API_KEY) jobs.push((async () => {
    const u = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&order=date&maxResults=15&regionCode=SA&relevanceLanguage=ar&q=${encodeURIComponent(q)}&key=${encodeURIComponent(e.YOUTUBE_API_KEY!)}`;
    const r = await get(f, u);
    if (r) add('youtube', parseYouTube(await r.json().catch(() => ({})), w.id)); else bySource.youtube = 'error';
  })());
  // Grok (optional, paid per use): asks it to search X and list the posts it found as JSON
  if (e.XAI_API_KEY) jobs.push((async () => {
    const r = await get(f, 'https://api.x.ai/v1/chat/completions', {
      method: 'POST', headers: { authorization: `Bearer ${e.XAI_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: e.XAI_MODEL || 'grok-4-fast', search_parameters: { mode: 'on', sources: [{ type: 'x' }], max_search_results: 15 },
        messages: [{ role: 'user', content: `ابحث في X (تويتر) عن آخر التغريدات اللي تذكر: ${q}. رد JSON فقط: [{"url":"https://x.com/...","text":"","author":"","date":"YYYY-MM-DD"}]` }],
      }),
    });
    const j = r ? await r.json().catch(() => ({})) as { choices?: { message?: { content?: string } }[] } : null;
    if (j) add('x', parseX(j.choices?.[0]?.message?.content || '', w.id)); else bySource.x = 'error';
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
  if (e.AI) {
    const todo = await sb<(Mention & { id: number })[]>(cfg, `/rest/v1/listen_mentions?select=id,watch_id,source,url,title,snippet,author,published_at&company_id=eq.${co}&sentiment=is.null&order=published_at.desc.nullslast&limit=20`, { admin: true });
    const list = todo.ok && Array.isArray(todo.data) ? todo.data : [];
    if (list.length) {
      try {
        const out = await e.AI.run(AI_MODEL, { messages: [{ role: 'user', content: sentimentPrompt(list, [w.name]) }], max_tokens: 900 });
        const got = parseSentiment(String((out as { response?: unknown })?.response ?? ''), list.length);
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
