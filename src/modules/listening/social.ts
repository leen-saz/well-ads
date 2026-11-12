// Social listening (الرصد): what people say about us and our competitors, by keyword, from free public sources,
// with a sentiment and a short Arabic reason for each mention. Pure functions here; fetching is in fetcher.ts.

export type Kind = 'brand' | 'competitor' | 'alert';
export type Sentiment = 'positive' | 'negative' | 'neutral';
export const KINDS: Kind[] = ['brand', 'competitor', 'alert'];

export interface Watch {
  id?: number; company_id?: string; kind: Kind; name: string; keywords: string[];
  links?: Record<string, string>; fetched_at?: string | null;
}
export interface Mention {
  id?: number; company_id?: string; watch_id: number; source: string; url: string; title: string; snippet: string;
  author: string; published_at: string | null; sentiment?: Sentiment | null; reason?: string | null;
}

// The tables this module needs. The page shows this SQL when they are missing.
export const SQL = `-- 013: Social listening (الرصد). Watch lists and the mentions found for them.
create table if not exists public.listen_watch (
  id bigserial primary key,
  company_id uuid not null references public.companies (id),
  kind text not null check (kind in ('brand', 'competitor', 'alert')),
  name text not null,
  keywords text[] not null default '{}',
  links jsonb not null default '{}',
  fetched_at timestamptz,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists listen_watch_company_idx on public.listen_watch (company_id);
create index if not exists listen_watch_due_idx on public.listen_watch (fetched_at nulls first);
alter table public.listen_watch enable row level security;
revoke all on public.listen_watch from anon, authenticated;

create table if not exists public.listen_mentions (
  id bigserial primary key,
  company_id uuid not null references public.companies (id),
  watch_id bigint not null references public.listen_watch (id) on delete cascade,
  source text not null,
  url text not null,
  title text not null default '',
  snippet text not null default '',
  author text not null default '',
  published_at timestamptz,
  sentiment text check (sentiment in ('positive', 'negative', 'neutral')),
  reason text,
  fetched_at timestamptz not null default now(),
  unique (company_id, url)
);
create index if not exists listen_mentions_company_at_idx on public.listen_mentions (company_id, published_at desc);
create index if not exists listen_mentions_unscored_idx on public.listen_mentions (company_id) where sentiment is null;
alter table public.listen_mentions enable row level security;
revoke all on public.listen_mentions from anon, authenticated;`;

const clip = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// A watch from the page: kind, a name, up to 8 keywords, and a few known links (handles, site, ad library)
const LINK_KEYS = ['instagram', 'tiktok', 'x', 'snapchat', 'website', 'adlibrary'];
export function cleanWatch(b: Record<string, unknown>): Watch | null {
  const kind = KINDS.includes(b.kind as Kind) ? (b.kind as Kind) : null;
  const name = clip(b.name, 60);
  if (!kind || !name) return null;
  const raw = Array.isArray(b.keywords) ? b.keywords : String(b.keywords || '').split(/[,،\n]/);
  const keywords = [...new Set(raw.map(k => clip(k, 40)).filter(Boolean))].slice(0, 8);
  const links: Record<string, string> = {};
  const l = (b.links || {}) as Record<string, unknown>;
  for (const k of LINK_KEYS) { const v = clip(l[k], 200); if (v) links[k] = v; }
  return { kind, name, keywords, links };
}

// One search string per watch: the name and its keywords, quoted, joined with OR (max 5 terms)
export function query(w: Watch): string {
  return [...new Set([w.name, ...(w.keywords || [])].map(t => t.trim()).filter(Boolean))].slice(0, 5).map(t => `"${t.replace(/"/g, '')}"`).join(' OR ');
}

// Same link, different tracking tags: one mention
export function normUrl(u: string): string {
  try {
    const x = new URL(u);
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|fbclid|gclid|si$|feature$)/i.test(k)) x.searchParams.delete(k);
    x.hash = '';
    return x.toString().replace(/\/$/, '');
  } catch { return ''; }
}

export function dedupe(list: Mention[]): Mention[] {
  const seen = new Set<string>(), out: Mention[] = [];
  for (const m of list) { const u = normUrl(m.url); if (!u || seen.has(u)) continue; seen.add(u); out.push({ ...m, url: u }); }
  return out;
}

const iso = (v: unknown): string | null => { const d = new Date(String(v ?? '')); return isNaN(+d) ? null : d.toISOString(); };
// Entities first, then tags: Google News puts escaped HTML inside <description>
const decode = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/<[^>]+>/g, ' ');
const tag = (xml: string, t: string) => decode((xml.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1] || '');

