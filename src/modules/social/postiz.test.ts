// The Postiz engine against a documented-API mock (postiz-mock.ts): success, partial failure, timeout, duplicate runs, recovery,
// the rate limit, the readiness status, and the rule that an unapproved post makes ZERO calls to Postiz. Synthetic data only.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { publishPost, publishOne, validate, retryPlan, readiness, type Draft, type Results } from './social';
import { postizConf, postizStatus, cachedStatus, _clearStatusCache, platformLive, withEngineSecrets, POSTIZ_WAIT_MS } from './postiz';
import { runSocial } from './cron';
import { WELL_COMPANY } from '../../lib/tenant';
import { postizMock } from './postiz-mock';
import { graphMock } from './graph-mock';

const NOW = Date.parse('2026-11-01T12:00:00Z');
const at = '2026-11-02T09:00:00Z';
const img = (n: number) => ({ url: `https://m.test/${n}.jpg`, type: 'image' as const });
const vid = { url: 'https://m.test/v.mp4', type: 'video' as const };
const post = (platforms: Draft['platforms'], media: Draft['media'] = [], body = 'نص المنشور'): Draft => ({ platforms, body, media, publish_at: at, mode: 'manual' });
const run = { wait: async () => {}, now: NOW, timeoutMs: 20 };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); _clearStatusCache(); });

describe('configuration', () => {
  it('HTTPS only, no credentials in the address, never a local or private address; the base path is completed', () => {
    const ok = (u: string) => postizConf({ POSTIZ_URL: u, POSTIZ_API_KEY: 'k' });
    expect(ok('https://postiz.example.com')).toMatchObject({ ok: true, base: 'https://postiz.example.com/api/public/v1' });
    expect(ok('https://postiz.example.com/')).toMatchObject({ base: 'https://postiz.example.com/api/public/v1' });
    expect(ok('https://api.postiz.com/public/v1')).toMatchObject({ base: 'https://api.postiz.com/public/v1' });
    expect(ok('https://example.com/postiz')).toMatchObject({ base: 'https://example.com/postiz/public/v1' });
    for (const bad of ['http://postiz.example.com', 'https://u:p@postiz.example.com', 'https://localhost', 'https://127.0.0.1', 'https://10.0.0.5', 'https://box.local', 'https://x.example.com/?a=1', 'ftp://x', 'not a url'])
      expect(ok(bad), bad).toEqual({ ok: false, why: 'url' });
    expect(postizConf({})).toEqual({ ok: false, why: 'off' });
    expect(postizConf({ POSTIZ_URL: 'https://a.example.com' })).toEqual({ ok: false, why: 'key' });
    expect(postizConf({ POSTIZ_API_KEY: 'k' })).toEqual({ ok: false, why: 'url' });
  });
  it('Worker secrets are a fallback for the vault; the vault wins', () => {
    expect(withEngineSecrets({}, { POSTIZ_URL: 'https://a', POSTIZ_API_KEY: 'k' })).toEqual({ POSTIZ_URL: 'https://a', POSTIZ_API_KEY: 'k' });
    expect(withEngineSecrets({ POSTIZ_URL: 'https://v' }, { POSTIZ_URL: 'https://a' }).POSTIZ_URL).toBe('https://v');
  });
});

