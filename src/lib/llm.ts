// One adapter for the text models, so each tab names a provider and the rest stays the same.
// Leen's choice: Content + Design + the motion graphics plan (Design's «موشن جرافيك» type) → OpenAI; Social, Maestro and Listening → Grok (xAI). Voice and the rest stay on Workers AI.
// PAID: OpenAI and Grok (xAI) bill every call; so does the Debugger's Claude (Anthropic SDK, src/modules/debugger/explain.ts).
// Workers AI is free within Cloudflare's daily limit and stays the fallback when a key is missing or the provider fails.
// Keys are Worker secrets Leen adds herself: OPENAI_API_KEY, XAI_API_KEY (docs/secrets/worker.env.example).
// Model ids from the providers' model pages (2026-11-03); change them with OPENAI_MODEL / XAI_MODEL, no code change.
import { AI_MODEL, type AiRun } from '../modules/content/content';

export type Provider = 'openai' | 'xai' | 'workers';
export interface LlmEnv { OPENAI_API_KEY?: string; OPENAI_MODEL?: string; OPENAI_IMAGE_MODEL?: string; XAI_API_KEY?: string; XAI_MODEL?: string; AI?: { run: AiRun } }
export type Msg = { role: string; content: string };
export interface LlmInput { messages: Msg[]; max_tokens: number; response_format?: unknown; search?: ('web' | 'x')[] }
export interface LlmOut { response: string; engine: Provider; model: string }

export const DEFAULTS = { openai: 'gpt-6.1-sol', xai: 'grok-4.7', image: 'gpt-image-2' } as const;
export const PROVIDER: Record<string, Provider> = { content: 'openai', design: 'openai', copy: 'openai', motion: 'openai', social: 'xai', maestro: 'xai', listening: 'xai' };
const URL_OF = { openai: 'https://api.openai.com/v1/responses', xai: 'https://api.x.ai/v1/responses' } as const;
const clean = (s: string | undefined) => (s || '').replace(/[^a-z0-9.\-_:]/gi, '').slice(0, 80);

// The provider a tab would use now: its own if the key is there, else Workers AI if bound, else none
export function pick(e: LlmEnv, module: string): { provider: Provider; model: string } | null {
  const p = PROVIDER[module] || 'workers';
  if (p === 'openai' && e.OPENAI_API_KEY) return { provider: 'openai', model: clean(e.OPENAI_MODEL) || DEFAULTS.openai };
  if (p === 'xai' && e.XAI_API_KEY) return { provider: 'xai', model: clean(e.XAI_MODEL) || DEFAULTS.xai };
  return e.AI ? { provider: 'workers', model: AI_MODEL } : null;
}

// Responses API body (OpenAI and xAI share it). JSON schemas go to OpenAI's text.format; Grok gets the JSON ask in the prompt.
export function body(provider: 'openai' | 'xai', model: string, i: LlmInput): Record<string, unknown> {
  const out: Record<string, unknown> = { model, input: i.messages, max_output_tokens: i.max_tokens };
  const rf = i.response_format as { type?: string; json_schema?: unknown } | undefined;
  if (provider === 'openai' && rf?.type === 'json_schema' && rf.json_schema) out.text = { format: { type: 'json_schema', name: 'answer', schema: rf.json_schema, strict: false } };
  if (provider === 'xai' && i.search?.length) out.tools = i.search.map(s => ({ type: s === 'x' ? 'x_search' : 'web_search' }));
  return out;
}

// The answer text: output_text when present, else the output_text parts of the message items
export function textOf(j: unknown): string {
  const o = (j || {}) as { output_text?: unknown; output?: { type?: string; content?: { type?: string; text?: string }[] }[] };
  if (typeof o.output_text === 'string') return o.output_text;
  return (o.output || []).filter(x => x.type === 'message').flatMap(x => x.content || []).filter(c => c.type === 'output_text').map(c => c.text || '').join('');
}

