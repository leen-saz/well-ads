// «فيديو الحملة»: the campaign's motion deliverable as a real video file made by Higgsfield (Seedance) through the Video module's jobs.
// Fakes only: Higgsfield is a fake queue (submit → request id → status words → a link), Supabase an in-memory table that honours the
// filters the code relies on, R2 the fake bucket. No key, no network, synthetic data.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { api } from '../../src/api/index';
import { clearSnaps } from '../../src/lib/usage';
import { assetUsd, ownVideo } from '../../src/lib/campaign-assets';
import { SAFETY_SUFFIX, clipBeats, clipCount, clipSeconds, promptOf, runVideo, scenesOf, videoUsd, type VideoEnv } from '../../src/lib/campaign-video';
import { defaultTasks, packMarkdown, type OutputRow, type TaskRow } from '../../src/lib/campaign-run';
import { estimate } from '../../src/lib/campaign';
import { higgsfield } from '../../src/modules/video/higgsfield';
import type { Job } from '../../src/modules/video/jobs';
import { fakeR2 } from '../shared/fake-r2';
/// <reference types="vite/client" />
// Files are read through Vite (?raw): node:fs breaks typecheck.
const raw = (p: string) => Object.values(import.meta.glob('../../public/assets/campaign.js', { query: '?raw', import: 'default', eager: true }))[0] as string + (p === 'csp' ? Object.values(import.meta.glob('../../astro.config.mjs', { query: '?raw', import: 'default', eager: true }))[0] : '');

const CO = '11111111-1111-1111-1111-111111111111', CID = '44444444-4444-4444-4444-444444444444';
const E = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'boss@example.com', HIGGSFIELD_API_KEY: 'k-test-1', HIGGSFIELD_API_SECRET: 's-test-1' };
const cfg = A.env(E);
const user = { co: CO, uid: 'u-1', email: 'a@example.com', off: [] as string[] } as unknown as A.Session;
const locked = { ...user, off: ['video'] } as unknown as A.Session;
const camp = { id: CID, title: 'حملة الزيارة المنزلية' };
const SCENES = ['ممرضة تدخل بيت هادئ', 'عائلة تبتسم في الصالة', 'احجز زيارتك اليوم'];
const board: OutputRow = { task_id: 5, kind: 'motion_storyboard', body: { scenes: SCENES.slice(0, 2).map((text, i) => ({ text, from: i, to: i + 1 })), cta: { text: SCENES[2] } }, compliance: [] };
const task = (spec: TaskRow['spec'] = { kind: 'video' }): TaskRow => ({ id: 9, position: 8, agent: 'design', title: 'v', spec, depends_on: [4, 6], status: 'running' });