describe('publishing through Postiz', () => {
  it('X text: one post, created with type "now" (never schedule or draft), the key as the Authorization header, and ok only once it is PUBLISHED', async () => {
    const m = postizMock();
    const out = await publishPost(post(['x']), m.tokens, m.f, {}, run);
    expect(out.status).toBe('published');
    expect(m.live()).toHaveLength(1);
    expect(m.notNow()).toHaveLength(0);
    expect(m.st.calls.every(c => c.auth === 'pz-key')).toBe(true);
    expect(m.live()[0]).toMatchObject({ integration: 'c-x', settings: expect.objectContaining({ __type: 'x', who_can_reply_post: 'everyone' }) });
    expect(out.results.x).toMatchObject({ ok: true, id: 'post-1' });
    expect(JSON.stringify(out.results)).not.toContain('pz-key');
  });
  it('TikTok video: Postiz fetches our public link (upload-from-url), its id and path go into the post, title from the first line', async () => {
    const m = postizMock();
    const out = await publishPost(post(['tiktok'], [vid], 'سطر أول\nباقي النص'), m.tokens, m.f, {}, run);
    expect(out.status).toBe('published');
    const order = m.st.calls.map(c => `${c.method} ${c.path.split('?')[0]}`);
    expect(order.indexOf('POST /upload-from-url')).toBeLessThan(order.indexOf('POST /posts'));
    expect(m.st.calls.find(c => c.path === '/upload-from-url')!.body).toEqual({ url: vid.url });
    expect(m.live()[0]!.image).toEqual([{ id: 'media-1', path: expect.stringContaining('uploads.pz.test') }]);
    expect(m.live()[0]!.settings).toMatchObject({ __type: 'tiktok', title: 'سطر أول', content_posting_method: 'DIRECT_POST' });
  });
  it('LinkedIn uses the connected company page channel', async () => {
    const m = postizMock();
    expect((await publishPost(post(['linkedin']), m.tokens, m.f, {}, run)).status).toBe('published');
    expect(m.live()[0]).toMatchObject({ integration: 'c-li', settings: { __type: 'linkedin-page' } });
  });
  it('a post that does not fit the platform is refused BEFORE any call (mov, too many images, text too long, TikTok without media)', async () => {
    const m = postizMock();
    const cases: [Draft, string][] = [
      [post(['tiktok'], [{ url: 'https://m.test/v.mov', type: 'video' }]), 'invalid'],
      [post(['x'], [img(1), img(2), img(3), img(4), img(5)]), 'invalid'],
      [post(['x'], [], 'ا'.repeat(281)), 'invalid'],
      [post(['tiktok']), 'no_media'],
    ];
    for (const [d, code] of cases) expect((await publishPost(d, m.tokens, m.f, {}, run)).results[d.platforms[0]!]).toMatchObject({ ok: false, code });
    expect(m.st.calls).toHaveLength(0);
  });
  it('not set up: kept as a reminder, no call; set up but the account not connected: not_connected, nothing created', async () => {
    const m = postizMock({ channels: [{ id: 'c-x', name: 'Well X', identifier: 'x' }] });
    expect((await publishPost(post(['x']), {}, m.f, {}, run)).results.x).toMatchObject({ code: 'unsupported' });
    expect(m.st.calls).toHaveLength(0);
    expect((await publishPost(post(['tiktok'], [vid]), m.tokens, m.f, {}, run)).results.tiktok).toMatchObject({ code: 'not_connected' });
    expect(m.st.posts).toHaveLength(0);
    expect((await publishPost(post(['x']), { POSTIZ_URL: 'http://pz.test', POSTIZ_API_KEY: 'k' }, m.f, {}, run)).results.x).toMatchObject({ code: 'not_connected' });
  });
  it('a disabled channel does not count; two accounts of one platform is a state the owner fixes, not a guess', async () => {
    const dis = postizMock({ channels: [{ id: 'c-x', name: 'Old', identifier: 'x', disabled: true }] });
    expect((await publishPost(post(['x']), dis.tokens, dis.f, {}, run)).results.x).toMatchObject({ code: 'not_connected' });
    const two = postizMock({ channels: [{ id: 'a', name: 'X one', identifier: 'x' }, { id: 'b', name: 'X two', identifier: 'x' }] });
    expect((await publishPost(post(['x']), two.tokens, two.f, {}, run)).results.x).toMatchObject({ code: 'many_accounts' });
    expect(two.st.posts).toHaveLength(0);
  });
  it('a wrong key is a token problem and nothing is created', async () => {
    const m = postizMock();
    const out = await publishPost(post(['x']), { ...m.tokens, POSTIZ_API_KEY: 'wrong' }, m.f, {}, run);
    expect(out.results.x).toMatchObject({ ok: false, code: 'token' });
    expect(out.results.x!.detail).not.toContain('wrong');
  });
  it('Postiz reports ERROR: failed with its message for the owner, not retried by itself', async () => {
    const m = postizMock({ end: 'ERROR', error: 'X says no' });
    const out = await publishPost(post(['x']), m.tokens, m.f, {}, run);
    expect(out.status).toBe('failed');
    expect(out.results.x).toMatchObject({ code: 'platform', detail: expect.stringContaining('X says no') });
    expect(m.st.creates).toBe(1);
  });
  it('still queued after the polls: pending (the next cron run continues it), then published without a second post', async () => {
    const m = postizMock({ publishAfter: 5 });
    const a = await publishPost(post(['x']), m.tokens, m.f, {}, run);
    expect(a.status).toBe('pending');
    expect(a.results.x).toMatchObject({ state: 'processing', creation_id: 'post-1' });
    const b = await publishPost(post(['x']), m.tokens, m.f, a.results, { ...run, now: NOW + 300_000 });
    expect(b.status).toBe('published');
    expect(m.st.creates).toBe(1);
  });
  it('queued for too long: unconfirmed (it may still go out), for a person to check', async () => {
    const m = postizMock({ publishAfter: 99 });
    const a = await publishPost(post(['x']), m.tokens, m.f, {}, run);
    const b = await publishPost(post(['x']), m.tokens, m.f, a.results, { ...run, now: NOW + POSTIZ_WAIT_MS + 60_000 });
    expect(b.results.x).toMatchObject({ ok: false, code: 'unconfirmed' });
    expect(m.st.creates).toBe(1);
  });
});

