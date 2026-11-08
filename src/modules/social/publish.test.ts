// Publishing paths against a stateful Graph mock (graph-mock.ts): Facebook text/photo/photos/video, Instagram photo/video/carousel,
// the wait for a video, double runs, recovery of a post that lost its Worker, the retry of failed platforms, and the dry-run check.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { publishPost, publishOne, retryPlan, checkConnection, validate, stale, VIDEO_WAIT_MS, type Draft, type Results } from './social';
import { runSocial } from './cron';
import { WELL_COMPANY } from '../../lib/tenant';
import { graphMock } from './graph-mock';

const NOW = Date.parse('2026-11-01T12:00:00Z');
const at = '2026-11-02T09:00:00Z';
const img = (n: number) => ({ url: `https://m.test/${n}.jpg`, type: 'image' as const });
const vid = { url: 'https://m.test/v.mp4', type: 'video' as const };
const post = (platforms: Draft['platforms'], media: Draft['media'] = [], body = 'نص المنشور'): Draft => ({ platforms, body, media, publish_at: at, mode: 'manual' });
const noWait = { wait: async () => {}, now: NOW };
afterEach(() => { vi.unstubAllGlobals(); });

describe('Facebook', () => {
  it('text goes to the feed', async () => {
    const g = graphMock();
    const out = await publishPost(post(['facebook']), g.tokens, g.f, {}, noWait);
    expect(out.status).toBe('published');
    expect(g.st.fbPosts).toHaveLength(1);
    expect(g.st.calls.map(c => c.path)).toEqual(['p1/feed']);
  });
  it('one photo goes to /photos with its caption', async () => {
    const g = graphMock();
    await publishPost(post(['facebook'], [img(1)]), g.tokens, g.f, {}, noWait);
    expect(g.st.fbPosts).toEqual([expect.objectContaining({ kind: 'photo', caption: 'نص المنشور' })]);
  });
  it('several photos become ONE post with attached_media (not only the first photo)', async () => {
    const g = graphMock();
    const out = await publishPost(post(['facebook'], [img(1), img(2), img(3)]), g.tokens, g.f, {}, noWait);
    expect(out.status).toBe('published');
    expect(g.st.fbPosts).toEqual([expect.objectContaining({ kind: 'multi', media: 3, message: 'نص المنشور' })]);
    expect(g.st.calls.filter(c => c.path === 'p1/photos').every(c => c.params.published === 'false')).toBe(true);
  });
  it('a video goes to the page videos endpoint (it used to post text only)', async () => {
    const g = graphMock();
    const out = await publishPost(post(['facebook'], [vid]), g.tokens, g.f, {}, noWait);
    expect(out.status).toBe('published');
    expect(g.st.fbPosts).toEqual([expect.objectContaining({ kind: 'video', description: 'نص المنشور' })]);
    expect(g.st.calls.some(c => c.path === 'p1/videos' && c.params.file_url === vid.url)).toBe(true);
  });
});