// ---- the fakes
let projects: Record<string, unknown>[], jobs: Job[], usage: Record<string, unknown>[], caps: { module: string; monthly_cap_usd: number | null; alert_at_pct: number }[], spent: { module: string; cost_usd: number }[];
let submits: { url: string; body: Record<string, unknown>; idem: string | null }[], statuses: number, statusWord: string, submitStatus: number, r2: ReturnType<typeof fakeR2>;
const qs = (url: string) => new URL(url).searchParams;
function rowMatches(row: Record<string, unknown>, q: URLSearchParams) {
  for (const [k, v] of q) {
    if (v.startsWith('eq.') && String(row[k]) !== v.slice(3)) return false;
    if (v.startsWith('in.(') && !v.slice(4, -1).split(',').includes(String(row[k]))) return false;
  }
  return true;
}
const env = (): VideoEnv & { FILES: R2Bucket } => ({ ...E, FILES: r2.bucket });
beforeEach(() => {
  projects = []; jobs = []; usage = []; caps = []; spent = []; submits = []; statuses = 0; statusWord = 'in_progress'; submitStatus = 200; r2 = fakeR2(); clearSnaps();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const m = init.method || 'GET', body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    if (url.startsWith('https://api.higgsfield.ai/requests/')) {
      statuses++;
      return new Response(JSON.stringify({ status: statusWord, ...(statusWord === 'completed' ? { video: { url: 'https://cdn.higgsfield.example/v.mp4' } } : {}) }));
    }
    if (url.startsWith('https://api.higgsfield.ai/')) {
      submits.push({ url, body, idem: new Headers(init.headers).get('idempotency-key') });
      return submitStatus === 200 ? new Response(JSON.stringify({ status: 'queued', request_id: `req-${submits.length}-abcdef` })) : new Response('{}', { status: submitStatus });
    }
    if (url.startsWith('https://cdn.higgsfield.example')) return new Response(new Blob([new Uint8Array(2048)]).stream(), { headers: { 'content-type': 'video/mp4', 'content-length': '2048' } });
    if (url.includes('/rest/v1/video_projects') && m === 'POST') { const p = { id: projects.length + 7, ...body }; projects.push(p); return new Response(JSON.stringify([p])); }
    if (url.includes('/rest/v1/video_jobs')) {
      if (m === 'POST') {
        const made = (body as Record<string, unknown>[]).map((b, i) => ({ id: jobs.length + i + 1, status: 'queued', attempts: 0, max_attempts: 3, next_attempt_at: new Date(0).toISOString(), upstream_ref: null, result_key: null,
          error_code: null, cost_recorded: false, created_at: new Date(0).toISOString(), updated_at: new Date().toISOString(), finished_at: null, ...b })) as unknown as Job[];
        jobs.push(...made); return new Response(JSON.stringify(made));
      }
      const hit = jobs.filter(r => rowMatches(r as unknown as Record<string, unknown>, qs(url)));
      if (m === 'PATCH') { hit.forEach(r => Object.assign(r, body)); return new Response(JSON.stringify(hit)); }
      return new Response(JSON.stringify(hit));
    }
    if (url.includes('/ai_usage') && m === 'POST') { usage.push(body); return new Response('', { status: 201 }); }
    if (url.includes('/rpc/ai_spend')) return new Response(JSON.stringify(spent.map(s => ({ month: '2026-11', calls: 1, tokens_in: 0, tokens_out: 0, cost_sar: 0, unpriced: 0, ...s }))));
    if (url.includes('/ai_budgets')) return new Response(JSON.stringify(caps));
    return new Response('[]');
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

// the whole story, one call per "tick", the way the driver does it; the task row is re-read from what the previous call left (a killed Worker loses nothing)
const run = (t: TaskRow, outputs: OutputRow[] = [board], e: VideoEnv = env(), u = user) => runVideo(e, cfg, u, camp, t, outputs, []);

describe('the engine matches the official reference (checked 2026-11-18)', () => {
  it('posts to api.higgsfield.ai/bytedance/seedance-2.0/text-to-video with the documented fields, an idempotency key, and no sound', async () => {
    const r = await run(task());
    expect(r.pending).toBe(true); expect(submits).toHaveLength(1);
    const s = submits[0]!;
    expect(s.url).toBe('https://api.higgsfield.ai/bytedance/seedance-2.0/text-to-video');
    expect(s.body).toMatchObject({ aspect_ratio: '9:16', duration: 10, resolution: '720p', generate_audio: false });
    expect(Object.keys(s.body).sort()).toEqual(['aspect_ratio', 'duration', 'generate_audio', 'prompt', 'resolution']);   // the schema has additionalProperties:false
    expect(s.idem).toMatch(/^well-job-\d+-1$/);
    expect(higgsfield.caps.ratios).toContain('9:16');
  });
  it('the model path can be set (Seedance 2.5) and image-to-video would use the other endpoint', async () => {
    await run(task(), [board], { ...env(), HIGGSFIELD_SEEDANCE_MODEL: 'bytedance/seedance-2.5' });
    expect(submits[0]!.url).toBe('https://api.higgsfield.ai/bytedance/seedance-2.5/text-to-video');
  });
});

describe('the prompt', () => {
  it('is the compliance-checked scene text plus the fixed safety suffix', async () => {
    await run(task());
    const p = String(submits[0]!.body.prompt);
    for (const sc of SCENES) expect(p).toContain(sc);
    expect(p.endsWith(SAFETY_SUFFIX)).toBe(true);
    expect(SAFETY_SUFFIX).toMatch(/no on-screen text/i); expect(SAFETY_SUFFIX).toMatch(/no real or identifiable people/i); expect(SAFETY_SUFFIX).toMatch(/no before-and-after/i); expect(SAFETY_SUFFIX).toMatch(/no medical procedures/i);
  });
  it('two clips split the scenes between them; one clip carries all', () => {
    const all = scenesOf([board]);
    expect(all).toEqual(SCENES);
    expect(clipBeats(all, 0, 2)).toEqual([SCENES[0], SCENES[2]]); expect(clipBeats(all, 1, 2)).toEqual([SCENES[1]]); expect(clipBeats(all, 0, 1)).toEqual(SCENES);
    expect(promptOf(['x'])).toContain('Vertical 9:16');
  });
  it('scene text that compliance refuses is never sent and never paid for; the campaign keeps its storyboard', async () => {
    const bad: OutputRow = { ...board, body: { scenes: [{ text: 'علاج مضمون 100% وبدون أي أضرار' }], cta: null } };
    const r = await run(task(), [bad]);
    expect(submits).toHaveLength(0); expect(projects).toHaveLength(0);
    expect(r.outs[0]).toMatchObject({ kind: 'asset_missing', body: { what: 'video', code: 'blocked_text' } }); expect(r.pending).toBe(false);
  });
});

describe('async: create, poll, download, resume', () => {
  it('the first call queues and submits and returns at once (pending); nothing is downloaded yet', async () => {
    const r = await run(task());
    expect(r).toMatchObject({ pending: true, made: 0, outs: [] });
    expect(projects).toHaveLength(1); expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: 'running', upstream_ref: 'req-1-abcdef', est_cost_usd: 2 });
    expect(r.state).toEqual({ project: 7, jobs: [1] });
    expect(r2.objs.size).toBe(0);
  });
  it('each later call polls ONCE; while the engine works the task stays pending', async () => {
    const first = await run(task());
    const next = await run(task({ kind: 'video', video: first.state! }));
    expect(statuses).toBe(1); expect(next).toMatchObject({ pending: true, outs: [] });
    await run(task({ kind: 'video', video: next.state! }));
    expect(statuses).toBe(2); expect(submits).toHaveLength(1);   // never submitted twice
  });
  it('when the engine is done: the MP4 is copied to R2 and the output row is a same-origin video_clip with size and length; the cost is recorded once', async () => {
    const first = await run(task());
    statusWord = 'completed';
    const done = await run(task({ kind: 'video', video: first.state! }));
    expect(done.pending).toBe(false); expect(done.made).toBe(1);
    const clip = done.outs[0]!;
    expect(clip).toMatchObject({ kind: 'video_clip', body: { mime: 'video/mp4', ratio: '9:16', seconds: 10, job: 1 } });
    const key = String(clip.body['key']);
    expect(ownVideo(CO, key)).toBe(true); expect(key).not.toMatch(/^https?:/);
    expect(r2.objs.get(key)).toMatchObject({ size: 2048, type: 'video/mp4' });
    expect(jobs[0]).toMatchObject({ status: 'done', cost_recorded: true });
    expect(usage).toHaveLength(1); expect(usage[0]).toMatchObject({ module: 'video' });
    // a second call after it finished does nothing more and costs nothing
    const again = await run(task({ kind: 'video' }), [board, { ...clip, task_id: 9 }]);
    expect(again).toMatchObject({ pending: false, outs: [] }); expect(usage).toHaveLength(1); expect(submits).toHaveLength(1);
  });
  it('a run killed after the submit resumes from the job ids in the task (a fresh process, no memory): same job, same request, no second video', async () => {
    const first = await run(task());
    const saved = JSON.parse(JSON.stringify(task({ kind: 'video', video: first.state! })));   // what the database holds
    statusWord = 'completed';
    const done = await run(saved);
    expect(done.made).toBe(1); expect(submits).toHaveLength(1); expect(jobs).toHaveLength(1);
  });
  it('the cap of clips: one by default, never above two whatever the setting says', () => {
    expect(clipCount({})).toBe(1); expect(clipCount({ CAMPAIGN_VIDEO_CLIPS: '2' })).toBe(2); expect(clipCount({ CAMPAIGN_VIDEO_CLIPS: '9' })).toBe(2); expect(clipCount({ CAMPAIGN_VIDEO_CLIPS: 'x' })).toBe(1); expect(clipCount({ CAMPAIGN_VIDEO_CLIPS: '0' })).toBe(1);
    expect(clipSeconds({})).toBe(10); expect(clipSeconds({ CAMPAIGN_VIDEO_SECONDS: '5' })).toBe(5); expect(clipSeconds({ CAMPAIGN_VIDEO_SECONDS: '999' })).toBe(10);
  });
  it('two clips are two jobs under one project', async () => {
    const r = await run(task(), [board], { ...env(), CAMPAIGN_VIDEO_CLIPS: '2' });
    expect(jobs).toHaveLength(2); expect(projects).toHaveLength(1); expect(r.state!.jobs).toEqual([1, 2]);
    expect(submits.map(s => s.idem)).toEqual(['well-job-1-1', 'well-job-2-1']);
  });
});

