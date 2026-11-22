// Background jobs (docs/PRD.md §3.0, M17; table 046_jobs.sql). A heavy tool files a job and answers with its id at once; the
// 5-minute cron runs queued jobs (a few per run) and stores the result; jobs.get reads it back for the same company only.
import { sb, missingSchema, type Cfg } from '../lib/auth';
import { loadDash } from '../lib/apiv1';
import { performance } from '../lib/perf';
import { WELL_COMPANY } from '../lib/tenant';
import { ToolFail } from './types';

export const JOB_KINDS = ['report.performance'] as const;
export type JobKind = (typeof JOB_KINDS)[number];
export const MAX_OPEN = 10;        // queued or running jobs per company
export const BATCH = 2;            // jobs per cron run
type Row = Record<string, unknown>;
const rows = (d: unknown): Row[] => (Array.isArray(d) ? (d as Row[]) : []);

export async function enqueue(cfg: Cfg, company: string, kind: JobKind, input: Record<string, unknown>, actor: string): Promise<string> {
  const open = await sb<Row[]>(cfg, `/rest/v1/mcp_jobs?company_id=eq.${company}&status=in.(queued,running)&select=id&limit=${MAX_OPEN}`, { admin: true });
  if (!open.ok) throw new ToolFail('unavailable', missingSchema(open) ? 'Background jobs are not set up yet.' : 'Try again shortly.');
  if (rows(open.data).length >= MAX_OPEN) throw new ToolFail('conflict', `Up to ${MAX_OPEN} jobs at a time. Wait for one to finish.`);
  const w = await sb<Row[]>(cfg, '/rest/v1/mcp_jobs', { method: 'POST', admin: true, headers: { Prefer: 'return=representation' }, body: { company_id: company, kind, input, actor } });
  const id = w.ok ? String(rows(w.data)[0]?.id || '') : '';
  if (!id) throw new ToolFail('failed', 'The job was not filed.');
  return id;
}

export async function getJob(cfg: Cfg, company: string, id: string): Promise<Row | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const r = await sb<Row[]>(cfg, `/rest/v1/mcp_jobs?id=eq.${id}&company_id=eq.${company}&select=id,kind,status,input,result,error,created_at,started_at,finished_at`, { admin: true });
  return r.ok ? rows(r.data)[0] ?? null : null;
}

async function run(kind: string, input: Row, env: { FILES?: R2Bucket }, company: string): Promise<unknown> {
  if (kind === 'report.performance') {
    // The dashboard file is Well's; another company has none yet
    if (company !== WELL_COMPANY) throw new Error('no_data');
    const d = await loadDash(env as never);
    if (!d) throw new Error('no_data');
    return performance(d, String(input.from), String(input.to));
  }
  throw new Error('unknown_kind');
}

/** Runs what is queued, oldest first. Returns how many ran. */
export async function runJobs(cfg: Cfg, env: { FILES?: R2Bucket }, now = Date.now()): Promise<number> {
  const q = await sb<Row[]>(cfg, `/rest/v1/mcp_jobs?status=eq.queued&order=created_at.asc&limit=${BATCH}&select=id,company_id,kind,input`, { admin: true });
  if (!q.ok) return 0;
  let n = 0;
  for (const j of rows(q.data)) {
    // Claim it: a second cron run finds it taken
    const c = await sb<Row[]>(cfg, `/rest/v1/mcp_jobs?id=eq.${j.id}&status=eq.queued`, { method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' }, body: { status: 'running', started_at: new Date(now).toISOString() } });
    if (!c.ok || !rows(c.data).length) continue;
    n++;
    let patch: Row;
    try { patch = { status: 'done', result: await run(String(j.kind), (j.input as Row) || {}, env, String(j.company_id)) }; }
    catch (e) { patch = { status: 'failed', error: e instanceof Error && /^[a-z_]{1,40}$/.test(e.message) ? e.message : 'failed' }; }
    await sb(cfg, `/rest/v1/mcp_jobs?id=eq.${j.id}`, { method: 'PATCH', admin: true, body: { ...patch, finished_at: new Date().toISOString() } });
  }
  return n;
}
