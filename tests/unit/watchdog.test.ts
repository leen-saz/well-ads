import { describe, expect, it, vi } from 'vitest';
import { runWatchdog, REPEAT_HOURS, WATCHDOG_STATE_KEY, type WatchdogEnv } from '../../src/lib/watchdog';

const NOW = Date.parse('2026-11-12T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 36e5);

// An in-memory R2 stand-in: dash.json uploaded `age` hours ago, plus whatever else is written to it
function bucket(age: number | null, kept: Record<string, string> = {}) {
  const store = { ...kept };
  return {
    store,
    head: async (k: string) => (k === 'site/dash.json' && age != null ? { uploaded: hoursAgo(age) } : null),
    get: async (k: string) => (k in store ? { text: async () => store[k] as string } : null),
    put: async (k: string, v: string) => { store[k] = v; },
  };
}
const ok = () => vi.fn(async () => new Response(null, { status: 200 }));

describe('data age watchdog', () => {
  it('stays silent while the data is fresh', async () => {
    const f = ok();
    expect(await runWatchdog({ FILES: bucket(1), ALERT_WEBHOOK_URL: 'https://hook.test/x' }, f as unknown as typeof fetch, NOW)).toBe('ok');
    expect(f).not.toHaveBeenCalled();
  });
  it('does nothing without the bucket binding', async () => {
    expect(await runWatchdog({}, ok() as unknown as typeof fetch, NOW)).toBe('ok');
  });
  it('alerts the webhook once the file is older than 3 hours, with hours only', async () => {
    const f = ok(); const files = bucket(3.5);
    expect(await runWatchdog({ FILES: files, ALERT_WEBHOOK_URL: 'https://hook.test/x' }, f as unknown as typeof fetch, NOW)).toBe('alerted');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://hook.test/x');
    expect(String(init.body)).toContain('3.5');
    expect(JSON.parse(files.store[WATCHDOG_STATE_KEY] ?? "")).toMatchObject({ stale: true });
  });
  it('sends the email through Resend when it is configured', async () => {
    const f = ok();
    const env: WatchdogEnv = { FILES: bucket(5), RESEND_API_KEY: 're_x', ALERT_EMAIL_FROM: 'a@b.test', ALERT_EMAIL_TO: 'c@d.test, e@f.test' };
    expect(await runWatchdog(env, f as unknown as typeof fetch, NOW)).toBe('alerted');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer re_x');
    expect(JSON.parse(String(init.body)).to).toEqual(['c@d.test', 'e@f.test']);
  });
  it('a missing dash.json counts as stale', async () => {
    expect(await runWatchdog({ FILES: bucket(null), ALERT_WEBHOOK_URL: 'https://hook.test/x' }, ok() as unknown as typeof fetch, NOW)).toBe('alerted');
  });
  it('does not repeat before the repeat window, then repeats', async () => {
    const f = ok();
    const state = (h: number) => JSON.stringify({ stale: true, alerted_at: hoursAgo(h).toISOString() });
    expect(await runWatchdog({ FILES: bucket(8, { [WATCHDOG_STATE_KEY]: state(1) }), ALERT_WEBHOOK_URL: 'https://hook.test/x' }, f as unknown as typeof fetch, NOW)).toBe('quiet');
    expect(f).not.toHaveBeenCalled();
    expect(await runWatchdog({ FILES: bucket(8, { [WATCHDOG_STATE_KEY]: state(REPEAT_HOURS + 0.1) }), ALERT_WEBHOOK_URL: 'https://hook.test/x' }, f as unknown as typeof fetch, NOW)).toBe('alerted');
  });
  it('says so once when the data recovers, and clears the state', async () => {
    const f = ok(); const files = bucket(0.5, { [WATCHDOG_STATE_KEY]: JSON.stringify({ stale: true, alerted_at: hoursAgo(2).toISOString() }) });
    expect(await runWatchdog({ FILES: files, ALERT_WEBHOOK_URL: 'https://hook.test/x' }, f as unknown as typeof fetch, NOW)).toBe('recovered');
    expect(f).toHaveBeenCalledTimes(1);
    expect(JSON.parse(files.store[WATCHDOG_STATE_KEY] ?? "")).toEqual({ stale: false, alerted_at: null });
  });
  it('with no channel it is retried next time (not marked as sent), and a failing channel does not throw', async () => {
    const files = bucket(4);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await runWatchdog({ FILES: files }, ok() as unknown as typeof fetch, NOW)).toBe('no_channel');
    expect(JSON.parse(files.store[WATCHDOG_STATE_KEY] ?? "")).toEqual({ stale: true, alerted_at: null });
    expect(await runWatchdog({ FILES: files, ALERT_WEBHOOK_URL: 'https://hook.test/x' }, (async () => { throw new Error('net'); }) as unknown as typeof fetch, NOW)).toBe('no_channel');
    err.mockRestore();
  });
});
