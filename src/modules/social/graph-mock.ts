// A stateful stand-in for the Graph API pieces the publisher uses, faithful where it matters: Instagram containers move
// IN_PROGRESS -> FINISHED (or ERROR), media_publish refuses a container that is not FINISHED (the defect this guards),
// a container publishes once, children of a carousel must exist, and errors come in Graph's {error:{message,code}} shape.
// It counts what really went live (fbPosts / igPosts), which is what the double-posting tests assert on.
export interface Opts {
  token?: string; page?: string; ig?: string; scopes?: string[]; expires?: number; pageName?: string; igLinked?: string | null;
  videoPolls?: number;                 // polls a video container stays IN_PROGRESS
  videoEnds?: 'FINISHED' | 'ERROR';
  failFinal?: (path: string) => 'network' | '500' | { code: number; message: string } | null;
}
type Json = Record<string, unknown>;
const err = (code: number, message: string, status = 400, sub?: number) => new Response(JSON.stringify({ error: { message, type: 'OAuthException', code, ...(sub ? { error_subcode: sub } : {}) } }), { status });
const ok = (b: Json) => new Response(JSON.stringify(b));

export function graphMock(o: Opts = {}) {
  const cfg = { token: 'tok', page: 'p1', ig: 'ig1', scopes: ['pages_manage_posts', 'instagram_content_publish', 'pages_show_list'], expires: 0, pageName: 'Well Care', igLinked: 'ig1', videoPolls: 2, videoEnds: 'FINISHED' as const, ...o };
  const st = {
    calls: [] as { method: string; path: string; params: Record<string, string> }[],
    fbPosts: [] as Json[], igPosts: [] as { creation_id: string; caption: string }[],
    containers: new Map<string, { kind: 'image' | 'video' | 'carousel' | 'item'; status: string; polls: number; children: string[]; caption: string }>(),
    n: 0,
  };
  const newId = (p: string) => `${p}${++st.n}`;
  const f = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/v[\d.]+\//, '');
    const method = (init.method || 'GET').toUpperCase();
    const params = Object.fromEntries(method === 'GET' ? url.searchParams : new URLSearchParams(String(init.body || '')));
    st.calls.push({ method, path, params });
    if (params.access_token !== cfg.token) return err(190, 'Error validating access token: Session has expired', 401);
    const [root, leaf] = path.split('/');
    if (method === 'GET') {
      if (path === 'debug_token') return ok({ data: { is_valid: true, scopes: cfg.scopes, expires_at: cfg.expires } });
      if (root === cfg.page) return ok({ id: cfg.page, name: cfg.pageName, ...(cfg.igLinked ? { instagram_business_account: { id: cfg.igLinked, username: 'well.care' } } : {}) });
      if (root === cfg.ig) return ok({ id: cfg.ig, username: 'well.care' });
      const c = st.containers.get(root!);
      if (!c) return err(100, 'Unsupported get request. Object does not exist', 400);
      if (c.status === 'IN_PROGRESS' && c.kind === 'video' && --c.polls <= 0) c.status = cfg.videoEnds;
      return ok({ id: root, status_code: c.status });
    }
    // The call that makes something appear can be made to fail
    const live = ['feed', 'photos', 'videos', 'media_publish'].includes(leaf!) && !(leaf === 'photos' && params.published === 'false');
    const inj = live ? cfg.failFinal?.(path) : null;
    if (inj === 'network') throw new TypeError('fetch failed');
    if (inj === '500') return new Response('<html>bad gateway</html>', { status: 502 });
    if (inj) return err(inj.code, inj.message);
    if (root === cfg.page) {
      if (leaf === 'feed') {
        const media = Object.keys(params).filter(k => k.startsWith('attached_media'));
        if (!params.message && !media.length) return err(100, 'The message or attached media is required');
        for (const k of media) if (!st.containers.has(`photo:${JSON.parse(params[k]!).media_fbid}`)) return err(100, 'Invalid media_fbid');
        const id = `${cfg.page}_${newId('post')}`;
        st.fbPosts.push({ id, kind: media.length ? 'multi' : 'text', message: params.message, media: media.length });
        return ok({ id });
      }
      if (leaf === 'photos') {
        const id = newId('photo');
        if (params.published === 'false') { st.containers.set(`photo:${id}`, { kind: 'item', status: 'UNPUBLISHED', polls: 0, children: [], caption: '' }); return ok({ id }); }
        st.fbPosts.push({ id, kind: 'photo', caption: params.caption, url: params.url });
        return ok({ id, post_id: `${cfg.page}_${id}` });
      }
      if (leaf === 'videos') {
        if (!params.file_url) return err(100, 'file_url is required');
        const id = newId('video');
        st.fbPosts.push({ id, kind: 'video', description: params.description });
        return ok({ id });
      }
    }
    if (root === cfg.ig) {
      if (leaf === 'media') {
        const id = newId('c');
        if (params.media_type === 'REELS') {
          if (!params.video_url) return err(100, 'video_url is required for REELS');
          st.containers.set(id, { kind: 'video', status: 'IN_PROGRESS', polls: cfg.videoPolls, children: [], caption: params.caption || '' });
        } else if (params.media_type === 'CAROUSEL') {
          const kids = (params.children || '').split(',').filter(Boolean);
          if (kids.length < 2 || kids.some(k => st.containers.get(k)?.kind !== 'item')) return err(100, 'Invalid carousel children', 400, 2207023);
          st.containers.set(id, { kind: 'carousel', status: 'FINISHED', polls: 0, children: kids, caption: params.caption || '' });
        } else {
          if (!params.image_url) return err(100, 'image_url is required');
          st.containers.set(id, { kind: params.is_carousel_item ? 'item' : 'image', status: 'FINISHED', polls: 0, children: [], caption: params.caption || '' });
        }
        return ok({ id });
      }
      if (leaf === 'media_publish') {
        const c = st.containers.get(params.creation_id || '');
        if (!c) return err(100, 'Invalid creation_id');
        if (c.status === 'PUBLISHED') return err(9007, 'The media is already published', 400, 2207020);
        if (c.status !== 'FINISHED') return err(9007, 'Media ID is not available', 400, 2207027); // not ready yet: what media_publish right after a video upload gets
        c.status = 'PUBLISHED';
        st.igPosts.push({ creation_id: params.creation_id!, caption: c.caption });
        return ok({ id: newId('igpost') });
      }
    }
    return err(100, `Unsupported post request: ${path}`);
  }) as unknown as typeof fetch;
  return { f, st, cfg, tokens: { META_PAGE_ACCESS_TOKEN: cfg.token, META_PAGE_ID: cfg.page, IG_USER_ID: cfg.ig } };
}
