// The video tab's core: request validation against the capability map, the job lifecycle (queue, submit, poll, done),
// retries with backoff, the monthly cap, one cost record per clip, and the routes' plain answers.
// The engine is a faithful fake of Higgsfield's queue (submit → request id → status words → a video link) and Supabase is an
// in-memory table that honours the conditional PATCH filters the code relies on. Synthetic data only; no keys.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../lib/auth';
import { api } from '../../api/index';
import { clearSnaps, overCap } from '../../lib/usage';
import { WELL_COMPANY } from '../../lib/tenant';
import { AVATARS, splitSeconds, validate } from './engine';
import { higgsfield } from './higgsfield';
import { advance, backoffMs, cancel, createJobs, sayOf, type Job } from './jobs';

const CO = '11111111-1111-1111-1111-111111111111';
const E = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'boss@example.com', HIGGSFIELD_API_KEY: 'k-test-1', HIGGSFIELD_API_SECRET: 's-test-1' };
const cfg = A.env(E);
const user = { co: CO, uid: 'u-1', email: 'a@example.com' };
const CLIP = { kind: 'text-to-video', prompt: 'لقطة لعيادة هادئة', ratio: '9:16', seconds: 5, resolution: '720p' };

// ---- the fakes
let db: Job[], usage: Record<string, unknown>[], caps: { module: string; monthly_cap_usd: number | null; alert_at_pct: number }[], spent: { module: string; cost_usd: number }[];
let submits: number, submitStatus: number, statusWord: string, videoType: string, profile: A.Profile | null;
const files = { stored: [] as string[], put: vi.fn(async (k: string) => { files.stored.push(k); }) };
const env = { ...E, FILES: files as unknown as R2Bucket };

