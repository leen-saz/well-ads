// Paperclip (MIT, self-hosted) runs the agents: org chart, tasks (issues), budgets and board approvals.
// The Worker talks to it with a board token as the system (Worker secrets PAPERCLIP_URL + PAPERCLIP_TOKEN, set by Leen).
// Every call is under one Paperclip company, mapped from our company (companies.paperclip_company_id).
// Docs: https://docs.paperclip.ing/reference/api/overview.md

export interface PcEnv { PAPERCLIP_URL?: string; PAPERCLIP_TOKEN?: string }
export interface Task { title: string; description: string; priority: 'low' | 'medium' | 'high' | 'urgent'; assigneeAgentId?: string; tab?: string; projectId?: string }
type Json = Record<string, unknown>;

export const STATUS: Record<string, string> = { backlog: 'بالانتظار', todo: 'جاهزة', in_progress: 'شغالة', in_review: 'للمراجعة', blocked: 'متوقفة', done: 'خلصت', cancelled: 'ملغية' };
const ID = /^[A-Za-z0-9_-]{1,64}$/;

// Each tab's agents work in one Paperclip project, «Well · <tab key>», made on first use. A task for a tab lands there,
// and the agent it is assigned to (or the CEO agent, who routes unassigned work) picks it up on its next heartbeat.
export const PROJECT = (tab: string) => `Well · ${tab}`;
export const tabOf = (name: unknown): string | null => { const m = /^Well · ([a-z]+)$/.exec(String(name || '')); return m ? m[1]! : null; };

// List endpoints are documented without an example shape: accept a bare array or a wrapped one
export const items = (d: unknown): Json[] => (Array.isArray(d) ? d : Array.isArray((d as Json)?.items) ? (d as Json).items : Array.isArray((d as Json)?.data) ? (d as Json).data : []) as Json[];