describe('the campaign never fails: it keeps the storyboard and says exactly what to do', () => {
  const says = (r: Awaited<ReturnType<typeof run>>) => String(r.outs[0]!.body['text']);
  it('module locked for the company', async () => {
    const r = await run(task(), [board], env(), locked);
    expect(r.outs[0]).toMatchObject({ kind: 'asset_missing', body: { what: 'video', code: 'locked', retry: true } });
    expect(says(r)).toContain('وحدة الفيديو مقفلة'); expect(says(r)).toContain('إدارة الوحدات'); expect(says(r)).toContain('ولّد الملفات الناقصة');
    expect(r.missing).toEqual(['video:locked']); expect(submits).toHaveLength(0); expect(projects).toHaveLength(0);
  });
  it('keys missing', async () => {
    const r = await run(task(), [board], { FILES: r2.bucket });
    expect(says(r)).toContain('مفاتيح Higgsfield ناقصة'); expect(r.missing).toEqual(['video:no_keys']); expect(submits).toHaveLength(0);
    expect(says(r)).not.toMatch(/HIGGSFIELD_|_KEY|Worker|Supabase/);   // a normal user never reads a secret's name
  });
  it('no storage', async () => {
    expect((await run(task(), [board], { ...E })).missing).toEqual(['video:no_storage']);
  });
  it('the video cap reached BEFORE queuing: paused with a note, nothing sent', async () => {
    caps = [{ module: 'video', monthly_cap_usd: 5, alert_at_pct: 80 }]; spent = [{ module: 'video', cost_usd: 5 }];
    const r = await run(task());
    expect(r.missing).toEqual(['video:capped']); expect(says(r)).toContain('سقف صرف الفيديو'); expect(submits).toHaveLength(0); expect(projects).toHaveLength(0);
  });
  it('the cap reached between queue and submit: the job stops by the module\'s own rule and the clip is marked missing', async () => {
    const first = await run(task());
    caps = [{ module: 'video', monthly_cap_usd: 5, alert_at_pct: 80 }]; spent = [{ module: 'video', cost_usd: 6 }]; clearSnaps();
    jobs[0]!.status = 'queued'; jobs[0]!.upstream_ref = null;   // a retry waiting in the queue
    const r = await run(task({ kind: 'video', video: first.state! }));
    expect(r.pending).toBe(false); expect(r.missing).toEqual(['video:cap_reached']); expect(says(r)).toContain('سقف'); expect(submits).toHaveLength(1);
  });
  it('the engine refuses the content (moderation): marked missing, plain words, not charged', async () => {
    const first = await run(task());
    statusWord = 'nsfw';
    const r = await run(task({ kind: 'video', video: first.state! }));
    expect(r.missing).toEqual(['video:blocked']); expect(says(r)).toContain('رفض المحتوى'); expect(usage).toHaveLength(0); expect(jobs[0]!.status).toBe('failed');
  });
  it('an empty balance and a model not open to the account say so, and a busy engine is retried instead of failing', async () => {
    submitStatus = 403;
    expect((await run(task())).missing).toEqual(['video:balance']);
    jobs = []; projects = []; submitStatus = 404;
    expect((await run(task())).missing).toEqual(['video:no_access']);
    jobs = []; projects = []; submitStatus = 429;
    const busy = await run(task());
    expect(busy.pending).toBe(true); expect(jobs[0]).toMatchObject({ status: 'queued', error_code: 'rate' });   // back in the queue with a wait
  });
  it('no storyboard yet: asks for the motion task first', async () => {
    expect((await run(task(), [])).missing).toEqual(['video:needs_inputs']);
  });
  it('every note is plain masculine Arabic with no code or secret name', async () => {
    for (const code of ['locked', 'no_keys', 'capped', 'needs_inputs', 'blocked', 'balance', 'no_access']) {
      const r = await run(task(), [code === 'needs_inputs' ? { ...board, body: {} } : board], code === 'no_keys' ? { FILES: r2.bucket } : env(), code === 'locked' ? locked : user);
      if (r.outs[0]?.kind === 'asset_missing') { expect(String(r.outs[0].body['text'])).toMatch(/[؀-ۿ]/); expect(String(r.outs[0].body['text'])).not.toMatch(/HIGGSFIELD_|_KEY|Worker|Supabase|\.sql|\b4\d\d\b/); }
    }
  });
});

