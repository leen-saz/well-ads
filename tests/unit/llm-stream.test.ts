// Unified streaming (src/lib/llm.ts): SSE across chunk boundaries, each provider's events, a failure mid-stream, the fallback to Workers AI, and stop.
import { describe, expect, it, vi } from 'vitest';
import { sse, stream, sseResponse, STREAM_IDLE_MS, type StreamEvent, type LlmEnv } from '../../src/lib/llm';

const enc = new TextEncoder();
// A body that delivers the given pieces one by one (so a chunk can end mid-event), then ends or fails
const body = (parts: string[], fail = false) => { const q = [...parts]; return new ReadableStream<Uint8Array>({
  pull(c) { const p = q.shift(); if (p !== undefined) c.enqueue(enc.encode(p)); else if (fail) c.error(new Error('cut')); else c.close(); },
}); };
const ev = (o: unknown, name = '') => `${name ? `event: ${name}\n` : ''}data: ${JSON.stringify(o)}\n\n`;
const delta = (t: string) => ev({ type: 'response.output_text.delta', delta: t });
const completed = (i = 10, o = 5) => ev({ type: 'response.completed', response: { usage: { input_tokens: i, output_tokens: o } } });
const collect = async (g: AsyncGenerator<StreamEvent>) => { const out: StreamEvent[] = []; for await (const x of g) out.push(x); return out; };
const IN = { messages: [{ role: 'user', content: 'hi' }], max_tokens: 50 };
const sseRes = (parts: string[], fail = false, status = 200) => new Response(status === 200 ? body(parts, fail) : 'x', { status });
const fake = (r: () => Response) => vi.fn(async () => r()) as unknown as typeof fetch;
const workers = (parts: string[]) => ({ run: vi.fn(async () => body(parts)) }) as unknown as NonNullable<LlmEnv['AI']>;
const wk = (t: string) => `data: ${JSON.stringify({ response: t })}\n\n`;

describe('sse parser', () => {
  it('joins an event split across chunks, handles CRLF and a final event without a blank line', async () => {
    const got: { event: string; data: string }[] = [];
    for await (const m of sse(body(['event: a\r\nda', 'ta: {"x":1}\r\n\r\ndata: two', '\n\ndata: tail']))) got.push(m);
    expect(got).toEqual([{ event: 'a', data: '{"x":1}' }, { event: '', data: 'two' }, { event: '', data: 'tail' }]);
  });
  it('keeps multibyte characters whole when a chunk cuts them', async () => {
    const bytes = enc.encode('data: مرحبا\n\n');
    const stream1 = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes.slice(0, 8)); c.enqueue(bytes.slice(8)); c.close(); } });
    const got: string[] = [];
    for await (const m of sse(stream1)) got.push(m.data);
    expect(got).toEqual(['مرحبا']);
  });
});

describe('stream: OpenAI and Grok (Responses API)', () => {
  it('yields deltas as they arrive, then done with the full text and the token counts', async () => {
    const f = fake(() => sseRes([delta('مر'), delta('حبا'), completed(12, 3)]));
    const out = await collect(stream({ OPENAI_API_KEY: 'k' }, 'copy', IN, f));
    expect(out.filter(x => x.type === 'delta').map(x => (x as { text: string }).text)).toEqual(['مر', 'حبا']);
    expect(out.at(-1)).toMatchObject({ type: 'done', response: 'مرحبا', engine: 'openai', usage: { in: 12, out: 3 } });
    expect(JSON.parse(String((f as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]![1].body)).stream).toBe(true);
  });
  it('partial chunks: an event cut in the middle still arrives once', async () => {
    const whole = delta('hello') + completed();
    const out = await collect(stream({ XAI_API_KEY: 'k' }, 'social', IN, fake(() => sseRes([whole.slice(0, 20), whole.slice(20, 60), whole.slice(60)]))));
    expect(out.map(x => x.type)).toEqual(['delta', 'done']);
    expect(out.at(-1)).toMatchObject({ response: 'hello', engine: 'xai' });
  });
  it('a refused request before any text falls back to Workers AI without a reset', async () => {
    const e: LlmEnv = { OPENAI_API_KEY: 'k', AI: workers([wk('من '), wk('ورکرز')]) };
    const out = await collect(stream(e, 'copy', IN, fake(() => sseRes([], false, 500))));
    expect(out.map(x => x.type)).toEqual(['delta', 'delta', 'done']);
    expect(out.at(-1)).toMatchObject({ engine: 'workers', response: 'من ورکرز' });
  });
});