export function client(e: PcEnv, f: typeof fetch = fetch) {
  const base = (e.PAPERCLIP_URL || '').trim().replace(/\/+$/, '').replace(/\/api$/, '');
  const token = (e.PAPERCLIP_TOKEN || '').trim();
  if (!/^https:\/\//.test(base) || !token) return null;
  const call = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const r = await f(`${base}/api${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await r.text();
    const data = text ? JSON.parse(text) : null;
    if (!r.ok) throw new Error(String((data as Json)?.error || `Paperclip ${r.status}`));
    return data;
  };
  const co = (id: string) => { if (!ID.test(id)) throw new Error('bad company'); return `/companies/${id}`; };
  return {
    createCompany: async (name: string, budgetMonthlyCents = 0) => (await call('POST', '/companies', { name, description: 'Well Ads SaaS tenant', budgetMonthlyCents })) as Json,
    company: async (c: string) => (await call('GET', co(c))) as Json,
    agents: async (c: string) => items(await call('GET', `${co(c)}/agents`)),
    issues: async (c: string) => items(await call('GET', `${co(c)}/issues?limit=100`)),
    createIssue: async (c: string, t: Task) => (await call('POST', `${co(c)}/issues`, { title: t.title, description: t.description, status: 'todo', priority: t.priority, ...(t.assigneeAgentId ? { assigneeAgentId: t.assigneeAgentId } : {}), ...(t.projectId ? { projectId: t.projectId } : {}) })) as Json,
    projects: async (c: string) => items(await call('GET', `${co(c)}/projects`)),
    // The tab's project, made the first time a task is sent to that tab
    projectFor: async (c: string, tab: string, label: string): Promise<string> => {
      const found = items(await call('GET', `${co(c)}/projects`)).find(p => p.name === PROJECT(tab));
      if (found?.id) return String(found.id);
      const made = (await call('POST', `${co(c)}/projects`, { name: PROJECT(tab), description: `مهام تاب «${label}» في لوحة Well` })) as Json;
      if (!made?.id) throw new Error('no project');
      return String(made.id);
    },
    // An agent's performance inputs. heartbeat-runs and costs?from= are in Paperclip's code but not its docs: a source
    // that fails comes back null and the card shows what it has.
    agentInputs: async (c: string, agentId: string, from: string) => {
      if (!ID.test(agentId)) throw new Error('bad agent');
      const q = (p: string) => call('GET', p).catch(() => null);
      const [costs, runs, done] = await Promise.all([q(`${co(c)}/costs/by-agent?from=${encodeURIComponent(from)}`), q(`${co(c)}/heartbeat-runs?agentId=${agentId}&limit=100`), q(`${co(c)}/issues?assigneeAgentId=${agentId}&status=done&limit=100`)]);
      return { cost: costs === null ? null : items(costs).find(r => r.agentId === agentId) || {}, runs: runs === null ? null : items(runs), done: done === null ? null : items(done) };
    },
    approvals: async (c: string) => items(await call('GET', `${co(c)}/approvals?status=pending`)),
    // only approvals that belong to this company: checked against its own pending list first
    decide: async (c: string, approvalId: string, act: 'approve' | 'reject') => {
      if (!ID.test(approvalId) || !items(await call('GET', `${co(c)}/approvals?status=pending`)).some(a => a.id === approvalId)) throw new Error('موافقة غير معروفة');
      return call('POST', `/approvals/${approvalId}/${act}`, {});
    },
  };
}

export function cleanTask(b: Json): Task | null {
  const title = String(b.title || '').trim().slice(0, 200);
  const description = String(b.description || '').trim().slice(0, 10000);
  if (!title) return null;
  const priority = (['low', 'medium', 'high', 'urgent'] as const).find(p => p === b.priority) || 'medium';
  const a = String(b.assigneeAgentId || ''), tab = String(b.tab || '');
  return { title, description, priority, ...(ID.test(a) ? { assigneeAgentId: a } : {}), ...(/^[a-z]{1,32}$/.test(tab) ? { tab } : {}) };
}

// A task's description with the company's knowledge after it (capped: Paperclip keeps descriptions up to 10,000 here)
export const withBrief = (description: string, knowledge: string): string =>
  knowledge ? `${description}\n\n---\nمعرفة الشركة (من تاب المعرفة، التزم فيها):\n${knowledge}`.slice(0, 16000) : description;

// A month's budget in cents (Paperclip: 0 = no cap) → what the board shows
export const budget = (b: Json | null | undefined) => {
  const cap = Number(b?.budgetMonthlyCents) || 0, spent = Number(b?.spentMonthlyCents) || 0;
  return { cap, spent, pct: cap > 0 ? Math.min(100, Math.round((spent / cap) * 100)) : null };
};

// An agent's card for a period: tasks done, spend, run success rate, average task time, last error. Numbers only.
const at = (x: Json, ...ks: string[]) => { for (const k of ks) { const t = Date.parse(String(x[k] ?? '')); if (t) return t; } return 0; };
export function performance(inp: { cost: Json | null; runs: Json[] | null; done: Json[] | null }, since: number) {
  const runs = inp.runs?.filter(r => at(r, 'startedAt', 'createdAt', 'started_at') >= since) ?? null;
  const ended = runs?.filter(r => !['queued', 'scheduled_retry', 'running'].includes(String(r.status))) ?? [];
  const ok = ended.filter(r => r.status === 'succeeded').length;
  const done = inp.done?.filter(i => at(i, 'completedAt', 'completed_at', 'updatedAt') >= since) ?? null;
  const spans = (done || []).map(i => at(i, 'completedAt', 'completed_at') - at(i, 'startedAt', 'started_at')).filter(ms => ms > 0);
  const failed = ended.filter(r => r.status === 'failed' || r.status === 'timed_out').sort((a, b) => at(b, 'finishedAt', 'startedAt') - at(a, 'finishedAt', 'startedAt'))[0];
  return {
    done: done ? done.length : null,
    spentCents: inp.cost ? Math.round(Number(inp.cost.costCents) || 0) : null,
    runs: runs ? ended.length : null,
    successRate: ended.length ? Math.round((ok / ended.length) * 100) : null,
    avgTaskMinutes: spans.length ? Math.round(spans.reduce((a, b) => a + b, 0) / spans.length / 60000) : null,
    lastRunAt: runs?.length ? new Date(Math.max(...runs.map(r => at(r, 'startedAt', 'createdAt')))).toISOString() : null,
    lastError: failed ? String(failed.error || failed.status).slice(0, 200) : null,
  };
}