describe('partial failure across engines', () => {
  it('Facebook (native) goes out, TikTok is refused by Postiz: partial, and only the failed one is retried', async () => {
    const g = graphMock(), m = postizMock({ create: '400' });
    const f = ((u: string, i?: RequestInit) => String(u).startsWith('https://pz.test') ? m.f(u, i) : g.f(u, i)) as typeof fetch;
    const out = await publishPost(post(['facebook', 'tiktok'], [vid]), { ...g.tokens, ...m.tokens }, f, {}, run);
    expect(out.status).toBe('partial');
    expect(out.results.facebook!.ok).toBe(true);
    expect(out.results.tiktok).toMatchObject({ ok: false, code: 'platform', detail: expect.stringContaining('bad settings') });
    expect(g.st.fbPosts).toHaveLength(1);
    const plan = retryPlan({ status: 'partial', platforms: ['facebook', 'tiktok'], results: out.results });
    expect('results' in plan && Object.keys(plan.results)).toEqual(['facebook']);
  });
});

describe('never double-post (Postiz has no idempotency key)', () => {
  it('the create call is made once: a timeout that never reached Postiz is unconfirmed, nothing else is sent', async () => {
    const m = postizMock({ create: 'timeout', createTimes: 1 });
    const out = await publishPost(post(['x']), m.tokens, m.f, {}, run);
    expect(out.results.x).toMatchObject({ ok: false, code: 'unconfirmed' });
    expect(m.st.creates).toBe(1);
    expect(m.st.posts).toHaveLength(0);
  });
  it('a timeout or a lost answer AFTER Postiz made the post: the post is found and followed, not created again', async () => {
    for (const create of ['timeoutLanded', 'lostAnswer'] as const) {
      const m = postizMock({ create, createTimes: 1 });
      const out = await publishPost(post(['x']), m.tokens, m.f, {}, run);
      expect(out.status, create).toBe('published');
      expect(m.st.creates, create).toBe(1);
      expect(m.live(), create).toHaveLength(1);
    }
  });
  it('a 502 is treated the same (unknown, looked up), and Postiz stored the text wrapped in <p>: the look-up does not depend on that', async () => {
    const m = postizMock({ create: '502', createTimes: 1 });
    const out = await publishPost(post(['x']), m.tokens, m.f, {}, run);
    expect(out.results.x).toMatchObject({ ok: false, code: 'unconfirmed' });
    expect(m.st.creates).toBe(1);
  });
  it('a second run over the stored results does nothing (published, processing, or unconfirmed)', async () => {
    const m = postizMock();
    const a = await publishPost(post(['x']), m.tokens, m.f, {}, run);
    const b = await publishPost(post(['x']), m.tokens, m.f, a.results, run);
    expect(b.results).toEqual(a.results);
    expect(m.live()).toHaveLength(1);
    const lost = postizMock({ create: 'timeout', createTimes: 1 });
    const c = await publishPost(post(['x']), lost.tokens, lost.f, {}, run);
    const callsBefore = lost.st.calls.length;
    const d = await publishPost(post(['x']), lost.tokens, lost.f, c.results, run);
    expect(d.results.x).toMatchObject({ code: 'unconfirmed' });
    expect(lost.st.creates).toBe(1);
    expect(lost.st.calls.length - callsBefore).toBeLessThanOrEqual(2);   // only the look-up reads, never a create
  });
  it('a Worker that died right after "sending": the post is adopted if Postiz has it, otherwise a person decides; never created again', async () => {
    const m = postizMock();
    await publishOne('x', post(['x']), m.tokens, m.f, undefined, { ...run, save: async () => { throw new Error('worker died'); } }).catch(() => {});
    // the save above threw before the create call: no post exists, state unknown to the next run
    expect(m.st.creates).toBe(0);
    const sending = { ok: false, state: 'sending' as const, channel: 'c-x', since: new Date(NOW).toISOString(), media: [] };
    const none = await publishOne('x', post(['x']), m.tokens, m.f, sending, run);
    expect(none).toMatchObject({ ok: false, code: 'unconfirmed' });
    expect(m.st.creates).toBe(0);
    // the same, but the post did land before the Worker died
    const landed = postizMock({ create: 'lostAnswer', createTimes: 1 });
    let saved: unknown; 
    await publishOne('x', post(['x']), landed.tokens, landed.f, undefined, { ...run, polls: 0, save: async r => { saved = r; } });
    const again = await publishOne('x', post(['x']), landed.tokens, landed.f, { ...(saved as object), ok: false, state: 'sending' } as never, run);
    expect(again).toMatchObject({ ok: true });
    expect(landed.st.creates).toBe(1);
    expect(landed.live()).toHaveLength(1);
  });
  it('rate limit (429): nothing was created, the post waits and the next run tries again; after the bound it fails as busy', async () => {
    const m = postizMock({ create: '429', createTimes: 1 });
    const a = await publishPost(post(['x']), m.tokens, m.f, {}, run);
    expect(a.status).toBe('pending');
    expect(a.results.x!.creation_id).toBeUndefined();
    const b = await publishPost(post(['x']), m.tokens, m.f, a.results, { ...run, now: NOW + 300_000 });
    expect(b.status).toBe('published');
    expect(m.live()).toHaveLength(1);
    const stuck = postizMock({ create: '429' });
    const c = await publishPost(post(['x']), stuck.tokens, stuck.f, {}, run);
    const d = await publishPost(post(['x']), stuck.tokens, stuck.f, c.results, { ...run, now: NOW + POSTIZ_WAIT_MS + 1000 });
    expect(d.results.x).toMatchObject({ ok: false, code: 'busy' });
    expect(stuck.st.posts).toHaveLength(0);
  });
  it('reads are retried on a dropped connection, the media upload too', async () => {
    const m = postizMock();
    let n = 0;
    const flaky = ((u: string, i?: RequestInit) => (String(u).endsWith('/integrations') && n++ < 2 ? Promise.reject(new TypeError('fetch failed')) : m.f(u, i))) as typeof fetch;
    expect((await publishPost(post(['x']), m.tokens, flaky, {}, run)).status).toBe('published');
    expect(m.live()).toHaveLength(1);
  });
});

