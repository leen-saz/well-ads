// A stateful stand-in for the parts of the Postiz public API the engine uses (docs.postiz.com/public-api), faithful where it matters:
//  - Authorization header = the key exactly (no "Bearer"), else 401; base path /api/public/v1; https only.
//  - POST /posts validates the body like the docs say: type in now|schedule|draft, date, shortLink, tags, posts[].integration.id,
//    value[].content, settings.__type equal to the channel's identifier, and the required settings of TikTok and X.
//    It has NO idempotency: the same request twice creates two posts (which is what the double-posting tests count).
//  - POST /upload-from-url takes {url} (https) and answers {id, path, status}; only the formats the docs list (mov is refused).
//  - A post made with type "now" starts as QUEUE and becomes PUBLISHED after `publishAfter` reads of GET /posts (or ERROR).
//  - Content is stored the way the editor does (wrapped in <p>), so a look-up must not depend on the exact text.
//  - Failure injection for the create call: answer lost after the post was made ('lostAnswer'), or never reached ('lostBefore'),
//    a timeout (the request hangs until it is aborted), 429, 400, 502.
// The unverified parts (see docs/social-engine.md) are marked there; this mock follows the documentation, not a live server.
export interface PzOpts {
  key?: string; base?: string;
  channels?: { id: string; name: string; identifier: string; disabled?: boolean }[];
  publishAfter?: number;                       // reads of GET /posts before a QUEUE post reports its end state
  end?: 'PUBLISHED' | 'ERROR'; error?: string;
  create?: 'lostAnswer' | 'lostBefore' | 'timeout' | 'timeoutLanded' | '429' | '400' | '502' | null;
  createTimes?: number;                         // the injected failure applies to this many create calls (default: all)
  down?: boolean;                               // everything unreachable
}
type J = Record<string, unknown>;
const res = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const FORMATS = /\.(jpe?g|png|gif|webp|avif|bmp|tiff?|mp4)(\?|$)/i;