export async function generate(e: LlmEnv, module: string, i: LlmInput, f: typeof fetch = fetch): Promise<LlmOut> {
  const p = pick(e, module);
  if (!p) throw new Error('no_model');
  if (p.provider !== 'workers') {
    const key = p.provider === 'openai' ? e.OPENAI_API_KEY : e.XAI_API_KEY;
    try {
      const r = await f(URL_OF[p.provider], { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body(p.provider, p.model, i)) });
      if (r.ok) {
        const text = textOf(await r.json()).trim();
        if (text) return { response: text, engine: p.provider, model: p.model };
        console.warn('llm_empty', p.provider);
      } else console.warn('llm_failed', p.provider, r.status);   // the status only: the body may echo the request
    } catch (err) { console.warn('llm_failed', p.provider, (err as Error).message); }
    if (!e.AI) throw new Error('llm_failed');
  }
  const out = await e.AI!.run(AI_MODEL, { messages: i.messages, max_tokens: i.max_tokens, ...(i.response_format ? { response_format: i.response_format } : {}) });
  const r = (out as { response?: unknown })?.response;
  return { response: typeof r === 'string' ? r : r ? JSON.stringify(r) : '', engine: 'workers', model: AI_MODEL };
}

// ---- Streaming (SSE). One generator for every provider: the tab gets the same events whoever writes.
// delta: more text. reset: the provider failed after text was already sent, so drop what you have; Workers AI starts over.
// done: the full text. error: nothing could answer. Aborting `signal` (the user's stop button) ends it quietly.
export type StreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'reset' }
  | { type: 'done'; response: string; engine: Provider; model: string; usage?: { in: number; out: number } }
  | { type: 'error'; message: string };

// Server-sent events out of a byte stream. A chunk can end anywhere, so the tail waits for the next one.
export async function* sse(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader(), dec = new TextDecoder();
  let buf = '';
  const parse = (block: string) => {
    let event = '';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    return data.length ? { event, data: data.join('\n') } : null;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) buf += dec.decode(value, { stream: !done }).replace(/\r\n/g, '\n');
      for (let at = buf.indexOf('\n\n'); at >= 0; at = buf.indexOf('\n\n')) {
        const m = parse(buf.slice(0, at)); buf = buf.slice(at + 2);
        if (m) yield m;
      }
      if (done) break;
    }
    const last = parse(buf);
    if (last) yield last;
  } finally { reader.cancel().catch(() => {}); }
}

const num = (x: unknown) => (typeof x === 'number' && isFinite(x) ? x : 0);

export async function* stream(e: LlmEnv, module: string, i: LlmInput, f: typeof fetch = fetch, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
  const p = pick(e, module);
  if (!p) { yield { type: 'error', message: 'no_model' }; return; }
  let sent = false;
  if (p.provider !== 'workers') {
    const key = p.provider === 'openai' ? e.OPENAI_API_KEY : e.XAI_API_KEY;
    try {
      const r = await f(URL_OF[p.provider], { method: 'POST', ...(signal ? { signal } : {}), headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ ...body(p.provider, p.model, i), stream: true }) });
      if (!r.ok || !r.body) throw new Error(`status ${r.status}`);
      let text = '', usage: { in: number; out: number } | undefined, finished = false;
      for await (const m of sse(r.body)) {
        if (m.data === '[DONE]') break;
        let j: { type?: string; delta?: unknown; response?: { usage?: { input_tokens?: number; output_tokens?: number } } };
        try { j = JSON.parse(m.data); } catch { continue; }
        if (j.type === 'response.output_text.delta' && typeof j.delta === 'string' && j.delta) { text += j.delta; sent = true; yield { type: 'delta', text: j.delta }; }
        else if (j.type === 'response.completed' || j.type === 'response.incomplete') { finished = true; const u = j.response?.usage; if (u) usage = { in: num(u.input_tokens), out: num(u.output_tokens) }; }
        else if (j.type === 'response.failed' || j.type === 'error') throw new Error('provider_error');
      }
      if (!finished) throw new Error('stream_cut');
      if (!text.trim()) throw new Error('empty');
      yield { type: 'done', response: text.trim(), engine: p.provider, model: p.model, ...(usage ? { usage } : {}) };
      return;
    } catch (err) {
      if (signal?.aborted) return;
      console.warn('llm_stream_failed', p.provider, (err as Error).message);   // never the body: it may echo the request
    }
    if (!e.AI) { yield { type: 'error', message: 'llm_failed' }; return; }
    if (sent) yield { type: 'reset' };
  }
  try {
    const out = await e.AI!.run(AI_MODEL, { messages: i.messages, max_tokens: i.max_tokens, stream: true, ...(i.response_format ? { response_format: i.response_format } : {}) } as Parameters<AiRun>[1]);
    let text = '', usage: { in: number; out: number } | undefined;
    if (out instanceof ReadableStream) {
      for await (const m of sse(out)) {
        if (m.data === '[DONE]') break;
        let j: { response?: unknown; usage?: { prompt_tokens?: number; completion_tokens?: number } };
        try { j = JSON.parse(m.data); } catch { continue; }
        if (typeof j.response === 'string' && j.response) { text += j.response; yield { type: 'delta', text: j.response }; }
        if (j.usage) usage = { in: num(j.usage.prompt_tokens), out: num(j.usage.completion_tokens) };
      }
    } else {   // a binding that ignored `stream`: the whole answer at once
      const r = (out as { response?: unknown })?.response;
      text = typeof r === 'string' ? r : r ? JSON.stringify(r) : '';
      if (text) yield { type: 'delta', text };
    }
    if (!text.trim()) { yield { type: 'error', message: 'empty' }; return; }
    yield { type: 'done', response: text.trim(), engine: 'workers', model: AI_MODEL, ...(usage ? { usage } : {}) };
  } catch (err) {
    if (signal?.aborted) return;
    console.warn('llm_stream_failed', 'workers', (err as Error).message);
    yield { type: 'error', message: 'llm_failed' };
  }
}