describe('Instagram', () => {
  it('a photo: container, publish, no wait', async () => {
    const g = graphMock();
    const out = await publishPost(post(['instagram'], [img(1)]), g.tokens, g.f, {}, noWait);
    expect(out.status).toBe('published');
    expect(g.st.calls.map(c => c.path)).toEqual(['ig1/media', 'ig1/media_publish']);
  });
  it('a video waits for FINISHED before it publishes (publishing at once is refused by Meta, as the mock does)', async () => {
    const g = graphMock({ videoPolls: 2 });
    const waits: number[] = [];
    const out = await publishPost(post(['instagram'], [vid]), g.tokens, g.f, {}, { now: NOW, wait: async ms => { waits.push(ms); } });
    expect(out.status).toBe('published');
    expect(waits.length).toBe(1);
    const paths = g.st.calls.map(c => c.path);
    expect(paths.slice(0, 1)).toEqual(['ig1/media']);
    expect(paths.filter(p => !p.startsWith('ig1')).length).toBe(2);          // two status polls
    expect(paths.at(-1)).toBe('ig1/media_publish');
    expect(g.st.igPosts).toHaveLength(1);
    expect(g.st.calls[0]!.params).toMatchObject({ media_type: 'REELS', video_url: vid.url });
  });
  it('a video that is still processing waits across runs: pending, then published by the next run, never twice', async () => {
    const g = graphMock({ videoPolls: 4 });
    const first = await publishPost(post(['instagram'], [vid]), g.tokens, g.f, {}, { ...noWait, polls: 2 });
    expect(first.status).toBe('pending');
    expect(first.results.instagram).toMatchObject({ ok: false, state: 'processing' });
    expect(g.st.igPosts).toHaveLength(0);
    const second = await publishPost(post(['instagram'], [vid]), g.tokens, g.f, first.results, { ...noWait, now: NOW + 5 * 60_000 });
    expect(second.status).toBe('published');
    expect(g.st.igPosts).toHaveLength(1);
    expect(g.st.calls.filter(c => c.path === 'ig1/media')).toHaveLength(1);      // the same container was continued
    const third = await publishPost(post(['instagram'], [vid]), g.tokens, g.f, second.results, noWait);
    expect(third.status).toBe('published');
    expect(g.st.igPosts).toHaveLength(1);
  });
  it('a video Instagram rejects ends as failed with the reason, not published', async () => {
    const g = graphMock({ videoEnds: 'ERROR' });
    const out = await publishPost(post(['instagram'], [vid]), g.tokens, g.f, {}, noWait);
    expect(out.status).toBe('failed');
    expect(out.results.instagram).toMatchObject({ ok: false, code: 'video_failed' });
    expect(g.st.igPosts).toHaveLength(0);
  });
  it('the wait is bounded: after 20 minutes it is a failure', async () => {
    const g = graphMock({ videoPolls: 99 });
    const first = await publishPost(post(['instagram'], [vid]), g.tokens, g.f, {}, { ...noWait, polls: 1 });
    const late = await publishPost(post(['instagram'], [vid]), g.tokens, g.f, first.results, { ...noWait, polls: 1, now: NOW + VIDEO_WAIT_MS + 1000 });
    expect(late.status).toBe('failed');
    expect(late.results.instagram).toMatchObject({ code: 'video_timeout' });
  });
  it('several photos become a carousel', async () => {
    const g = graphMock();
    const out = await publishPost(post(['instagram'], [img(1), img(2)]), g.tokens, g.f, {}, noWait);
    expect(out.status).toBe('published');
    expect(g.st.calls.filter(c => c.params.is_carousel_item === 'true')).toHaveLength(2);
    expect(g.st.calls.find(c => c.params.media_type === 'CAROUSEL')?.params.children!.split(',')).toHaveLength(2);
    expect(g.st.igPosts).toHaveLength(1);
  });
  it('needs media and a connected account', async () => {
    const g = graphMock();
    expect((await publishOne('instagram', post(['instagram']), g.tokens, g.f)).code).toBe('no_media');
    expect((await publishOne('instagram', post(['instagram'], [img(1)]), { META_PAGE_ACCESS_TOKEN: 't' }, g.f)).code).toBe('not_connected');
    expect(g.st.calls).toHaveLength(0);
  });
});

describe('errors in plain buckets', () => {
  it('an expired token, a missing permission and a rate limit each get their own code (with the platform text kept for the owner)', async () => {
    const bad = graphMock({ token: 'other' });
    expect((await publishOne('facebook', post(['facebook']), { ...bad.tokens, META_PAGE_ACCESS_TOKEN: 'old' }, bad.f))).toMatchObject({ ok: false, code: 'token', detail: expect.stringContaining('#190') });
    const perm = graphMock({ failFinal: () => ({ code: 200, message: '(#200) Requires pages_manage_posts permission' }) });
    expect((await publishOne('facebook', post(['facebook']), perm.tokens, perm.f)).code).toBe('permission');
    const busy = graphMock({ failFinal: () => ({ code: 4, message: 'Application request limit reached' }) });
    expect((await publishOne('facebook', post(['facebook']), busy.tokens, busy.f)).code).toBe('busy');
  });
  it('no answer from the call that posts is "unconfirmed", never a plain failure (it may be live)', async () => {
    const net = graphMock({ failFinal: () => 'network' });
    expect((await publishOne('facebook', post(['facebook']), net.tokens, net.f)).code).toBe('unconfirmed');
    const bad = graphMock({ failFinal: () => '500' });
    expect((await publishOne('facebook', post(['facebook']), bad.tokens, bad.f)).code).toBe('unconfirmed');
  });
  it('a failure before anything posts (container creation) is a plain failure', async () => {
    const g = graphMock();
    const f = (async (u: string, i: RequestInit) => { if (String(u).includes('ig1/media') && !String(u).includes('publish')) throw new TypeError('x'); return g.f(u, i); }) as unknown as typeof fetch;
    expect((await publishOne('instagram', post(['instagram'], [img(1)]), g.tokens, f)).code).toBe('network');
  });
});