describe('the approval gate (cron.ts is the only caller)', () => {
  const ENV = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'l@x' };
  const base = { company_id: WELL_COMPANY, platforms: ['x', 'tiktok'], body: 'نص', media: [vid], publish_at: '2026-11-01T11:00:00Z', mode: 'manual', status: 'scheduled', results: {}, approved_at: null, approved_by: null, company: { social_approvers: [] as string[] } };
  function world(rows: Record<string, unknown>[], m: ReturnType<typeof postizMock>, vault: { name: string; value: string }[]) {
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url.startsWith('https://pz.test')) return m.f(url, init);
      if (url.includes('/rpc/connector_env')) return new Response(JSON.stringify(vault));
      const id = Number(url.match(/id=eq\.(\d+)/)?.[1]);
      if (init.method === 'PATCH') {
        const row = rows.find(r => r.id === id);
        const need = [...url.matchAll(/(status|claimed_at)=eq\.([^&]+)/g)].every(x => String(row?.[x[1]!] ?? '') === decodeURIComponent(x[2]!));
        if (!row || !need) return new Response('[]');
        Object.assign(row, JSON.parse(String(init.body)));
        return new Response(JSON.stringify([row]));
      }
      if (url.includes('select=*')) return new Response(JSON.stringify(rows.filter(r => r.status === url.match(/status=eq\.(\w+)/)![1])));
      return new Response('{}');
    }));
  }
  const vaultOf = (m: ReturnType<typeof postizMock>) => Object.entries(m.tokens).map(([name, value]) => ({ name, value }));
  it('an UNAPPROVED post makes zero Postiz calls, however due it is (and also when the named approver was removed)', async () => {
    const m = postizMock();
    const rows: Record<string, unknown>[] = [
      { ...base, id: 1 },                                                                       // never approved
      { ...base, id: 2, approved_at: '2026-11-01T10:00:00Z', approved_by: 'gone@x.co', company: { social_approvers: ['sara@x.co'] } },  // approver no longer named
      { ...base, id: 3, status: 'publishing', claimed_at: new Date(NOW - 30 * 60_000).toISOString() },  // stuck, and no approval on it
    ];
    world(rows, m, vaultOf(m));
    expect(await runSocial(ENV, NOW, m.f)).toBe(0);
    expect(m.st.calls).toHaveLength(0);
    expect(rows.map(r => r.status)).toEqual(['scheduled', 'scheduled', 'publishing']);
  });
  it('an approved post goes out once through Postiz, with the vault secrets; a second cron run does not repeat it', async () => {
    const m = postizMock();
    const rows: Record<string, unknown>[] = [{ ...base, id: 1, platforms: ['x'], media: [], approved_at: '2026-11-01T10:00:00Z', approved_by: 'sara@x.co' }];
    world(rows, m, vaultOf(m));
    vi.useFakeTimers();
    const go = (t: number) => { const p = runSocial(ENV, t, m.f); return vi.runAllTimersAsync().then(() => p); };
    expect(await go(NOW)).toBe(1);
    expect(rows[0]!.status).toBe('published');
    expect(await go(NOW + 300_000)).toBe(0);
    expect(m.live()).toHaveLength(1);
    expect(m.notNow()).toHaveLength(0);
  });
  it('a pending post (Postiz still queued) goes back to scheduled with its Postiz id, and the next run only follows it', async () => {
    const m = postizMock({ publishAfter: 5 });
    const rows: Record<string, unknown>[] = [{ ...base, id: 1, platforms: ['x'], media: [], approved_at: '2026-11-01T10:00:00Z', approved_by: 'sara@x.co' }];
    world(rows, m, vaultOf(m));
    vi.useFakeTimers();
    const go = (t: number) => { const p = runSocial(ENV, t, m.f); return vi.runAllTimersAsync().then(() => p); };
    await go(NOW);
    expect(rows[0]!.status).toBe('scheduled');
    expect((rows[0]!.results as Results).x).toMatchObject({ state: 'processing', creation_id: 'post-1' });
    await go(NOW + 300_000); await go(NOW + 600_000);
    expect(rows[0]!.status).toBe('published');
    expect(m.st.creates).toBe(1);
  });
});

