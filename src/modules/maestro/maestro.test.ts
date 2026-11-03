// Maestro: the Paperclip client (company-scoped paths, approval ownership check) and task validation. No network.
import { describe, expect, it, vi } from 'vitest';
import { budget, CHAT, chatLines, client, cleanTask, items, performance, PROJECT, tabOf } from './paperclip';

describe('paperclip client', () => {
  it('needs an https URL and a token', () => {
    expect(client({})).toBeNull();
    expect(client({ PAPERCLIP_URL: 'http://pc.example', PAPERCLIP_TOKEN: 't' })).toBeNull();
    expect(client({ PAPERCLIP_URL: 'https://pc.example/api/', PAPERCLIP_TOKEN: 't' })).not.toBeNull();
  });

  it('calls company-scoped paths with the board token', async () => {
    const calls: [string, RequestInit][] = [];
    const f = vi.fn(async (u: string, init: RequestInit) => { calls.push([u, init]); return new Response(JSON.stringify(u.includes('/issues') && init.method === 'POST' ? { id: 'i1' } : [{ id: 'a1' }])); }) as unknown as typeof fetch;
    const pc = client({ PAPERCLIP_URL: 'https://pc.example', PAPERCLIP_TOKEN: 'tok' }, f)!;
    expect(await pc.agents('c1')).toEqual([{ id: 'a1' }]);
    await pc.createIssue('c1', { title: 'x', description: 'y', priority: 'high', assigneeAgentId: 'a1' });
    expect(calls[0]![0]).toBe('https://pc.example/api/companies/c1/agents');
    expect((calls[0]![1].headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(JSON.parse(String(calls[1]![1].body))).toEqual({ title: 'x', description: 'y', status: 'todo', priority: 'high', assigneeAgentId: 'a1' });
    await expect(pc.agents('../other')).rejects.toThrow();
  });

  it("decides only approvals in the company's own pending list", async () => {
    const posted: string[] = [];
    const f = vi.fn(async (u: string, init: RequestInit) => {
      if (init.method === 'POST') posted.push(u);
      return new Response(JSON.stringify({ items: [{ id: 'mine' }] }));
    }) as unknown as typeof fetch;
    const pc = client({ PAPERCLIP_URL: 'https://pc.example', PAPERCLIP_TOKEN: 't' }, f)!;
    await pc.decide('c1', 'mine', 'approve');
    await expect(pc.decide('c1', 'someone-else', 'reject')).rejects.toThrow('موافقة غير معروفة');
    expect(posted).toEqual(['https://pc.example/api/approvals/mine/approve']);
  });

  it('accepts bare or wrapped lists and validates tasks', () => {
    expect(items([1])).toEqual([1]);
    expect(items({ data: [2] })).toEqual([2]);
    expect(items(null)).toEqual([]);
    expect(cleanTask({ title: '  ' })).toBeNull();
    expect(cleanTask({ title: 'مهمة', priority: 'nope', assigneeAgentId: 'bad id!' })).toEqual({ title: 'مهمة', description: '', priority: 'medium' });
  });

  it("puts a tab's task in that tab's project, made once", async () => {
    const projects: { id: string; name: string }[] = [];
    const f = vi.fn(async (u: string, init: RequestInit) => {
      if (u.endsWith('/projects') && init.method === 'POST') { const p = { id: 'p' + (projects.length + 1), name: JSON.parse(String(init.body)).name }; projects.push(p); return new Response(JSON.stringify(p)); }
      return new Response(JSON.stringify(projects));
    }) as unknown as typeof fetch;
    const pc = client({ PAPERCLIP_URL: 'https://pc.example', PAPERCLIP_TOKEN: 't' }, f)!;
    expect(await pc.projectFor('c1', 'social', 'السوشال')).toBe('p1');
    expect(await pc.projectFor('c1', 'social', 'السوشال')).toBe('p1');
    expect(projects).toEqual([{ id: 'p1', name: 'Well · social' }]);
    expect(tabOf(PROJECT('design'))).toBe('design');
    expect(tabOf('Other project')).toBeNull();
    expect(cleanTask({ title: 'x', tab: 'social' })?.tab).toBe('social');
    expect(cleanTask({ title: 'x', tab: '../x' })?.tab).toBeUndefined();
  });

  it('reads a monthly budget (0 = no cap)', () => {
    expect(budget({ budgetMonthlyCents: 10000, spentMonthlyCents: 2500 })).toEqual({ cap: 10000, spent: 2500, pct: 25 });
    expect(budget({ budgetMonthlyCents: 0, spentMonthlyCents: 700 })).toEqual({ cap: 0, spent: 700, pct: null });
    expect(budget(null)).toEqual({ cap: 0, spent: 0, pct: null });
  });

  it("sums an agent's card from runs, done tasks and cost", () => {
    const since = Date.parse('2026-11-01T00:00:00Z');
    const p = performance({
      cost: { agentId: 'a1', costCents: 1234.4 },
      runs: [
        { status: 'succeeded', startedAt: '2026-11-02T10:00:00Z' }, { status: 'succeeded', startedAt: '2026-11-02T11:00:00Z' },
        { status: 'failed', startedAt: '2026-11-03T09:00:00Z', finishedAt: '2026-11-03T09:05:00Z', error: 'timeout calling xAI' },
        { status: 'running', startedAt: '2026-11-03T12:00:00Z' }, { status: 'failed', startedAt: '2026-10-20T00:00:00Z' },
      ],
      done: [
        { startedAt: '2026-11-02T10:00:00Z', completedAt: '2026-11-02T10:30:00Z' }, { startedAt: '2026-11-02T11:00:00Z', completedAt: '2026-11-02T12:30:00Z' },
        { startedAt: '2026-10-01T00:00:00Z', completedAt: '2026-10-02T00:00:00Z' },
      ],
    }, since);
    expect(p).toEqual({ done: 2, spentCents: 1234, runs: 3, successRate: 67, avgTaskMinutes: 60, lastRunAt: '2026-11-03T12:00:00.000Z', lastError: 'timeout calling xAI' });
    expect(performance({ cost: null, runs: null, done: null }, since)).toEqual({ done: null, spentCents: null, runs: null, successRate: null, avgTaskMinutes: null, lastRunAt: null, lastError: null });
  });

  it('reads agent inputs and survives a missing source', async () => {
    const f = vi.fn(async (u: string) => u.includes('heartbeat-runs') ? new Response('{"error":"nope"}', { status: 404 }) : new Response(JSON.stringify(u.includes('costs') ? [{ agentId: 'a1', costCents: 5 }, { agentId: 'a2', costCents: 9 }] : [{ id: 'i1' }]))) as unknown as typeof fetch;
    const pc = client({ PAPERCLIP_URL: 'https://pc.example', PAPERCLIP_TOKEN: 't' }, f)!;
    expect(await pc.agentInputs('c1', 'a1', '2026-11-01T00:00:00.000Z')).toEqual({ cost: { agentId: 'a1', costCents: 5 }, runs: null, done: [{ id: 'i1' }] });
    await expect(pc.agentInputs('c1', 'a/1', 'x')).rejects.toThrow();
  });

  it("chats on one issue assigned to the CEO, reopening it when closed", async () => {
    const calls: [string, string, unknown][] = [];
    let issues: Record<string, unknown>[] = [];
    const f = vi.fn(async (u: string, init: RequestInit) => {
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push([init.method!, u.replace('https://pc.example/api', ''), body]);
      if (u.includes('/agents')) return new Response(JSON.stringify([{ id: 'w1', role: 'general' }, { id: 'ceo1', role: 'ceo' }]));
      if (init.method === 'POST') { const i = { id: 'i9', ...body }; issues = [i]; return new Response(JSON.stringify(i)); }
      if (init.method === 'PATCH') return new Response('{}');
      return new Response(JSON.stringify(issues));
    }) as unknown as typeof fetch;
    const pc = client({ PAPERCLIP_URL: 'https://pc.example', PAPERCLIP_TOKEN: 't' }, f)!;
    expect(await pc.chatIssue('c1', false)).toBeNull();
    const made = (await pc.chatIssue('c1', true))!;
    expect(made).toMatchObject({ id: 'i9', title: CHAT, assigneeAgentId: 'ceo1' });
    expect((await pc.chatIssue('c1', true))!.id).toBe('i9');
    await pc.say({ id: 'i9', status: 'done' }, 'مرحبا');
    expect(calls.at(-1)).toEqual(['PATCH', '/issues/i9', { comment: 'مرحبا', status: 'todo' }]);
    await pc.say({ id: 'i9', status: 'in_progress' }, 'ثاني');
    expect(calls.at(-1)).toEqual(['PATCH', '/issues/i9', { comment: 'ثاني' }]);
    await expect(pc.comments('../x')).rejects.toThrow();
  });

  it('turns comments into chat lines, oldest first', () => {
    expect(chatLines([
      { body: 'تم', authorAgentId: 'ceo1', createdAt: '2026-11-04T10:05:00Z' },
      { body: 'وزع المهام', authorUserId: 'u1', createdAt: '2026-11-04T10:00:00Z' },
    ], { ceo1: 'CEO' })).toEqual([
      { agent: false, name: 'أنت', body: 'وزع المهام', at: '2026-11-04T10:00:00Z' },
      { agent: true, name: 'CEO', body: 'تم', at: '2026-11-04T10:05:00Z' },
    ]);
  });
});