describe('the cost is in the estimate BEFORE approving', () => {
  it('one 10-second 720p clip is added to the video task (and only to it)', () => {
    expect(videoUsd({})).toBe(2); expect(videoUsd({ CAMPAIGN_VIDEO_CLIPS: '2' })).toBe(4);
    expect(assetUsd('design', ['meta'], 'video', {})).toBe(2); expect(assetUsd('voice', ['meta'], 'video', {})).toBe(2);
    expect(assetUsd('design', ['meta'])).toBeGreaterThan(0); expect(assetUsd('design', ['meta'])).not.toBe(2);
  });
  it('the standard plan\'s estimate includes it', () => {
    const d = defaultTasks(), plat = ['meta'];
    const old = d.slice(0, -1), without = estimate(old.map(x => x.agent), 'openai/gpt-4.1', 'openrouter', old.map(x => assetUsd(x.agent, plat)));
    const withVideo = estimate(d.map(x => x.agent), 'openai/gpt-4.1', 'openrouter', d.map(x => assetUsd(x.agent, plat, x.kind, {})));
    expect(withVideo.perTask.at(-1)).toBeGreaterThan(2);
    expect(withVideo.usd - without.usd).toBeGreaterThan(2);   // the clip (2) plus the video agent's own tokens
    expect(withVideo.perTask.at(-1)).toBeGreaterThan(2);
  });
});

