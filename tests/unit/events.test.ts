/* eslint-disable @typescript-eslint/no-explicit-any -- recorded request bodies are read loosely in assertions */
// Outbound events and webhooks (M11, 043_events.sql, src/mcp/events.ts). Fakes only; the secret below is made up.
// @ts-expect-error node:crypto exists under vitest (the Worker types do not include node)
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BACKOFF_MIN, cleanTypes, cleanUrl, createWebhook, deliverDue, emit, secretName, sign } from '../../src/mcp/events';
import { WELL_COMPANY } from '../../src/lib/tenant';

const cfg = { url: 'https://sb.example', anon: 'anon', service: 'service' } as never;
const SECRET = 'whsec_' + btoa('not-a-real-secret-0123456');
type Call = { url: string; method: string; body: any; headers: Record<string, string> };
function world(opts: { due?: any[]; vault?: Record<string, string>; hook?: (url: string) => Response | Promise<Response>; insertFail?: boolean } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (u: string, init: RequestInit = {}) => {
    const url = String(u), method = init.method || 'GET';
    const headers = Object.fromEntries(new Headers(init.headers as HeadersInit).entries());
    calls.push({ url, method, body: init.body ? (() => { try { return JSON.parse(String(init.body)); } catch { return String(init.body); } })() : null, headers });
    const j = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
    if (!url.startsWith('https://sb.example')) return opts.hook ? opts.hook(url) : new Response('', { status: 200 });
    const path = url.replace('https://sb.example', '');
    if (path.startsWith('/rest/v1/mcp_events')) { if (opts.insertFail) throw new Error('down'); return j(null, 201); }
    if (path.startsWith('/rest/v1/webhook_deliveries?status=eq.pending')) return j(opts.due ?? []);
    if (path.startsWith('/rest/v1/rpc/connector_env')) return j(Object.entries(opts.vault ?? {}).map(([name, value]) => ({ name, value })));
    if (path.startsWith('/rest/v1/webhooks') && method === 'POST') return j([{ id: 7 }], 201);
    return j([]);
  }));
  return calls;
}
const NOW = Date.parse('2026-11-21T12:00:00Z');
const delivery = (over: any = {}) => ({ id: 1, company_id: WELL_COMPANY, attempts: 0, webhook: { id: 7, url: 'https://hooks.example.com/well', active: true }, event: { id: 42, type: 'post.published', data: { post_id: 5, status: 'published', platforms: ['facebook'] }, created_at: '2026-11-21T11:59:00Z' }, ...over });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('where a webhook may point', () => {
  it('public https by name only: no http, IP, port, credentials, bare or internal names', () => {
    expect(cleanUrl('https://hooks.example.com/x?y=1')).toBe('https://hooks.example.com/x?y=1');
    for (const bad of ['http://hooks.example.com', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://10.0.0.1', 'https://hooks.example.com:8443/x', 'https://u:p@hooks.example.com',
      'https://localhost/x', 'https://intranet/x', 'https://db.internal/x', 'https://printer.local', 'ftp://x.example.com', '', 'not a url'])
      expect(cleanUrl(bad), bad).toBeNull();
  });
  it('only known event types, once each', () => {
    expect(cleanTypes(['post.published', 'post.published', 'nope', 5, 'account.disconnected'])).toEqual(['post.published', 'account.disconnected']);
  });
});

describe('emit', () => {
  it('one request (the database queues the deliveries), and it never throws', async () => {
    const calls = world();
    await emit(cfg, WELL_COMPANY, 'post.published', { post_id: 1 });
    expect(calls.map(c => [c.method, c.url])).toEqual([['POST', 'https://sb.example/rest/v1/mcp_events']]);
    expect(calls[0]!.body).toEqual({ company_id: WELL_COMPANY, type: 'post.published', data: { post_id: 1 } });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    world({ insertFail: true });
    await expect(emit(cfg, WELL_COMPANY, 'post.failed', {})).resolves.toBeUndefined();
  });
});