// Google News RSS: <item><title/><link/><pubDate/><source/><description/></item>. Regex, no XML parser (CPU budget).
// Only https links are kept: a feed can carry javascript:, data: or plain http links that must never reach a page or a click.
export const isHttps = (u: unknown): boolean => /^https:\/\//i.test(String(u ?? '').trim());

export function parseNews(xml: string, watchId: number): Mention[] {
  return (xml.match(/<item>[\s\S]*?<\/item>/g) || []).slice(0, 30).map(it => ({
    watch_id: watchId, source: 'news', url: tag(it, 'link').trim(), title: clip(tag(it, 'title'), 220),
    snippet: clip(tag(it, 'description'), 300), author: clip(tag(it, 'source'), 80), published_at: iso(tag(it, 'pubDate')),
  })).filter(m => isHttps(m.url));
}

// Bing News RSS, the fallback when Google News refuses the server. Bing takes one plain term per request (no OR, no quotes),
// and its <link> is a click link with the article in url=.
export function parseBing(xml: string, watchId: number): Mention[] {
  return (xml.match(/<item>[\s\S]*?<\/item>/g) || []).slice(0, 20).map(it => {
    const raw = tag(it, 'link').trim();
    let url = raw;
    try { url = new URL(raw).searchParams.get('url') || raw; } catch { /* kept as is, dropped below if not a link */ }
    return { watch_id: watchId, source: 'news', url, title: clip(tag(it, 'title'), 220), snippet: clip(tag(it, 'description'), 300),
      author: clip(tag(it, 'News:Source'), 80), published_at: iso(tag(it, 'pubDate')) };
  }).filter(m => isHttps(m.url) && !/^https?:\/\/(www\.)?bing\.com\//.test(m.url));
}

// GDELT DOC API (free, no key), read by the sources check only: it answers 429 to Cloudflare's shared servers.
// {"articles":[{url,title,seendate:"20261103T120000Z",domain}]}.
// On a bad query it answers plain text, which gives no mentions.
export function parseGdelt(body: string, watchId: number): Mention[] {
  let j: { articles?: Record<string, unknown>[] };
  try { j = JSON.parse(body); } catch { return []; }
  return (j.articles || []).slice(0, 50).filter(a => isHttps(a.url)).map(a => {
    const d = String(a.seendate || '').match(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/);
    return { watch_id: watchId, source: 'news', url: String(a.url), title: clip(a.title, 220), snippet: '', author: clip(a.domain, 80),
      published_at: d ? `${d[1]}-${d[2]}-${d[3]}T${d[4]}:${d[5]}:${d[6]}.000Z` : null };
  });
}

// The name and keywords as separate plain terms, for sources without OR (max 3: one request each)
export function terms(w: Watch, max = 3): string[] {
  return [...new Set([w.name, ...(w.keywords || [])].map(t => t.replace(/"/g, '').trim()).filter(Boolean))].slice(0, max);
}

// Is this mention really about the watch? News search matches the article body fuzzily, so a short brand name brings in world news and
// stocks. A mention is kept only when its title or snippet holds the name or one of the keywords as a word (Arabic: after dropping
// diacritics and unifying alef, yaa and taa marbuta, with prefixes allowed; Latin: whole word, and a name of 5 letters or fewer must
// keep its capital letter, so «well» in «as well as» does not count).
const arNorm = (s: string) => s.replace(/[\u064B-\u0652\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').toLowerCase();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function mentionsTerm(text: string, term: string): boolean {
  const t = term.replace(/"/g, '').trim();
  if (!t) return false;
  if (/[\u0600-\u06FF]/.test(t)) return arNorm(text).includes(arNorm(t));
  const word = (s: string, flags: string) => new RegExp(`(?<![\\p{L}\\p{N}])${esc(s)}(?![\\p{L}\\p{N}])`, flags).test(text);
  return t.length <= 5 ? word(t, 'u') || word(t.toUpperCase(), 'u') : word(t, 'iu');
}
export function relevant(m: Pick<Mention, 'title' | 'snippet'>, w: Watch): boolean {
  const text = `${m.title} ${m.snippet}`;
  return terms(w, 8).some(t => mentionsTerm(text, t));
}

// Reddit search JSON: data.children[].data
export function parseReddit(j: unknown, watchId: number): Mention[] {
  const kids = ((j as { data?: { children?: { data?: Record<string, unknown> }[] } })?.data?.children) || [];
  return kids.slice(0, 25).map(k => k.data || {}).filter(d => d.permalink).map(d => ({
    watch_id: watchId, source: 'reddit', url: `https://www.reddit.com${String(d.permalink)}`, title: clip(d.title, 220),
    snippet: clip(d.selftext, 300), author: clip(d.author, 80), published_at: d.created_utc ? new Date(Number(d.created_utc) * 1000).toISOString() : null,
  }));
}

// YouTube Data API search: items[].id.videoId + snippet
export function parseYouTube(j: unknown, watchId: number): Mention[] {
  const items = ((j as { items?: { id?: { videoId?: string }; snippet?: Record<string, unknown> }[] })?.items) || [];
  return items.filter(i => i.id?.videoId).slice(0, 20).map(i => ({
    watch_id: watchId, source: 'youtube', url: `https://www.youtube.com/watch?v=${i.id!.videoId}`, title: clip(i.snippet?.title, 220),
    snippet: clip(i.snippet?.description, 300), author: clip(i.snippet?.channelTitle, 80), published_at: iso(i.snippet?.publishedAt),
  }));
}

// Grok (optional, paid): the model answers with a JSON array of X posts it found
// Posts Grok found, as JSON. Only links on the source's own site are kept (a made-up or outside link is dropped).
function parseFound(content: string, watchId: number, source: 'x' | 'tiktok', site: RegExp): Mention[] {
  const m = String(content || '').match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    return (JSON.parse(m[0]) as Record<string, unknown>[]).slice(0, 20).filter(x => site.test(String(x.url || ''))).map(x => ({
      watch_id: watchId, source, url: String(x.url), title: clip(x.text, 220), snippet: '', author: clip(x.author, 80), published_at: iso(x.date),
    }));
  } catch { return []; }
}
export const parseX = (content: string, watchId: number) => parseFound(content, watchId, 'x', /^https:\/\/(x|twitter)\.com\//);
export const parseTikTok = (content: string, watchId: number) => parseFound(content, watchId, 'tiktok', /^https:\/\/(www\.|vm\.|m\.)?tiktok\.com\//);

// Sentiment: one AI call for up to 20 mentions; the model answers [{"i":0,"s":"negative","r":"سبب قصير"}]
export function sentimentPrompt(list: { title: string; snippet: string }[], subjects: string[]): string {
  return `صنّف شعور كل نص تجاه الجهة المذكورة (${subjects.join('، ') || 'الجهة'}): positive أو negative أو neutral، مع سبب قصير بالعربي (أقل من 10 كلمات).
النصوص:
${list.map((m, i) => `${i}. ${clip(`${m.title} ${m.snippet}`, 240)}`).join('\n')}
رد JSON فقط: [{"i":0,"s":"neutral","r":""}]`;
}

export function parseSentiment(raw: string, n: number): ({ s: Sentiment; r: string } | null)[] {
  const out: ({ s: Sentiment; r: string } | null)[] = Array(n).fill(null);
  const m = String(raw || '').match(/\[[\s\S]*\]/);
  if (!m) return out;
  try {
    for (const x of JSON.parse(m[0]) as { i?: unknown; s?: unknown; r?: unknown }[]) {
      const i = Number(x.i), s = String(x.s || '').toLowerCase();
      if (Number.isInteger(i) && i >= 0 && i < n && (s === 'positive' || s === 'negative' || s === 'neutral')) out[i] = { s, r: clip(x.r, 80) };
    }
  } catch { /* unparsable: the mentions stay unscored and are retried next run */ }
  return out;
}

// Meta Ad Library search for a competitor (Saudi Arabia, all ads). The API does not cover non-political ads here.
export function adLibraryUrl(name: string): string {
  return `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=SA&q=${encodeURIComponent(name)}&search_type=keyword_unordered`;
}

// A watch is due once a day at most
export const DAY_MS = 20 * 3600 * 1000;
export const due = (w: Watch, now = Date.now()) => !w.fetched_at || now - Date.parse(w.fetched_at) > DAY_MS;

export function sources(e: { YOUTUBE_API_KEY?: string; XAI_API_KEY?: string; REDDIT_CLIENT_ID?: string; REDDIT_CLIENT_SECRET?: string; AI?: unknown }) {
  // Reddit refuses anonymous searches from servers (403): it needs a free "script" app's id and secret
  return { news: true, reddit: !!(e.REDDIT_CLIENT_ID && e.REDDIT_CLIENT_SECRET), youtube: !!e.YOUTUBE_API_KEY, x: !!e.XAI_API_KEY, tiktok: !!e.XAI_API_KEY, sentiment: !!e.AI };
}

// PostgREST "relation does not exist": the migration has not been run yet
export const missingTable = (r: { ok: boolean; status: number; data: unknown }) =>
  !r.ok && (r.status === 404 || String((r.data as { code?: string })?.code || '') === '42P01' || /does not exist|schema cache/i.test(String((r.data as { message?: string })?.message || '')));
