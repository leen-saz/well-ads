// The Worker's `scheduled()` handler (src/app.ts): which cron string starts which job, and that one failing job never stops the others.
// hourlyTasks() and the dispatch helpers have their own tests; this one covers the glue that maps them together, which a wrong mapping
// (for example "backup" calling the restore workflow) or a lost Promise.allSettled would break without any other test noticing.
// No real network: fetch is a stub that records GitHub dispatch calls, and the Astro/Cloudflare adapters are replaced by empty middleware.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('astro/hono', () => { const mw = () => async (_c: unknown, next: () => Promise<void>) => next(); return { actions: mw, middleware: mw, notFound: mw, pages: mw, i18n: mw }; });
vi.mock('@astrojs/cloudflare/hono', () => ({ cf: () => async (_c: unknown, next: () => Promise<void>) => next() }));
const social = vi.fn(async () => 0), listening = vi.fn(async () => 0), transcribe = vi.fn(async () => 0), watchdog = vi.fn(async () => undefined);
vi.mock('../../src/modules/social/cron', () => ({ runSocial: social }));
vi.mock('../../src/modules/listening/fetcher', () => ({ runListening: listening }));
vi.mock('../../src/modules/transcribe/service', () => ({ runTranscribe: transcribe }));
vi.mock('cloudflare:workers', () => ({ WorkflowEntrypoint: class {} }));
vi.mock('../../src/lib/watchdog', () => ({ runWatchdog: watchdog }));

const { default: worker } = await import('../../src/app');

const HOURLY = '7 * * * *', EVERY5 = '*/5 * * * *';
let dispatched: string[];
let pending: Promise<unknown>[];
const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); }, passThroughOnException: () => undefined } as unknown as ExecutionContext;
const run = async (cron: string, at: string) => {
  worker.scheduled({ cron, scheduledTime: Date.parse(at), type: 'scheduled' } as unknown as ScheduledController, { GH_DISPATCH_TOKEN: 'test-token' } as never, ctx);
  await Promise.allSettled(pending); pending = [];
  await new Promise(r => setTimeout(r, 0));
};

beforeEach(() => {
  dispatched = []; pending = [];
  social.mockClear(); listening.mockClear(); transcribe.mockClear(); watchdog.mockReset(); watchdog.mockResolvedValue(undefined);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { dispatched.push(String(url).split('/workflows/')[1]!.split('/')[0]!); return new Response(null, { status: 204 }); }));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('scheduled(): the cron string decides the job', () => {
  it('every 5 minutes: due social posts, listening and transcription, and nothing is dispatched to GitHub', async () => {
    await run(EVERY5, '2026-11-11T10:05:00Z');   // a Wednesday
    expect(social).toHaveBeenCalledTimes(1); expect(listening).toHaveBeenCalledTimes(1); expect(transcribe).toHaveBeenCalledTimes(1);
    expect(watchdog).not.toHaveBeenCalled(); expect(dispatched).toEqual([]);
  });
  it('hourly on an ordinary hour: the refresh and the watchdog only', async () => {
    await run(HOURLY, '2026-11-11T10:07:00Z');
    expect(dispatched).toEqual(['refresh.yml']); expect(watchdog).toHaveBeenCalledTimes(1);
    expect(social).not.toHaveBeenCalled();
  });
  it('hourly on Sunday 02:xx UTC: the refresh AND the weekly backup (db-backup.yml), never the restore workflow', async () => {
    await run(HOURLY, '2026-11-15T02:07:00Z');   // Sunday
    expect(dispatched.sort()).toEqual(['db-backup.yml', 'refresh.yml']);
  });
  it('hourly on the 1st at 03:xx UTC: the refresh AND the monthly restore test (db-restore-test.yml), never the backup', async () => {
    await run(HOURLY, '2026-12-01T03:07:00Z');
    expect(dispatched.sort()).toEqual(['db-restore-test.yml', 'refresh.yml']);
  });
  it('an unknown cron string starts nothing and says so', async () => {
    await run('1 2 3 4 5', '2026-11-11T10:07:00Z');
    expect(dispatched).toEqual([]); expect(social).not.toHaveBeenCalled(); expect(watchdog).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('cron: unknown trigger', '1 2 3 4 5');
  });
});

describe('scheduled(): one failing job never stops the others', () => {
  it('a watchdog that throws does not skip the refresh (nor the backup on its day), and the failure is logged by name', async () => {
    watchdog.mockRejectedValue(new Error('watchdog exploded'));
    await run(HOURLY, '2026-11-15T02:07:00Z');
    expect(dispatched.sort()).toEqual(['db-backup.yml', 'refresh.yml']);
    expect(console.error).toHaveBeenCalledWith('cron: job failed', 'watchdog', expect.stringContaining('watchdog exploded'));
  });
  it('a failing social job does not stop listening or transcription', async () => {
    social.mockRejectedValue(new Error('social exploded'));
    await run(EVERY5, '2026-11-11T10:05:00Z');
    expect(listening).toHaveBeenCalledTimes(1); expect(transcribe).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith('cron: job failed', 'social', expect.stringContaining('social exploded'));
  });
});
