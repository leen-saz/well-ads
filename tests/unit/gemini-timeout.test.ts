// Gemini generateContent: every call has a deadline, and a slow or overloaded provider says «busy» instead of hanging or a bare failure.
import { describe, expect, it, vi } from 'vitest';
import { gemini } from '../../src/lib/gemini';

const E = { GEMINI_API_KEY: 'k' };
const IN = { parts: [{ text: 'x' }], max_tokens: 5 };
const as = (f: unknown) => f as typeof fetch;

describe('gemini() deadline', () => {
  it('passes a signal with every call', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] })));
    await gemini(E, 'vision', IN, as(f));
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].signal).toBeInstanceOf(AbortSignal);
  });
  it('a call past its deadline is rate_limited (busy), not failed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const spy = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => { const c = new AbortController(); c.abort(); return c.signal; });
    await expect(gemini(E, 'vision', IN, as(async () => { throw new Error('aborted'); }))).rejects.toMatchObject({ code: 'rate_limited' });
    spy.mockRestore(); warn.mockRestore();
  });
  it('503 (overloaded) is busy; 500 stays failed; a caller abort stays failed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(gemini(E, 'vision', IN, as(async () => new Response('', { status: 503 })))).rejects.toMatchObject({ code: 'rate_limited' });
    await expect(gemini(E, 'vision', IN, as(async () => new Response('', { status: 500 })))).rejects.toMatchObject({ code: 'failed', status: 500 });
    const c = new AbortController(); c.abort();
    await expect(gemini(E, 'vision', IN, as(async () => { throw new Error('aborted'); }), undefined, c.signal)).rejects.toMatchObject({ code: 'failed' });
    warn.mockRestore();
  });
});