export function postizMock(o: PzOpts = {}) {
  const cfg = { key: 'pz-key', base: 'https://pz.test/api/public/v1', publishAfter: 1, end: 'PUBLISHED' as const, error: 'rejected by the platform', create: null as PzOpts['create'], createTimes: Infinity, down: false,
    channels: [{ id: 'c-tt', name: 'Well TikTok', identifier: 'tiktok' }, { id: 'c-x', name: 'Well X', identifier: 'x' }, { id: 'c-li', name: 'Well LinkedIn', identifier: 'linkedin-page' }], ...o };
  const st = {
    calls: [] as { method: string; path: string; body?: J; auth: string | null }[],
    posts: [] as { id: string; integration: string; content: string; type: string; settings: J; image: unknown[]; created: number; reads: number; state: string; error: string | null }[],
    media: [] as { id: string; path: string; url: string }[],
    n: 0, creates: 0, clock: Date.now(),
  };
  const make = (b: J, p: J) => {
    const v = (p.value as J[])[0]!;
    const row = { id: `post-${++st.n}`, integration: (p.integration as J).id as string, content: `<p>${String(v.content)}</p>`, type: String(b.type), settings: p.settings as J, image: (v.image as unknown[]) || [], created: st.clock, reads: 0, state: b.type === 'draft' ? 'DRAFT' : 'QUEUE', error: null as string | null };
    st.posts.push(row); return row;
  };
  const check = (b: J): string | null => {
    if (!['now', 'schedule', 'draft'].includes(String(b.type))) return 'type must be now, schedule or draft';
    for (const k of ['date', 'shortLink', 'tags']) if (b[k] === undefined) return `${k} is required`;
    if (b.type !== 'draft' && !Array.isArray(b.posts)) return 'posts is required';
    for (const p of (b.posts as J[]) || []) {
      const ch = cfg.channels.find(c => c.id === (p.integration as J)?.id);
      if (!ch) return 'integration not found';
      const s = (p.settings || {}) as J;
      if (s.__type !== ch.identifier) return `settings.__type must be ${ch.identifier}`;
      const vals = p.value as J[];
      if (!Array.isArray(vals) || !vals.length || vals.some(x => typeof x.content !== 'string')) return 'value[].content is required';
      for (const im of vals.flatMap(x => (x.image as J[]) || [])) if (typeof im.id !== 'string' || typeof im.path !== 'string') return 'image needs id and path';
      if (ch.identifier === 'x' && !s.who_can_reply_post) return 'who_can_reply_post is required';
      if (ch.identifier === 'tiktok') {
        for (const k of ['privacy_level', 'duet', 'stitch', 'comment', 'autoAddMusic', 'brand_content_toggle', 'brand_organic_toggle', 'content_posting_method']) if (s[k] === undefined) return `${k} is required`;
        if (String(s.title || '').length > 90) return 'title max 90';
        if (!vals.some(x => ((x.image as unknown[]) || []).length)) return 'tiktok needs media';
      }
    }
    return null;
  };
  const f = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input)), method = (init.method || 'GET').toUpperCase();
    const headers = new Headers(init.headers), auth = headers.get('authorization');
    const body = init.body ? JSON.parse(String(init.body)) as J : undefined;
    const path = url.pathname.replace(new URL(cfg.base).pathname, '') + url.search;
    if (url.origin !== new URL(cfg.base).origin || !url.pathname.startsWith(new URL(cfg.base).pathname)) throw new TypeError('fetch failed');
    st.calls.push({ method, path, ...(body ? { body } : {}), auth });
    if (cfg.down) throw new TypeError('fetch failed');
    if (url.protocol !== 'https:') throw new TypeError('https only');
    if (auth !== cfg.key) return res({ message: 'Unauthorized' }, 401);
    const route = path.split('?')[0]!;
    if (method === 'GET' && route === '/is-connected') return res({ connected: true });
    if (method === 'GET' && route === '/integrations') return res(cfg.channels.map(c => ({ ...c, disabled: !!c.disabled, picture: '', profile: c.name.toLowerCase(), customer: null })));
    if (method === 'POST' && route === '/upload-from-url') {
      const u = String((body as J)?.url || '');
      if (!/^https:\/\//.test(u)) return res({ message: 'url must be https' }, 400);
      if (!FORMATS.test(u)) return res({ message: 'unsupported file type' }, 400);
      const m = { id: `media-${st.media.length + 1}`, path: `https://uploads.pz.test/${st.media.length + 1}${u.slice(u.lastIndexOf('.'))}`, url: u };
      st.media.push(m); return res({ id: m.id, name: 'f', path: m.path, status: 'ready' });
    }
    if (method === 'GET' && route === '/posts') {
      if (!url.searchParams.get('startDate') || !url.searchParams.get('endDate')) return res({ message: 'startDate and endDate are required' }, 400);
      return res({ posts: st.posts.map(p => {
        if (p.state === 'QUEUE' && ++p.reads > cfg.publishAfter) { p.state = cfg.end; p.error = cfg.end === 'ERROR' ? cfg.error : null; }
        return { id: p.id, content: p.content, settings: p.settings, publishDate: new Date(p.created).toISOString(), state: p.state, error: p.error, ...(p.state === 'PUBLISHED' ? { releaseURL: `https://x.test/${p.id}` } : {}), integration: { id: p.integration, providerIdentifier: 'x', name: 'n', picture: '' } };
      }) });
    }
    if (method === 'POST' && route === '/posts') {
      const bad = check(body as J);
      if (bad) return res({ message: bad }, 400);
      st.creates++;
      const inj = st.creates <= cfg.createTimes ? cfg.create : null;
      if (inj === '429') return res({ message: 'rate limit' }, 429);
      if (inj === '400') return res({ message: 'bad settings' }, 400);
      if (inj === 'lostBefore') throw new TypeError('fetch failed');
      if (inj === 'timeout' || inj === 'timeoutLanded') {
        if (inj === 'timeoutLanded') for (const p of (body!.posts as J[])) make(body!, p);
        return new Promise<Response>((_, rej) => { init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))); });
      }
      if (inj === '502') return new Response('<html>bad gateway</html>', { status: 502 });   // refused upstream: nothing was made
      const made = (body!.posts as J[]).map(p => ({ postId: make(body!, p).id, integration: (p.integration as J).id }));
      if (inj === 'lostAnswer') throw new TypeError('fetch failed');
      return res(made);
    }
    return res({ message: 'not found' }, 404);
  }) as typeof fetch;
  const tokens = { POSTIZ_URL: 'https://pz.test', POSTIZ_API_KEY: cfg.key };
  return { f, st, tokens, cfg,
    // what really went out through the immediate path (the only path the engine may use)
    live: () => st.posts.filter(p => p.type === 'now'), notNow: () => st.posts.filter(p => p.type !== 'now') };
}
