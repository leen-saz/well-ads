// Paperclip (MIT, self-hosted) runs the agents: org chart, tasks (issues), budgets and board approvals.
// The Worker talks to it with a board token as the system (Worker secrets PAPERCLIP_URL + PAPERCLIP_TOKEN, set by Leen).
// Every call is under one Paperclip company, mapped from our company (companies.paperclip_company_id).
// Docs: https://docs.paperclip.ing/reference/api/overview.md

export interface PcEnv { PAPERCLIP_URL?: string; PAPERCLIP_TOKEN?: string }
export interface Task { title: string; description: string; priority: 'low' | 'medium' | 'high' | 'urgent'; assigneeAgentId?: string }
type Json = Record<string, unknown>;

export const STATUS: Record<string, string> = { backlog: 'بالانتظار', todo: 'جاهزة', in_progress: 'شغالة', in_review: 'للمراجعة', blocked: 'متوقفة', done: 'خلصت', cancelled: 'ملغية' };
const ID = /^[A-Za-z0-9_-]{1,64}$/;

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
    agents: async (c: string) => items(await call('GET', `${co(c)}/agents`)),
    issues: async (c: string) => items(await call('GET', `${co(c)}/issues?limit=100`)),
    createIssue: async (c: string, t: Task) => (await call('POST', `${co(c)}/issues`, { title: t.title, description: t.description, status: 'todo', priority: t.priority, ...(t.assigneeAgentId ? { assigneeAgentId: t.assigneeAgentId } : {}) })) as Json,
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
  const a = String(b.assigneeAgentId || '');
  return { title, description, priority, ...(ID.test(a) ? { assigneeAgentId: a } : {}) };
}
