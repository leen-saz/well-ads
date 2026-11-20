// Account health (src/lib/account-health.ts, docs/PRD.md §3.4, milestone M5): one-hour grace before «disconnected», one alert per
// change, a platform outage is not the account's fault, an expired token is final, nothing secret leaves.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { step, probe, runAccountHealth, GRACE_MS, type Row } from '../../src/lib/account-health';

const T0 = Date.parse('2026-11-20T10:07:00Z');
const H = 3600_000;
const run = (prev: Row | null, p: Parameters<typeof step>[1], at: number, exp: string | null = null) => step(prev, p, p === 'fail' ? 'meta_401_190' : null, exp, at, 'meta');

describe('step', () => {
  it('first failure: degraded with a one-hour grace, no alert', () => {
    const r = run(null, 'fail', T0);
    expect(r.row.status).toBe('degraded');
    expect(Date.parse(r.row.grace_until!)).toBe(T0 + GRACE_MS);
    expect(r.alert).toBeNull();
  });
  it('recovers inside the grace: ok, no alert at all', () => {
    const a = run(null, 'fail', T0), b = run(a.row, 'ok', T0 + 30 * 60_000);
    expect(b.row.status).toBe('ok'); expect(b.alert).toBeNull();
    expect(b.row.grace_until).toBeNull(); expect(b.row.error_code).toBeNull();
  });
  it('still failing inside the grace: stays degraded, same grace', () => {
    const a = run(null, 'fail', T0), b = run(a.row, 'fail', T0 + 59 * 60_000);
    expect(b.row.status).toBe('degraded'); expect(b.row.grace_until).toBe(a.row.grace_until); expect(b.alert).toBeNull();
  });
  it('failing after the grace: disconnected and ONE alert; later checks do not repeat it', () => {
    const a = run(null, 'fail', T0), b = run(a.row, 'fail', T0 + H), c = run(b.row, 'fail', T0 + 2 * H);
    expect(b.row.status).toBe('disconnected'); expect(b.alert).toBe('disconnected');
    expect(c.row.status).toBe('disconnected'); expect(c.alert).toBeNull();
  });
  it('back after a disconnect: ok and one «recovered»', () => {
    const b = run(run(null, 'fail', T0).row, 'fail', T0 + H), c = run(b.row, 'ok', T0 + 2 * H);
    expect(c.row.status).toBe('ok'); expect(c.alert).toBe('recovered');
    expect(run(c.row, 'ok', T0 + 3 * H).alert).toBeNull();
  });
  it('a platform outage (error) keeps the state as it was', () => {
    const a = run(null, 'fail', T0), b = run(a.row, 'error', T0 + 2 * H);
    expect(b.row.status).toBe('degraded'); expect(b.alert).toBeNull();
    expect(run(null, 'error', T0).row.status).toBe('ok');
  });
  it('expiring within 7 days: one alert; expired: disconnected at once, no grace', () => {
    const soon = new Date(T0 + 3 * 864e5).toISOString();
    const a = run(null, 'ok', T0, soon), b = run(a.row, 'ok', T0 + H, soon);
    expect(a.row.status).toBe('expiring'); expect(a.alert).toBe('expiring'); expect(b.alert).toBeNull();
    const gone = run(a.row, 'ok', T0 + 4 * 864e5, soon);
    expect(gone.row.status).toBe('disconnected'); expect(gone.alert).toBe('disconnected'); expect(gone.row.error_code).toBe('expired');
  });
  it('no probe available: the expiry alone decides', () => {
    expect(run(null, 'none', T0).row.status).toBe('ok');
    expect(run(null, 'none', T0).row.probed).toBe(false);
  });
});

describe('probe', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('Meta: token in the header, never in the address; 401 = fail with a code, 5xx = error', async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      seen.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') });
      return new Response(JSON.stringify({ error: { code: 190, message: 'token secret-text expired' } }), { status: 401 });
    });
    const [p, code] = await probe('meta', { META_ACCESS_TOKEN: 'tok-123' }, f as never);
    expect(p).toBe('fail'); expect(code).toBe('meta_401_190');
    expect(seen[0]!.url).not.toContain('tok-123'); expect(seen[0]!.auth).toBe('Bearer tok-123');
    const [p5] = await probe('meta', { META_ACCESS_TOKEN: 't' }, (async () => new Response('', { status: 503 })) as never);
    expect(p5).toBe('error');
    expect((await probe('meta', {}, f as never))[0]).toBe('none');
    expect((await probe('google_ads', { GOOGLE_ADS_REFRESH_TOKEN: 'x' }, f as never))[0]).toBe('none');
  });
});

describe('runAccountHealth', () => {
  const E: A.AuthEnv = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'owner@example.com' };
  const cfg = A.env(E);
  function fake(prev: Row[], conns: { platform: string; expires_at: string | null }[], metaStatus: number) {
    const writes: unknown[] = [], alerts: string[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes('graph.facebook.com')) return new Response('{}', { status: metaStatus });
      if (u.includes('hooks.example')) { alerts.push(String(init?.body)); return new Response('ok'); }
      if (u.includes('/account_health?company_id')) return new Response(JSON.stringify(prev));
      if (u.includes('/account_health?on_conflict')) { writes.push(JSON.parse(String(init?.body))); return new Response('[]', { status: 201 }); }
      if (u.includes('/connections?')) return new Response(JSON.stringify(conns));
      if (u.includes('/rpc/connector_env')) return new Response(JSON.stringify([{ name: 'META_ACCESS_TOKEN', value: 'tok-abc' }]));
      return new Response('[]');
    });
    vi.stubGlobal('fetch', f);
    return { f, writes, alerts };
  }
  afterEach(() => vi.unstubAllGlobals());

  it('hourly: checks every connection, writes one row each, scoped to the company, no secret in what it writes or sends', async () => {
    const { f, writes } = fake([], [{ platform: 'meta', expires_at: null }, { platform: 'ga4', expires_at: null }], 401);
    const r = await runAccountHealth(cfg, { ALERT_WEBHOOK_URL: 'https://hooks.example/x' }, { all: true, names: { meta: 'Meta' } }, f as never, T0);
    expect(r).toEqual({ checked: 2, alerts: 0 });
    const rows = writes[0] as Row[];
    expect(rows.map(x => [x.platform, x.status])).toEqual([['meta', 'degraded'], ['ga4', 'ok']]);
    expect(JSON.stringify(writes)).not.toContain('tok-abc');
  });
  it('5-minute run: only degraded accounts past their grace, then one alert', async () => {
    const prev: Row = { platform: 'meta', account_ref: '', status: 'degraded', probed: true, last_check_at: null, first_failed_at: new Date(T0 - H).toISOString(),
      grace_until: new Date(T0 - 1000).toISOString(), error_code: 'meta_401_190', expires_at: null, alerted_status: null };
    const { f, alerts } = fake([prev], [], 401);
    const r = await runAccountHealth(cfg, { ALERT_WEBHOOK_URL: 'https://hooks.example/x' }, { all: false, names: { meta: 'Meta' } }, f as never, T0);
    expect(r).toEqual({ checked: 1, alerts: 1 });
    expect(alerts[0]).toContain('Meta');
    expect(alerts[0]).not.toContain('tok-abc');
  });
  it('the table not created yet: does nothing', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ code: 'PGRST205' }), { status: 404 }));
    vi.stubGlobal('fetch', f);
    expect(await runAccountHealth(cfg, {}, { all: true, names: {} }, f as never, T0)).toEqual({ checked: 0, alerts: 0 });
  });
});