describe('stream: provider failure mid-stream', () => {
  it('after some text: reset, then Workers AI answers from the start', async () => {
    const e: LlmEnv = { OPENAI_API_KEY: 'k', AI: workers([wk('بديل')]) };
    const out = await collect(stream(e, 'copy', IN, fake(() => sseRes([delta('نص نص'), ev({ type: 'response.failed' })]))));
    expect(out.map(x => x.type)).toEqual(['delta', 'reset', 'delta', 'done']);
    expect(out.at(-1)).toMatchObject({ engine: 'workers', response: 'بديل' });
  });
  it('a connection cut (no completed event) counts as a failure too', async () => {
    const e: LlmEnv = { XAI_API_KEY: 'k', AI: workers([wk('ok')]) };
    const out = await collect(stream(e, 'maestro', IN, fake(() => sseRes([delta('جزء')], true))));
    expect(out.map(x => x.type)).toEqual(['delta', 'reset', 'delta', 'done']);
  });
  it('without Workers AI the tab gets an error, never half a text as done', async () => {
    const out = await collect(stream({ OPENAI_API_KEY: 'k' }, 'copy', IN, fake(() => sseRes([delta('جزء'), ev({ type: 'error' })]))));
    expect(out.map(x => x.type)).toEqual(['delta', 'error']);
  });
  it('no key and no Workers AI: error, and nothing is fetched', async () => {
    const f = fake(() => sseRes([]));
    expect(await collect(stream({}, 'copy', IN, f))).toEqual([{ type: 'error', message: 'no_model' }]);
    expect(f).not.toHaveBeenCalled();
  });
  it('the logs carry the status or message only, never the body', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await collect(stream({ OPENAI_API_KEY: 'k', AI: workers([wk('x')]) }, 'copy', { ...IN, messages: [{ role: 'user', content: 'SECRET-PROMPT' }] }, fake(() => sseRes([], false, 429))));
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET-PROMPT');
    warn.mockRestore();
  });
});

