// Grok live search and OpenAI image calls have deadlines, and a hung provider ends as the existing «null / failed» answer, never a hang.
import { describe, expect, it, vi } from 'vitest';
import { GROK_SEARCH_MS, IMAGE_MS, TEXT_TIMEOUT_MS, grokSearch, imageOf } from '../../src/lib/llm';

const as = (f: unknown) => f as typeof fetch;
const sig = (f: ReturnType<typeof vi.fn>) => (f.mock.calls[0] as unknown as [string, RequestInit])[1].signal;
const expired = () => vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => { const c = new AbortController(); c.abort(); return c.signal; });

describe('grokSearch and imageOf deadlines', () => {
  it('are longer than the plain text deadline', () => {
    expect(GROK_SEARCH_MS).toBeGreaterThan(TEXT_TIMEOUT_MS);
    expect(IMAGE_MS).toBeGreaterThan(GROK_SEARCH_MS);
  });
  it('grokSearch passes a signal and a hung call returns null', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = vi.fn(async () => new Response(JSON.stringify({ output_text: 'x' })));
    await grokSearch({ XAI_API_KEY: 'k' }, [{ role: 'user', content: 'q' }], ['web'], 100, as(f));
    expect(sig(f)).toBeInstanceOf(AbortSignal);
    const spy = expired();
    expect(await grokSearch({ XAI_API_KEY: 'k' }, [{ role: 'user', content: 'q' }], ['web'], 100, as(async () => { throw new Error('aborted'); }))).toBeNull();
    spy.mockRestore(); warn.mockRestore();
  });
  it('imageOf passes a signal on new and edit, and a hung call is failed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: 'QQ==' }] })));
    await imageOf({ OPENAI_API_KEY: 'k' }, 'p', as(f));
    expect(sig(f)).toBeInstanceOf(AbortSignal);
    const g = vi.fn(async () => new Response(JSON.stringify({ data: [{ b64_json: 'QQ==' }] })));
    await imageOf({ OPENAI_API_KEY: 'k' }, 'p', as(g), { bytes: new Uint8Array([1]), mime: 'image/png' });
    expect(sig(g)).toBeInstanceOf(AbortSignal);
    const spy = expired();
    expect(await imageOf({ OPENAI_API_KEY: 'k' }, 'p', as(async () => { throw new Error('aborted'); }))).toMatchObject({ image: null, miss: 'failed' });
    spy.mockRestore(); warn.mockRestore();
  });
});
