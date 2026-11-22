/* eslint-disable @typescript-eslint/no-explicit-any -- synthetic dashboard rows and recorded bodies are read loosely */
// M17: performance numbers, daily alerts, and background jobs. Synthetic numbers only.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { alertText, perfAlerts, performance, MIN_SPEND } from '../../src/lib/perf';
import { runJobs } from '../../src/mcp/jobs';
import { callTool } from '../../src/mcp/call';
import { parseReport } from '../../src/mcp/tools/reports';
import { WELL_COMPANY } from '../../src/lib/tenant';
import { hourlyTasks } from '../../src/lib/cron';

const day = (n: number) => new Date(Date.UTC(2026, 10, 1 + n)).toISOString().slice(0, 10);
// One Meta ad: 8 steady days (200 SAR, 10 leads), then the last day as given
function dash(last: { spend: number; leads: number }) {
  const rows: unknown[][] = [];
  for (let i = 0; i < 8; i++) rows.push(['m1', day(i), 200, 10000, 200, 10, 0]);
  rows.push(['m1', day(8), last.spend, 10000, 200, last.leads, 0]);
  return { generated_at: '2026-11-10T00:00:00Z', range: { start: day(0), end: day(8) }, ads: { m1: { name: 'A', campaign: 'C', platform: 'facebook', goal: 'lead', status: 'ACTIVE', live: true } }, rows } as any;
}
const cfg = { url: 'https://sb.example', anon: 'anon', service: 'service' } as never;
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('performance', () => {
  it('the period and the same-length one before it, overall and per platform', () => {
    const r = performance(dash({ spend: 200, leads: 10 }), day(5), day(8));
    expect(r.period).toEqual({ from: day(5), to: day(8), days: 4 });
    expect(r.previous).toEqual({ from: day(1), to: day(4) });
    expect(r.total.now).toMatchObject({ spend: 800, leads: 40, cpl: 20 });
    expect(r.platforms.facebook!.before).toMatchObject({ spend: 800, leads: 40 });
  });
});

describe('daily alerts', () => {
  it('spend without results, and a cost per result 1.5× the week, are flagged; a normal day is not', () => {
    expect(perfAlerts(dash({ spend: 200, leads: 10 }))).toEqual([]);
    expect(perfAlerts(dash({ spend: 300, leads: 0 }))).toEqual([{ platform: 'facebook', code: 'no_results', day: day(8), spend: 300, cpl: null, base_cpl: 20 }]);
    expect(perfAlerts(dash({ spend: 300, leads: 5 }))).toEqual([{ platform: 'facebook', code: 'cpl_up', day: day(8), spend: 300, cpl: 60, base_cpl: 20 }]);
    expect(perfAlerts(dash({ spend: MIN_SPEND - 1, leads: 0 }))).toEqual([]);
  });
  it('one plain Arabic message with every alert; nothing to say, no message', () => {
    expect(alertText([])).toBeNull();
    const m = alertText(perfAlerts(dash({ spend: 300, leads: 0 })))!;
    expect(m.subject).toContain('تنبيه أداء');
    expect(m.text).toContain('ميتا: صرف 300 ريال');
  });
  it('runs daily at 06:xx UTC only', () => {
    const at = (h: number) => hourlyTasks(new Date(Date.UTC(2026, 10, 18, h, 7)));
    expect(at(6)).toContain('perf');
    for (const h of [0, 1, 5, 7, 23]) expect(at(h)).not.toContain('perf');
  });
});

describe('background jobs', () => {
  function world(jobs: any[] = [], open = 0) {
    const calls: { url: string; method: string; body: any }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, init: RequestInit = {}) => {
      const url = String(u), method = init.method || 'GET';
      const body = init.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url, method, body });
      const j = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
      if (url.includes('/mcp_jobs?company_id=eq.') && url.includes('status=in.')) return j(Array.from({ length: open }, (_, i) => ({ id: String(i) })));
      if (url.includes('/mcp_jobs?status=eq.queued')) return j(jobs);
      if (url.includes('/mcp_jobs?id=eq.') && method === 'PATCH' && url.includes('status=eq.queued')) return j([{ id: 'x' }]);
      if (url.endsWith('/rest/v1/mcp_jobs') && method === 'POST') return j([{ id: '22222222-2222-4222-8222-222222222222' }], 201);
      return j([]);
    }));
    return calls;
  }
  const files = (d: unknown) => ({ async get(k: string) { return k === 'site/dash.json' ? { json: async () => d } : null; } }) as unknown as R2Bucket;

  it('reports.performance.create files a job and answers with its id; at most 10 open per company', async () => {
    world();
    const ctx = { cfg, env: {}, company: WELL_COMPANY, actor: 'api' as const, scope: 'read' as const, mode: 'approve' as const };
    expect(await callTool(ctx, 'reports.performance.create', { from: day(0), to: day(8) })).toEqual({ ok: true, data: { job_id: '22222222-2222-4222-8222-222222222222', status: 'queued' } });
    world([], 10);
    expect(await callTool(ctx, 'reports.performance.create', { from: day(0), to: day(8) })).toMatchObject({ ok: false, error: { code: 'conflict' } });
  });
  it('the cron claims a queued job, runs it and stores the numbers; no data is a short failure code', async () => {
    let calls = world([{ id: 'j1', company_id: WELL_COMPANY, kind: 'report.performance', input: { from: day(5), to: day(8) } }]);
    expect(await runJobs(cfg, { FILES: files(dash({ spend: 200, leads: 10 })) })).toBe(1);
    const done = calls.filter(c => c.method === 'PATCH').map(c => c.body);
    expect(done[0]).toMatchObject({ status: 'running' });
    expect(done[1]).toMatchObject({ status: 'done', result: { period: { from: day(5), to: day(8) } } });
    calls = world([{ id: 'j2', company_id: WELL_COMPANY, kind: 'report.performance', input: { from: day(5), to: day(8) } }]);
    await runJobs(cfg, {});
    expect(calls.filter(c => c.method === 'PATCH')[1]!.body).toMatchObject({ status: 'failed', error: 'no_data' });
  });
  it('the period: days as YYYY-MM-DD, in order, at most a year', () => {
    expect(parseReport({ from: '2026-01-01', to: '2026-03-31' }).ok).toBe(true);
    expect(parseReport({ from: '2025-01-01', to: '2026-03-31' }).ok).toBe(false);
    expect(parseReport({ from: '2026-03-31', to: '2026-01-01' }).ok).toBe(false);
    expect(parseReport({ from: '2026-01-01' }).ok).toBe(false);
    expect(parseReport({ from: '2026-01-01', to: '2026-01-02', company: 'x' }).ok).toBe(false);
  });
});
