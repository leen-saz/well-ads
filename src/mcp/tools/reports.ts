// Reports as background jobs (M17): reports.performance.create files the job, jobs.get reads its state and result.
import { enqueue, getJob } from '../jobs';
import { ToolFail, type Parsed, type Tool } from '../types';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_DAYS = 366;
type Period = { from: string; to: string };
const obj = (a: unknown): Record<string, unknown> => (a && typeof a === 'object' && !Array.isArray(a) ? a as Record<string, unknown> : {});

export function parseReport(args: unknown): Parsed<Period> {
  const a = obj(args);
  const extra = Object.keys(a).find(k => k !== 'from' && k !== 'to');
  if (extra) return { ok: false, error: `Unknown field: ${extra}` };
  if (typeof a.from !== 'string' || !DAY.test(a.from) || typeof a.to !== 'string' || !DAY.test(a.to)) return { ok: false, error: 'from and to: days as YYYY-MM-DD' };
  const days = (Date.parse(a.to) - Date.parse(a.from)) / 864e5 + 1;
  if (!(days >= 1)) return { ok: false, error: 'from must be on or before to' };
  if (days > MAX_DAYS) return { ok: false, error: `At most ${MAX_DAYS} days` };
  return { ok: true, value: { from: a.from, to: a.to } };
}

export const REPORT_TOOLS: Tool<never>[] = [
  { name: 'reports.performance.create', title: 'Performance report (background)', write: false,
    description: 'Spend, results, cost per result and click rate for a period and the period before it, overall and per platform. Answers with a job id; read it with jobs.get.',
    inputSchema: { type: 'object', required: ['from', 'to'], additionalProperties: false, properties: { from: { type: 'string', format: 'date' }, to: { type: 'string', format: 'date' } } },
    parse: parseReport,
    run: async (ctx, p: Period) => ({ job_id: await enqueue(ctx.cfg, ctx.company, 'report.performance', p, ctx.actor), status: 'queued' }),
  } as Tool<Period>,
  { name: 'jobs.get', title: 'Background job', write: false, description: 'The state of a background job and, once done, its result.',
    inputSchema: { type: 'object', required: ['job_id'], additionalProperties: false, properties: { job_id: { type: 'string' } } },
    parse: (a): Parsed<{ job_id: string }> => { const id = obj(a).job_id; return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? { ok: true, value: { job_id: id } } : { ok: false, error: 'job_id: the id reports.* returned' }; },
    run: async (ctx, p: { job_id: string }) => { const j = await getJob(ctx.cfg, ctx.company, p.job_id); if (!j) throw new ToolFail('not_found', 'No such job.'); return j; },
  } as Tool<{ job_id: string }>,
] as Tool<never>[];