function qs(url: string) { const u = new URL(url); return u.searchParams; }
function matches(row: Record<string, unknown>, q: URLSearchParams) {
  for (const [k, v] of q) if (v.startsWith('eq.') && String(row[k]) !== v.slice(3)) return false;
  return true;
}
beforeEach(() => {
  db = []; usage = []; caps = []; spent = []; submits = 0; submitStatus = 200; statusWord = 'queued'; videoType = 'video/mp4'; profile = null; files.stored = []; clearSnaps();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const m = init.method || 'GET', body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    if (url.includes('platform.higgsfield.ai')) {
      if (m === 'POST') { submits++; return submitStatus === 200 ? new Response(JSON.stringify({ request_id: 'req-' + submits + '-abcdef' })) : new Response('{}', { status: submitStatus }); }
      return new Response(JSON.stringify({ status: statusWord, ...(statusWord === 'completed' ? { video: { url: 'https://cdn.higgsfield.example/v.mp4' } } : {}) }));
    }
    if (url.startsWith('https://cdn.higgsfield.example')) return new Response('video-bytes', { headers: { 'content-type': videoType, 'content-length': '11' } });
    if (url.includes('/profiles?id=eq.')) return new Response(JSON.stringify(profile ? [profile] : []));
    if (url.includes('/rest/v1/video_jobs')) {
      if (m === 'POST') { const made = (body as Record<string, unknown>[]).map((b, i) => ({ id: db.length + i + 1, status: 'queued', attempts: 0, max_attempts: 3, next_attempt_at: new Date(0).toISOString(), upstream_ref: null, result_key: null,
        error_code: null, cost_recorded: false, created_at: new Date(0).toISOString(), updated_at: new Date(0).toISOString(), finished_at: null, ...b })) as unknown as Job[]; db.push(...made); return new Response(JSON.stringify(made)); }
      const hit = db.filter(r => matches(r as unknown as Record<string, unknown>, qs(url)));
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

const usageCtx = () => ({ cfg, co: CO, uid: 'u-1' });
const ctx = (now?: number) => ({ cfg, env, usage: usageCtx(), ...(now != null ? { now } : {}) });
async function queue(n = 1): Promise<Job[]> {
  const made = await createJobs(cfg, user, 7, higgsfield, Array.from({ length: n }, () => ({ ...CLIP })));
  expect(made.problems).toBeUndefined();
  return made.jobs!;
}

describe('validation before anything goes upstream', () => {
  it('accepts a clean clip', () => { expect(validate(higgsfield.caps, CLIP).input).toMatchObject({ kind: 'text-to-video', ratio: '9:16', seconds: 5 }); });
  it('says every problem in plain Arabic, with no code', () => {
    const v = validate(higgsfield.caps, { kind: 'image-to-video', prompt: '', ratio: '4:5', seconds: 7, resolution: '8k' });
    expect(v.input).toBeUndefined();
    expect(v.problems.length).toBeGreaterThanOrEqual(5);
    for (const p of v.problems) expect(p).toMatch(/[؀-ۿ]/);
    expect(v.problems.join(' ')).not.toMatch(/\b(400|json|api)\b/i);
  });
  it('image and avatar clips need their file, and only https links pass', () => {
    expect(validate(higgsfield.caps, { ...CLIP, kind: 'image-to-video' }).problems.join()).toContain('صورة');
    expect(validate(higgsfield.caps, { ...CLIP, kind: 'avatar' }).problems.join()).toContain('صوت');
    expect(validate(higgsfield.caps, { ...CLIP, kind: 'image-to-video', imageUrl: 'http://x.example/a.png' }).problems.join()).toContain('https');
    expect(validate(higgsfield.caps, { ...CLIP, kind: 'image-to-video', imageUrl: 'https://u:p@x.example/a.png' }).problems.join()).toContain('https');
  });
  it('a bad request queues nothing and never calls the engine', async () => {
    const r = await createJobs(cfg, user, 7, higgsfield, [CLIP, { ...CLIP, ratio: '4:5' }]);
    expect(r.jobs).toBeUndefined(); expect(r.problems![0]).toMatch(/^اللقطة 2:/);
    expect(db).toHaveLength(0); expect(submits).toBe(0);
  });
  it('splits an ad length into clips the engine can make', () => {
    expect(splitSeconds(15, [5, 10])).toEqual([10, 5]);
    expect(splitSeconds(30, [5, 10])).toEqual([10, 10, 10]);
    expect(splitSeconds(60, [5, 10]).reduce((a, b) => a + b, 0)).toBe(60);
  });
  it('the avatar registry is a list of skills, not one fixed avatar', () => { expect(AVATARS.length).toBeGreaterThan(1); expect(new Set(AVATARS.map(a => a.id)).size).toBe(AVATARS.length); });
});

describe('job lifecycle', () => {
  it('queued → running with a reference → done with a stored file and one cost record', async () => {
    const [j] = await queue();
    expect(j!.status).toBe('queued');
    const a = await advance(ctx(), j!);
    expect(a).toMatchObject({ status: 'running', attempts: 1 }); expect(a.upstream_ref).toMatch(/^req-/);
    statusWord = 'in_progress';
    expect((await advance(ctx(), a)).status).toBe('running');
    statusWord = 'completed';
    const d = await advance(ctx(), a);
    expect(d.status).toBe('done'); expect(d.result_key).toMatch(new RegExp(`^video/${CO}/.+\\.mp4$`)); expect(files.stored).toHaveLength(1);
    await Promise.resolve();
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ company_id: CO, module: 'video', provider: 'higgsfield', tokens_in: 0, tokens_out: 0, priced: true });
    expect(Number(usage[0]!.cost_usd)).toBeGreaterThan(0);
    // finished jobs do not move again, and a stale copy cannot record the cost twice
    expect((await advance(ctx(), d)).status).toBe('done');
    await advance(ctx(), a);
    expect(usage).toHaveLength(1);
  });
  it('two callers on the same queued job send it once', async () => {
    const [j] = await queue();
    await overCap(usageCtx(), 'video');   // the minute snapshot is warm, as it is on a running Worker
    await Promise.all([advance(ctx(), j!), advance(ctx(), j!)]);
    expect(submits).toBe(1);
  });
  it('a job that is not due yet stays where it is', async () => {
    const [j] = await queue();
    db[0]!.next_attempt_at = new Date(10_000).toISOString();
    expect((await advance(ctx(5_000), db[0]!)).status).toBe('queued'); expect(submits).toBe(0);
    expect(j!.id).toBe(1);
  });
});

describe('retries', () => {
  it('a busy engine puts the job back with a growing wait, then it goes through', async () => {
    const [j] = await queue();
    submitStatus = 429;
    const a = await advance(ctx(1_000), j!);
    expect(a).toMatchObject({ status: 'queued', attempts: 1, error_code: 'rate' });
    expect(Date.parse(a.next_attempt_at)).toBe(1_000 + backoffMs(1));
    expect(sayOf(a.error_code)).not.toMatch(/rate|429/);
    expect((await advance(ctx(1_001), a)).attempts).toBe(1);   // not due: nothing sent
    submitStatus = 200;
    const b = await advance(ctx(1_000 + backoffMs(1) + 1), a);
    expect(b).toMatchObject({ status: 'running', attempts: 2 });
  });
  it('stops after the attempts are used', async () => {
    const [j] = await queue();
    submitStatus = 503;
    let cur: Job = j!, t = 0;
    for (let i = 0; i < 4; i++) { cur = await advance(ctx(t), cur); t += 11 * 60_000; }
    expect(cur).toMatchObject({ status: 'failed', attempts: 3, error_code: 'upstream' });
    expect(usage).toHaveLength(0);   // nothing finished, nothing billed
  });
  it('the engine rejecting the request is final and said in plain words', async () => {
    const [j] = await queue();
    submitStatus = 400;
    const a = await advance(ctx(), j!);
    expect(a).toMatchObject({ status: 'failed', attempts: 1, error_code: 'rejected' });
    expect(sayOf(a.error_code)).toMatch(/[؀-ۿ]/); expect(sayOf(a.error_code)).not.toMatch(/400/);
  });
  it('rejected keys read as not ready, never as a key problem', async () => {
    const [j] = await queue();
    submitStatus = 401;
    expect(sayOf((await advance(ctx(), j!)).error_code)).toBe('ما اكتمل تجهيزه، بلّغ الإدارة');
  });
  it('a clip the engine fails is retried; a blocked one is not', async () => {
    const [j] = await queue(2).then(l => l);
    const a = await advance(ctx(), j!);
    statusWord = 'failed';
    expect((await advance(ctx(0), a)).status).toBe('queued');
    const [, k] = db;
    const b = await advance(ctx(), k!);
    statusWord = 'nsfw';
    expect(await advance(ctx(), b)).toMatchObject({ status: 'failed', error_code: 'blocked' });
  });
  it('a result that cannot be saved is retried, not marked done', async () => {
    const [j] = await queue();
    const a = await advance(ctx(), j!);
    statusWord = 'completed'; videoType = 'text/html';
    expect(await advance(ctx(0), a)).toMatchObject({ status: 'queued', error_code: 'store_failed' });
    expect(usage).toHaveLength(0);
  });
});

describe('cap and setup', () => {
  it('a tab over its monthly cap sends nothing', async () => {
    caps = [{ module: 'video', monthly_cap_usd: 5, alert_at_pct: 80 }]; spent = [{ module: 'video', cost_usd: 5 }];
    const [j] = await queue();
    expect(await advance(ctx(), j!)).toMatchObject({ status: 'failed', error_code: 'cap_reached', attempts: 0 });
    expect(submits).toBe(0);
  });
  it('with no row saved the default cap applies (the owner has not chosen)', async () => {
    spent = [{ module: 'video', cost_usd: 5 }];
    expect(await advance(ctx(), (await queue())[0]!)).toMatchObject({ status: 'failed', error_code: 'cap_reached' });
    expect(submits).toBe(0);
  });
  it('under the cap, or with no cap, it goes through', async () => {
    caps = [{ module: 'video', monthly_cap_usd: 5, alert_at_pct: 80 }]; spent = [{ module: 'video', cost_usd: 1 }];
    expect((await advance(ctx(), (await queue())[0]!)).status).toBe('running');
    clearSnaps(); caps = [{ module: 'video', monthly_cap_usd: null, alert_at_pct: 80 }]; spent = [{ module: 'video', cost_usd: 9999 }];   // the owner saved an empty cap: no limit
    expect((await advance(ctx(), (await queue())[0]!)).status).toBe('running');
  });
  it('without the engine keys the job stops as not ready and nothing is sent', async () => {
    const [j] = await queue();
    const r = await advance({ ...ctx(), env: { ...env, HIGGSFIELD_API_KEY: '' } }, j!);
    expect(r).toMatchObject({ status: 'failed', error_code: 'not_ready' }); expect(submits).toBe(0);
  });
  it('only a queued clip can be stopped', async () => {
    const [j] = await queue();
    const run = await advance(ctx(), j!);
    expect(await cancel(cfg, run)).toBeNull();
    const [k] = await queue();
    expect((await cancel(cfg, k!))?.status).toBe('cancelled');
  });
});

describe('the cost record', () => {
  it('stores the dollar amount only: no prompt, no email, no key', async () => {
    const [j] = await queue(); const a = await advance(ctx(), j!); statusWord = 'completed'; await advance(ctx(), a); await Promise.resolve();
    const txt = JSON.stringify(usage[0]);
    expect(txt).not.toMatch(/k-test-1|s-test-1|a@example\.com|عيادة/);
  });
});

describe('routes', () => {
  type Rsp = { ready?: boolean; error?: string; jobs: { ready: boolean }[]; engines: { secrets?: string[] }[] };
  const owner = { id: '33333333-3333-3333-3333-333333333333', email: 'boss@example.com', role: 'owner', active: true, access: { video: 'approve' }, company_id: WELL_COMPANY } as A.Profile;
  async function call(path: string, p: A.Profile, method = 'GET', body?: unknown, e: Record<string, unknown> = E) {
    profile = p;
    const cookie = `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(p, cfg), cfg.secret))}`;
    const res = await api.request('https://well.example' + path, { method, headers: { origin: 'https://well.example', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', cookie }, ...(body ? { body: JSON.stringify(body) } : {}) }, e);
    return { status: res.status, body: await res.json() as Rsp };
  }
  it('the owner is told which secrets are missing; a member only gets a plain sentence', async () => {
    const bare = { ...E, HIGGSFIELD_API_KEY: '', HIGGSFIELD_API_SECRET: '' };
    const o = await call('/api/video/engines', owner, 'GET', undefined, bare);
    expect(o.body.ready).toBe(false); expect(o.body.engines[0]!.secrets).toEqual(['HIGGSFIELD_API_KEY', 'HIGGSFIELD_API_SECRET']);
    const member = { ...owner, email: 'm@example.com', role: 'member', access: { video: 'edit' } } as A.Profile;
    const m = await call('/api/video/engines', member, 'GET', undefined, bare);
    expect(m.body.engines[0]!.secrets).toBeUndefined();
    const q = await call('/api/video/jobs', member, 'POST', { project: 1, clips: [CLIP] }, bare);
    expect(q.status).toBe(503); expect(q.body.error).toBe('ما اكتمل تجهيزه، بلّغ الإدارة');
  });
  it('an answer about a clip never carries the engine reference or the storage key', async () => {
    const [j] = await queue(); const a = await advance(ctx(), j!); statusWord = 'completed'; await advance(ctx(), a);
    db.forEach(r => { r.company_id = WELL_COMPANY; });
    // the project lookup
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (u: string, i?: RequestInit) => String(u).includes('/video_projects') ? new Response(JSON.stringify([{ id: 7, ratio: '9:16', avatar_id: '' }])) : (real as typeof fetch)(u, i)));
    const r = await call('/api/video/jobs?project=7', owner);
    expect(r.status).toBe(200);
    const txt = JSON.stringify(r.body);
    expect(txt).not.toMatch(/upstream_ref|result_key|req-1|video\//); expect(r.body.jobs[0]!.ready).toBe(true);
  });
});