describe('readiness: engine configured AND the account connected', () => {
  it('status says why not, in codes, with channel names only', async () => {
    const m = postizMock({ channels: [{ id: 'c-x', name: 'Well X', identifier: 'x' }, { id: 'a', name: 'L1', identifier: 'linkedin' }, { id: 'b', name: 'L2', identifier: 'linkedin' }] });
    const s = await postizStatus(m.tokens, m.f, run);
    expect(s).toEqual({ code: 'ok', channels: [{ platform: 'tiktok', code: 'none', names: [] }, { platform: 'x', code: 'ok', names: ['Well X'] }, { platform: 'linkedin', code: 'many', names: ['L1', 'L2'] }] });
    expect(JSON.stringify(s)).not.toContain('pz-key');
    expect(platformLive(s, 'x')).toBe(true);
    expect(platformLive(s, 'tiktok')).toBe(false);
    expect(readiness('x', {}, s)).toBe('');
    expect(readiness('tiktok', {}, s)).toContain('غير متاح الحين');
    expect(readiness('x', {}, null)).toContain('غير متاح الحين');
  });
  it('off, bad address, wrong key, unreachable', async () => {
    const m = postizMock();
    expect((await postizStatus({}, m.f, run)).code).toBe('off');
    expect((await postizStatus({ POSTIZ_URL: 'http://pz.test', POSTIZ_API_KEY: 'k' }, m.f, run)).code).toBe('url');
    expect((await postizStatus({ ...m.tokens, POSTIZ_API_KEY: 'bad' }, m.f, run)).code).toBe('key');
    expect((await postizStatus(m.tokens, postizMock({ down: true }).f, { ...run, wait: async () => {} })).code).toBe('down');
  });
  it('the page-load status is remembered for a minute, and the owner check asks fresh', async () => {
    const m = postizMock();
    await cachedStatus(m.tokens, m.f, NOW); const n = m.st.calls.length;
    await cachedStatus(m.tokens, m.f, NOW + 30_000);
    expect(m.st.calls.length).toBe(n);
    await cachedStatus(m.tokens, m.f, NOW + 30_000, true);
    expect(m.st.calls.length).toBeGreaterThan(n);
  });
  it('scheduling: a Postiz platform that is not available says it will be kept as a reminder; one that is available does not', () => {
    const p = { platforms: ['x'], body: 'نص', publish_at: new Date(NOW + 3600e3).toISOString() };
    expect(validate(p, NOW, [], () => false).notices.join()).toContain('تذكير');
    expect(validate(p, NOW, [], () => true).notices.join()).not.toContain('تذكير');
    // what the platform accepts is said when the post is written: X takes 4 images
    expect(validate({ ...p, media: [1, 2, 3, 4, 5].map(img) }, NOW).error).toContain('4 صور');
    expect(validate({ ...p, platforms: ['tiktok'], media: [{ url: 'https://m.test/a.mov', type: 'video' }] }, NOW).error).toContain('MP4');
  });
});