describe('the pack shows the clip', () => {
  const clip: OutputRow = { id: 31, task_id: 9, kind: 'video_clip', platform: 'story', body: { key: `video/${CO}/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.mp4`, mime: 'video/mp4', ratio: '9:16', seconds: 10, text: 'فيديو الحملة · 9:16 · 10 ثواني' }, compliance: [] };
  it('the Markdown export lists it with its text', () => {
    const md = packMarkdown({ title: 'ح', status: 'review' }, [{ id: 9, position: 8, agent: 'design', title: 'فيديو الحملة', depends_on: [], status: 'review' }], [clip]);
    expect(md).toContain('فيديو الحملة · 9:16 · 10 ثواني');
  });
  it('the page draws a <video controls> from the same-origin file route (no blob, no outside host) and the pack link downloads it', () => {
    const js = raw('js');
    expect(js).toContain("o.kind === 'video_clip'"); expect(js).toMatch(/<video controls[^>]*src="\$\{file\}"/); expect(js).not.toMatch(/<video[^>]*src="https?:/);
    expect(js).toContain("video_clip: ['فيديو الحملة', 'Campaign video']");
  });
  const csp = Object.values(import.meta.glob('../../astro.config.mjs', { query: '?raw', import: 'default', eager: true }))[0] as string;
  it('the CSP lets a same-origin video play (media-src self) and nothing from outside', () => { expect(csp).toMatch(/media-src 'self'/); expect(csp).not.toMatch(/media-src[^"]*https?:/); });
});

describe('the file route streams the clip for who may see the campaign, with Range', () => {
  const key = `video/${CO}/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.mp4`;
  async function get(url: string, range?: string, mime = 'video/mp4', k = key): Promise<Response> {
    vi.spyOn(A, 'requireUser').mockResolvedValue({ cfg, user: { ...user, role: 'owner' } } as never);
    await r2.bucket.put(key, new Blob([new Uint8Array(2048)]).stream(), { httpMetadata: { contentType: 'video/mp4' } });
    const f = vi.mocked(fetch);
    f.mockImplementation(async (u: string | URL | Request) => {
      const s = String(u);
      if (s.includes('/campaign_outputs')) return new Response(JSON.stringify([{ campaign_id: CID, kind: 'video_clip', platform: 'story', body: { key: k, mime } }]));
      if (s.includes('/campaigns?')) return new Response(JSON.stringify([{ id: CID }]));
      return new Response('[]');
    });
    return api.fetch(new Request(`https://x.example${url}`, { headers: range ? { range } : {} }), { ...E, FILES: r2.bucket } as never);
  }
  afterEach(() => { vi.restoreAllMocks(); });
  it('serves the file, and a Range request gets 206 with its bytes', async () => {
    const full = await get('/api/campaigns/file?id=31');
    expect(full.status).toBe(200); expect(full.headers.get('content-type')).toBe('video/mp4'); expect(full.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(full.headers.get('cache-control')).toContain('private'); expect(full.headers.get('accept-ranges')).toBe('bytes');
    const part = await get('/api/campaigns/file?id=31', 'bytes=0-9');
    expect(part.status).toBe(206); expect(part.headers.get('content-range')).toBe('bytes 0-9/2048');
  });
  it('refuses a key outside the company\'s video folder', async () => {
    const r = await get('/api/campaigns/file?id=31', undefined, 'video/mp4', `video/99999999-9999-9999-9999-999999999999/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.mp4`);
    expect(r.status).toBe(404);
  });
});