// The events as a text/event-stream body, for a route to return. Each event is one `data:` line of JSON.
export function sseResponse(events: AsyncIterable<unknown>): Response {
  const enc = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    async start(c) {
      try { for await (const ev of events) c.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`)); }
      catch (err) { console.warn('sse_failed', (err as Error).message); c.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'error', message: 'llm_failed' })}\n\n`)); }
      c.close();
    },
  }), { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
}

// Same shape as Workers AI's run(), for code written against it. The model argument is ignored: the tab decides.
export const aiFor = (e: LlmEnv, module: string): AiRun | undefined =>
  pick(e, module) ? (...a) => generate(e, module, a[1]) : undefined;

// Grok with live search (Listening). PAID: tokens, plus $5 per 1,000 web searches and X billed per post fetched (xAI pricing).
// Never falls back: a model without search would make the posts up.
export async function grokSearch(e: LlmEnv, messages: Msg[], sources: ('web' | 'x')[], max_tokens: number, f: typeof fetch = fetch): Promise<string | null> {
  if (!e.XAI_API_KEY) return null;
  try {
    const r = await f(URL_OF.xai, { method: 'POST', headers: { authorization: `Bearer ${e.XAI_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(body('xai', clean(e.XAI_MODEL) || DEFAULTS.xai, { messages, max_tokens, search: sources })) });
    if (!r.ok) { console.warn('grok_search_failed', r.status); return null; }
    return textOf(await r.json());
  } catch (err) { console.warn('grok_search_failed', (err as Error).message); return null; }
}

// Images from OpenAI's Images API (the design tab). PAID per image (more for higher quality and size).
// With a product photo it is an edit: the product kept, a new scene around it. Without one, a new background.
// No fallback: Workers AI has no image model we use. Returns a data: URL, or null with the reason logged.
export async function openaiImage(e: LlmEnv, prompt: string, f: typeof fetch = fetch, product?: { bytes: Uint8Array<ArrayBuffer>; mime: string }): Promise<string | null> {
  if (!e.OPENAI_API_KEY) return null;
  const model = clean(e.OPENAI_IMAGE_MODEL) || DEFAULTS.image, opts = { size: '1024x1536', quality: 'medium', output_format: 'jpeg' };
  try {
    let r: Response;
    if (product) {
      const form = new FormData();
      form.append('model', model); form.append('prompt', prompt); form.append('n', '1');
      for (const [k, v] of Object.entries(opts)) form.append(k, v);
      form.append('image', new Blob([product.bytes], { type: product.mime }), product.mime === 'image/png' ? 'product.png' : 'product.jpg');
      r = await f('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { authorization: `Bearer ${e.OPENAI_API_KEY}` }, body: form });
    } else {
      r = await f('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { authorization: `Bearer ${e.OPENAI_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, prompt, n: 1, ...opts }) });
    }
    if (!r.ok) { console.warn('image_failed', product ? 'edit' : 'new', r.status); return null; }
    const b64 = ((await r.json()) as { data?: { b64_json?: string }[] })?.data?.[0]?.b64_json;
    return b64 ? `data:image/jpeg;base64,${b64}` : null;
  } catch (err) { console.warn('image_failed', (err as Error).message); return null; }
}
