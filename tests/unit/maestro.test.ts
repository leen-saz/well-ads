// Maestro: the Paperclip client (company-scoped paths, approval ownership check) and task validation. No network.
import { describe, expect, it, vi } from 'vitest';
import { client, cleanTask, items } from '../../src/lib/paperclip';

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
});