describe('double runs and recovery', () => {
  it('running the same post twice posts once per platform', async () => {
    const g = graphMock();
    const p = post(['facebook', 'instagram'], [img(1)]);
    const a = await publishPost(p, g.tokens, g.f, {}, noWait);
    const b = await publishPost(p, g.tokens, g.f, a.results, noWait);
    expect(b.status).toBe('published');
    expect(g.st.fbPosts).toHaveLength(1);
    expect(g.st.igPosts).toHaveLength(1);
  });
  it('progress is saved before each step, so a crash leaves a trail', async () => {
    const g = graphMock();
    const trail: string[] = [];
    await publishPost(post(['instagram'], [img(1)]), g.tokens, g.f, {}, { ...noWait, save: async r => { trail.push(String(r.instagram?.state ?? (r.instagram?.ok ? 'ok' : '?'))); } });
    expect(trail).toContain('sending');
    expect(trail).toContain('processing');
    expect(trail).toContain('publishing');
    expect(trail.at(-1)).toBe('ok');
  });
  it('after a crash: what went out is kept, what may have gone out is unconfirmed (not repeated), what never started starts', async () => {
    const g = graphMock();
    const prev: Results = { facebook: { ok: false, state: 'sending' } };           // died inside the Facebook call
    const out = await publishPost(post(['facebook', 'instagram'], [img(1)]), g.tokens, g.f, prev, noWait);
    expect(out.results.facebook).toMatchObject({ ok: false, code: 'unconfirmed' });
    expect(g.st.fbPosts).toHaveLength(0);                                           // not posted again
    expect(out.results.instagram?.ok).toBe(true);                                   // no entry: safe to start
    expect(out.status).toBe('partial');
  });
  it('an Instagram publish that died after Meta accepted it is found PUBLISHED, not posted twice', async () => {
    const g = graphMock();
    const p = post(['instagram'], [img(1)]);
    // first run: publish happens, but the answer is lost before it is saved
    let lost = true;
    const first = await publishPost(p, g.tokens, g.f, {}, { ...noWait, save: async r => { if (lost && r.instagram?.ok) throw new Error('worker died'); } }).catch(() => null);
    lost = false;
    expect(first).toBeNull();
    expect(g.st.igPosts).toHaveLength(1);
    const cid = g.st.igPosts[0]!.creation_id;
    const out = await publishPost(p, g.tokens, g.f, { instagram: { ok: false, state: 'publishing', creation_id: cid, since: new Date(NOW).toISOString() } }, noWait);
    expect(out.status).toBe('published');
    expect(g.st.igPosts).toHaveLength(1);
  });
  it('stale: only a post publishing for over 15 minutes', () => {
    expect(stale({ status: 'publishing', claimed_at: new Date(NOW - 16 * 60_000).toISOString(), publish_at: at }, NOW)).toBe(true);
    expect(stale({ status: 'publishing', claimed_at: new Date(NOW - 5 * 60_000).toISOString(), publish_at: at }, NOW)).toBe(false);
    expect(stale({ status: 'publishing', claimed_at: null, publish_at: new Date(NOW - 3600e3).toISOString() }, NOW)).toBe(true);
    expect(stale({ status: 'scheduled', publish_at: '2020-01-01T00:00:00Z' }, NOW)).toBe(false);
  });
});

describe('retry of the failed platforms', () => {
  it('clears only the failed live platforms, once, never an ok one', () => {
    const base = { platforms: ['facebook', 'instagram', 'x'], retried_at: null, status: 'partial',
      results: { facebook: { ok: true, id: '1' }, instagram: { ok: false, code: 'token' }, x: { ok: false, code: 'unsupported' } } as Results };
    const plan = retryPlan(base);
    expect(plan).toEqual({ results: { facebook: { ok: true, id: '1' }, x: { ok: false, code: 'unsupported' } } });
    expect(retryPlan({ ...base, retried_at: '2026-11-01T00:00:00Z' })).toEqual({ error: 'retried' });
    expect(retryPlan({ ...base, status: 'published' })).toEqual({ error: 'not_failed' });
    expect(retryPlan({ ...base, results: { facebook: { ok: true }, instagram: { ok: true }, x: { ok: false, code: 'unsupported' } } })).toEqual({ error: 'nothing' });
  });
  it('the retry posts only where it failed: Facebook is not posted again', async () => {
    const g = graphMock();
    const p = post(['facebook', 'instagram'], [img(1)]);
    const broken = graphMock({ token: 'tok' });
    // first run: Instagram's account is not linked yet
    const first = await publishPost(p, { META_PAGE_ACCESS_TOKEN: 'tok', META_PAGE_ID: 'p1' }, g.f, {}, noWait);
    expect(first.status).toBe('partial');
    expect(first.results.instagram?.code).toBe('not_connected');
    const plan = retryPlan({ status: first.status, platforms: p.platforms, results: first.results, retried_at: null }) as { results: Results };
    const second = await publishPost(p, g.tokens, g.f, plan.results, noWait);
    expect(second.status).toBe('published');
    expect(g.st.fbPosts).toHaveLength(1);
    expect(g.st.igPosts).toHaveLength(1);
    expect(broken.st.calls).toHaveLength(0);
  });
});