describe('stream: a silent or busy provider (OpenAI and Grok)', () => {
  // A body that sends the given pieces and then never ends, like a provider that stopped writing
  const hung = (parts: string[]) => { const q = [...parts]; return new ReadableStream<Uint8Array>({
    pull(c) { const p = q.shift(); if (p !== undefined) { c.enqueue(enc.encode(p)); return; } return new Promise<void>(() => {}); },
  }); };
  // A fetch that never answers, and fails only when its signal is aborted
  const never = ((_u: string, init: RequestInit) => new Promise((_ok, no) => { init.signal!.addEventListener('abort', () => no(init.signal!.reason)); })) as unknown as typeof fetch;

  it('a stream that goes silent is cut after STREAM_IDLE_MS, and Workers AI answers from the start', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const e: LlmEnv = { OPENAI_API_KEY: 'k', AI: workers([wk('بديل')]) };
      const got = collect(stream(e, 'copy', IN, fake(() => new Response(hung([delta('جزء')])))));
      await vi.advanceTimersByTimeAsync(STREAM_IDLE_MS + 1);
      expect((await got).map(x => x.type)).toEqual(['delta', 'reset', 'delta', 'done']);
      expect(warn).toHaveBeenCalledWith('llm_stream_failed', 'openai', 'timeout');
    } finally { warn.mockRestore(); vi.useRealTimers(); }
  });
  it('each event restarts the idle window: a slow but live stream is not cut', async () => {
    vi.useFakeTimers();
    try {
      let push!: (s: string | null) => void;
      const live = new ReadableStream<Uint8Array>({ start(c) { push = s => (s === null ? c.close() : c.enqueue(enc.encode(s))); } });
      const got = collect(stream({ XAI_API_KEY: 'k' }, 'social', IN, fake(() => new Response(live))));
      for (const t of ['أ', 'ب', 'ج']) { await vi.advanceTimersByTimeAsync(STREAM_IDLE_MS - 1000); push(delta(t)); }
      await vi.advanceTimersByTimeAsync(STREAM_IDLE_MS - 1000); push(completed()); push(null);
      await vi.advanceTimersByTimeAsync(0);
      expect((await got).at(-1)).toMatchObject({ type: 'done', response: 'أبج', engine: 'xai' });
    } finally { vi.useRealTimers(); }
  });
  it('a provider that never answers, or says 429 or 5xx, is llm_busy when there is no fallback; other failures stay llm_failed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (const status of [429, 500, 503]) expect(await collect(stream({ OPENAI_API_KEY: 'k' }, 'copy', IN, fake(() => sseRes([], false, status))))).toEqual([{ type: 'error', message: 'llm_busy' }]);
      expect(await collect(stream({ XAI_API_KEY: 'k' }, 'social', IN, fake(() => sseRes([], false, 400))))).toEqual([{ type: 'error', message: 'llm_failed' }]);
      vi.useFakeTimers();
      const got = collect(stream({ XAI_API_KEY: 'k' }, 'social', IN, never));
      await vi.advanceTimersByTimeAsync(STREAM_IDLE_MS + 1);
      expect(await got).toEqual([{ type: 'error', message: 'llm_busy' }]);
      expect(vi.getTimerCount()).toBe(0);
    } finally { warn.mockRestore(); vi.useRealTimers(); }
  });
  it('the idle timer is cleared when the stream ends or the reader leaves', async () => {
    vi.useFakeTimers();
    try {
      await collect(stream({ OPENAI_API_KEY: 'k' }, 'copy', IN, fake(() => sseRes([delta('تم'), completed()]))));
      expect(vi.getTimerCount()).toBe(0);
      const g = stream({ OPENAI_API_KEY: 'k' }, 'copy', IN, fake(() => new Response(hung([delta('جزء')]))));
      await g.next(); await g.return(undefined);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});

describe('stream: Workers AI and stop', () => {
  it('a module on Workers AI streams from the binding, with the usage when it sends it', async () => {
    const e: LlmEnv = { AI: workers([wk('أ'), wk('ب'), `data: ${JSON.stringify({ usage: { prompt_tokens: 4, completion_tokens: 2 } })}\n\n`, 'data: [DONE]\n\n']) };
    const out = await collect(stream(e, 'voice', IN));
    expect(out.at(-1)).toMatchObject({ type: 'done', response: 'أب', engine: 'workers', usage: { in: 4, out: 2 } });
  });
  it('a binding that ignores stream and returns the object still works', async () => {
    const e: LlmEnv = { AI: { run: async () => ({ response: 'كامل' }) } as never };
    expect((await collect(stream(e, 'voice', IN))).map(x => x.type)).toEqual(['delta', 'done']);
  });
  it('stop: an aborted request ends quietly, with no fallback and no error', async () => {
    const ac = new AbortController();
    const e: LlmEnv = { OPENAI_API_KEY: 'k', AI: workers([wk('لا')]) };
    const f = (async () => { ac.abort(); throw new DOMException('aborted', 'AbortError'); }) as unknown as typeof fetch;
    expect(await collect(stream(e, 'copy', IN, f, ac.signal))).toEqual([]);
    expect((e.AI as unknown as { run: ReturnType<typeof vi.fn> }).run).not.toHaveBeenCalled();
  });
});

describe('sseResponse', () => {
  it('writes each event as a data line, and an error from the source as an error event', async () => {
    const r = sseResponse((async function* () { yield { type: 'delta', text: 'a' }; throw new Error('boom'); })());
    expect(r.headers.get('content-type')).toContain('text/event-stream');
    const txt = await r.text();
    expect(txt).toContain('data: {"type":"delta","text":"a"}\n\n');
    expect(txt).toContain('"type":"error"');
    expect(txt).not.toContain('boom');
  });
});

describe('leaving mid-stream', () => {
  const never = () => new ReadableStream<Uint8Array>({ start(c) { c.enqueue(enc.encode(delta('أول'))); } });   // stays open: the provider is still writing
  it('a consumer that stops reading aborts the upstream request and cancels its body', async () => {
    let seen: AbortSignal | undefined; let cancelled = false;
    const f = (async (_u: string, init?: RequestInit) => { seen = init?.signal as AbortSignal; return new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(enc.encode(delta('أول'))); }, cancel() { cancelled = true; } })); }) as unknown as typeof fetch;
    const g = stream({ OPENAI_API_KEY: 'k' }, 'copy', IN, f);
    expect((await g.next()).value).toMatchObject({ type: 'delta', text: 'أول' });
    await g.return(undefined);
    expect(seen?.aborted).toBe(true);
    expect(cancelled).toBe(true);
  });
  it('a client that disconnects from the SSE response stops the generator, and so the provider call', async () => {
    let seen: AbortSignal | undefined;
    const f = (async (_u: string, init?: RequestInit) => { seen = init?.signal as AbortSignal; return new Response(never()); }) as unknown as typeof fetch;
    const res = sseResponse(stream({ OPENAI_API_KEY: 'k' }, 'copy', IN, f));
    const r = res.body!.getReader();
    expect(new TextDecoder().decode((await r.read()).value)).toContain('"type":"delta"');
    await r.cancel();
    expect(seen?.aborted).toBe(true);
  });
  it('the caller\'s own signal (the stop button) reaches the provider request too', async () => {
    const ac = new AbortController(); let seen: AbortSignal | undefined;
    const f = (async (_u: string, init?: RequestInit) => { seen = init?.signal as AbortSignal; return new Response(never()); }) as unknown as typeof fetch;
    const g = stream({ OPENAI_API_KEY: 'k' }, 'copy', IN, f, ac.signal);
    await g.next(); ac.abort();
    expect(seen?.aborted).toBe(true);
    expect((await g.next()).done).toBe(true);
  });
});

describe('time to first delta (fake provider only: a real figure needs keys)', () => {
  it('the first delta arrives while the provider is still writing, not after it finishes', async () => {
    const slow = new ReadableStream<Uint8Array>({
      async start(c) { c.enqueue(enc.encode(delta('أول'))); await new Promise(r => setTimeout(r, 250)); c.enqueue(enc.encode(delta('آخر') + completed())); c.close(); },
    });
    const t0 = performance.now();
    const g = stream({ OPENAI_API_KEY: 'k' }, 'copy', IN, (async () => new Response(slow)) as unknown as typeof fetch);
    const first = await g.next(), tFirst = performance.now() - t0;
    expect(first.value).toMatchObject({ type: 'delta', text: 'أول' });
    expect(tFirst).toBeLessThan(150);   // the provider needs 250 ms for the rest
    const rest: StreamEvent[] = []; for await (const x of g) rest.push(x);
    expect(rest.at(-1)).toMatchObject({ type: 'done', response: 'أولآخر' });
    expect(performance.now() - t0).toBeGreaterThanOrEqual(240);
  });
});