describe('deliverDue', () => {
  it('signs per Standard Webhooks and marks a 2xx delivered; no redirect is followed', async () => {
    const calls = world({ due: [delivery()], vault: { [secretName(7)]: SECRET } });
    expect(await deliverDue(cfg, fetch, NOW)).toBe(1);
    const hook = calls.find(c => c.url === 'https://hooks.example.com/well')!;
    const ts = String(Math.floor(NOW / 1000));
    expect(hook.headers['webhook-id']).toBe('evt_42');
    expect(hook.headers['webhook-timestamp']).toBe(ts);
    const raw = typeof hook.body === 'string' ? hook.body : JSON.stringify(hook.body);
    const want = 'v1,' + createHmac('sha256', SECRET.replace(/^whsec_/, '')).update(`evt_42.${ts}.${raw}`).digest('base64');
    expect(hook.headers['webhook-signature']).toBe(want);
    expect(hook.body).toEqual({ id: 'evt_42', type: 'post.published', created_at: '2026-11-21T11:59:00Z', data: { post_id: 5, status: 'published', platforms: ['facebook'] } });
    const patch = calls.find(c => c.method === 'PATCH')!;
    expect(patch.body).toMatchObject({ status: 'delivered', attempts: 1, last_code: 200 });
    expect((vi.mocked(fetch).mock.calls.find(c => String(c[0]).startsWith('https://hooks'))![1] as RequestInit).redirect).toBe('manual');
    expect(await sign(SECRET, 'evt_42', Number(ts), raw)).toBe(want);
  });
  it('a failure retries later with backoff; the last attempt marks it failed', async () => {
    let calls = world({ due: [delivery()], vault: { [secretName(7)]: SECRET }, hook: () => new Response('', { status: 500 }) });
    await deliverDue(cfg, fetch, NOW);
    expect(calls.find(c => c.method === 'PATCH')!.body).toEqual({ attempts: 1, last_code: 500, next_at: new Date(NOW + BACKOFF_MIN[0]! * 60_000).toISOString() });
    calls = world({ due: [delivery({ attempts: BACKOFF_MIN.length - 1 })], vault: { [secretName(7)]: SECRET }, hook: () => { throw new Error('timeout'); } });
    await deliverDue(cfg, fetch, NOW);
    expect(calls.find(c => c.method === 'PATCH')!.body).toEqual({ status: 'failed', attempts: BACKOFF_MIN.length, last_code: 0 });
  });
  it('no secret, a removed or paused webhook, or an address that is no longer allowed: failed without sending', async () => {
    for (const d of [delivery(), delivery({ webhook: null }), delivery({ webhook: { id: 7, url: 'https://hooks.example.com/well', active: false } }), delivery({ webhook: { id: 7, url: 'https://127.0.0.1/x', active: true } })]) {
      const calls = world({ due: [d] });
      await deliverDue(cfg, fetch, NOW);
      expect(calls.some(c => !c.url.startsWith('https://sb.example')), JSON.stringify(d.webhook)).toBe(false);
      expect(calls.find(c => c.method === 'PATCH')!.body).toMatchObject({ status: 'failed' });
    }
  });
});

describe('createWebhook', () => {
  it('stores the secret in the company’s Token Vault under WEBHOOK_SECRET_<id> and returns it once', async () => {
    const calls = world();
    const w = await createWebhook(cfg, WELL_COMPANY, 'owner@example.com', 'https://hooks.example.com/well', ['post.published']);
    expect(w).toMatchObject({ id: 7 });
    expect(w!.secret).toMatch(/^whsec_[A-Za-z0-9+/=]{32}$/);
    const put = calls.find(c => c.url.endsWith('/rpc/connector_put'))!;
    expect(put.body).toEqual({ p_name: 'WEBHOOK_SECRET_7', p_value: w!.secret });
    expect(JSON.stringify(calls.find(c => c.url.includes('/rest/v1/webhooks'))!.body)).not.toContain('whsec_');
  });
});