describe('runSocial: claiming, pending videos, recovery', () => {
  const ENV = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'l@x' };
  const base = { company_id: WELL_COMPANY, platforms: ['instagram'], body: 'v', media: [vid], publish_at: '2026-11-01T11:00:00Z', mode: 'manual', approved_at: '2026-11-01T10:00:00Z', approved_by: 'sara@x.co', company: { social_approvers: ['sara@x.co'] } };
  // a tiny table: social_posts rows, claims honoured by the filters the cron sends
  function db(rows: Record<string, unknown>[]) {
    const patches: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url.includes('/rpc/connector_env')) return new Response(JSON.stringify([{ name: 'META_PAGE_ACCESS_TOKEN', value: 'tok' }, { name: 'META_PAGE_ID', value: 'p1' }, { name: 'IG_USER_ID', value: 'ig1' }]));
      const id = Number(url.match(/id=eq\.(\d+)/)?.[1]);
      if (init.method === 'PATCH') {
        const row = rows.find(r => r.id === id);
        const need = [...url.matchAll(/(status|claimed_at)=eq\.([^&]+)/g)].every(m => String(row?.[m[1]!] ?? '') === decodeURIComponent(m[2]!));
        const nullOk = !url.includes('claimed_at=is.null') || !row?.claimed_at;
        if (!row || !need || !nullOk) return new Response('[]');
        const body = JSON.parse(String(init.body));
        Object.assign(row, body); patches.push({ id, ...body });
        return new Response(JSON.stringify([row]));
      }
      if (url.includes('select=*')) {
        const status = url.match(/status=eq\.(\w+)/)![1];
        return new Response(JSON.stringify(rows.filter(r => r.status === status)));
      }
      return new Response('{}');
    }));
    return patches;
  }
  it('a video that is not ready goes back to scheduled with its container, and the next run publishes it once', async () => {
    const g = graphMock({ videoPolls: 4 });
    const rows: Record<string, unknown>[] = [{ ...base, id: 1, status: 'scheduled', results: {} }];
    db(rows);
    // cron polls 3 times per run (waits are real timers, so shrink them): use fake timers
    vi.useFakeTimers();
    const run = (t: number) => { const p = runSocial(ENV, t, g.f); return vi.runAllTimersAsync().then(() => p); };
    expect(await run(NOW)).toBe(1);
    expect(rows[0]!.status).toBe('scheduled');
    expect((rows[0]!.results as Results).instagram).toMatchObject({ state: 'processing' });
    expect(g.st.igPosts).toHaveLength(0);
    expect(await run(NOW + 300_000)).toBe(1);
    expect(rows[0]!.status).toBe('published');
    expect(g.st.igPosts).toHaveLength(1);
    expect(await run(NOW + 600_000)).toBe(0);                // nothing left to do: no second post
    expect(g.st.igPosts).toHaveLength(1);
    vi.useRealTimers();
  });
  it('a post stuck in publishing for over 15 minutes is finished from its stored results; a fresh one is left alone', async () => {
    const g = graphMock();
    const rows: Record<string, unknown>[] = [
      { ...base, id: 1, platforms: ['facebook', 'instagram'], media: [img(1)], status: 'publishing', claimed_at: new Date(NOW - 20 * 60_000).toISOString(),
        results: { facebook: { ok: true, id: 'p1_old' } } },
      { ...base, id: 2, platforms: ['facebook'], media: [], status: 'publishing', claimed_at: new Date(NOW - 2 * 60_000).toISOString(), results: {} },
      { ...base, id: 3, platforms: ['facebook'], media: [], status: 'publishing', claimed_at: new Date(NOW - 30 * 60_000).toISOString(), results: { facebook: { ok: false, state: 'sending' } } },
    ];
    db(rows);
    expect(await runSocial(ENV, NOW, g.f)).toBe(2);
    expect(rows[0]!.status).toBe('published');
    expect(g.st.fbPosts).toHaveLength(0);                    // Facebook had gone out: not repeated
    expect(g.st.igPosts).toHaveLength(1);                    // Instagram never started: now done
    expect(rows[1]!.status).toBe('publishing');              // recent: its Worker may still be alive
    expect(rows[2]!.status).toBe('failed');                  // the Facebook call may have gone out: unconfirmed, for a person to decide
    expect((rows[2]!.results as Results).facebook?.code).toBe('unconfirmed');
    expect(g.st.fbPosts).toHaveLength(0);
  });
  it('two overlapping runs recover a stuck post once', async () => {
    const g = graphMock();
    const rows: Record<string, unknown>[] = [{ ...base, id: 1, platforms: ['facebook'], media: [], status: 'publishing', claimed_at: new Date(NOW - 20 * 60_000).toISOString(), results: {} }];
    db(rows);
    const [a, b] = await Promise.all([runSocial(ENV, NOW, g.f), runSocial(ENV, NOW, g.f)]);
    expect(a + b).toBe(1);
    expect(g.st.fbPosts).toHaveLength(1);
  });
});

describe('dry-run connection check (posts nothing)', () => {
  const posts = (g: ReturnType<typeof graphMock>) => g.st.calls.filter(c => c.method === 'POST');
  it('ready: page name, Instagram name, both ok', async () => {
    const g = graphMock();
    const r = await checkConnection(g.tokens, g.f, NOW);
    expect(r).toMatchObject({ page: 'Well Care', instagram: 'well.care' });
    expect(r.checks).toEqual([{ platform: 'facebook', level: 'ok', code: 'fb_ok' }, { platform: 'instagram', level: 'ok', code: 'ig_ok' }]);
    expect(posts(g)).toHaveLength(0);
  });
  it('says which permission is missing', async () => {
    const g = graphMock({ scopes: ['pages_show_list'] });
    const r = await checkConnection(g.tokens, g.f, NOW);
    expect(r.checks.map(c => c.code)).toEqual(['fb_perm', 'ig_perm']);
    expect(r.checks.every(c => c.level === 'block')).toBe(true);
    expect(posts(g)).toHaveLength(0);
  });
  it('Instagram not linked to the page, or a different account than the saved one', async () => {
    const a = await checkConnection(graphMock({ igLinked: null }).tokens, graphMock({ igLinked: null }).f, NOW);
    expect(a.checks.find(c => c.platform === 'instagram')?.code).toBe('ig_not_linked');
    const g = graphMock({ igLinked: 'other' });
    expect((await checkConnection(g.tokens, g.f, NOW)).checks.find(c => c.platform === 'instagram')?.code).toBe('ig_mismatch');
    const none = graphMock();
    expect((await checkConnection({ META_PAGE_ACCESS_TOKEN: 'tok', META_PAGE_ID: 'p1' }, none.f, NOW)).checks.find(c => c.platform === 'instagram')?.code).toBe('ig_not_saved');
  });
  it('an expired token blocks both; no token says not connected; a token about to expire warns', async () => {
    const g = graphMock({ token: 'new' });
    expect((await checkConnection({ ...g.tokens, META_PAGE_ACCESS_TOKEN: 'old' }, g.f, NOW)).checks.map(c => c.code)).toEqual(['fb_token', 'ig_token']);
    expect((await checkConnection({}, g.f, NOW)).checks.map(c => c.code)).toEqual(['fb_not_connected', 'ig_not_connected']);
    const soon = graphMock({ expires: Math.floor(NOW / 1000) + 86400 });
    const r = await checkConnection(soon.tokens, soon.f, NOW);
    expect(r.checks[0]).toEqual({ platform: 'facebook', level: 'warn', code: 'fb_expiring' });
    expect(r.checks.some(c => c.level === 'block')).toBe(false);
  });
});

describe('what may be scheduled', () => {
  it('one video or photos, not both, and one video only', () => {
    const body = { platforms: ['facebook'], body: 'x', publish_at: at };
    expect(validate({ ...body, media: [vid, img(1)] }, NOW).error).toContain('فيديو واحد أو صور');
    expect(validate({ ...body, media: [vid, vid] }, NOW).error).toContain('فيديو واحد');
    expect(validate({ ...body, media: [img(1), img(2)] }, NOW).draft?.media).toHaveLength(2);
    expect(validate({ ...body, media: [vid] }, NOW).draft).toBeDefined();
  });
});
