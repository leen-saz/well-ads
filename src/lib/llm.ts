// One adapter for the text models, so each tab names a provider and the rest stays the same.
// Leen's choice: Content + Design + the motion graphics plan (Design's «موشن جرافيك» type) → OpenAI; Social, Maestro and Listening → Grok (xAI). Voice and the rest stay on Workers AI.
// PAID: OpenAI and Grok (xAI) bill every call; so does the Debugger's Claude (Anthropic SDK, src/modules/debugger/explain.ts).
// Workers AI is free within Cloudflare's daily limit and stays the fallback when a key is missing or the provider fails.
// Keys are Worker secrets Leen adds herself: OPENAI_API_KEY, XAI_API_KEY, OPENROUTER_API_KEY (docs/secrets/worker.env.example).
// OpenRouter (PAID per call, billed by OpenRouter) is a default only for the home assistant «احلم» (task `ahlam`); every other task uses it
// only when the owner picks it for that task (src/lib/ai-routes.ts, docs/ai-providers.md). Without its key a task keeps its current provider.
// Model ids from the providers' model pages (2026-11-03); change them with OPENAI_MODEL / XAI_MODEL, no code change.
import { AI_MODEL, type AiRun } from '../modules/content/content';
import { overCap, record, tabOf, type UsageCtx } from './usage';
import { cleanModel, OR_DEFAULT, OR_MODEL, routesOf, type Route } from './ai-routes';

// Audio, video, image and speech calls (Gemini) live in gemini.ts and are reached through this adapter too
export * from './gemini';

export type Provider = 'openai' | 'xai' | 'workers' | 'openrouter';
export interface LlmEnv { OPENAI_API_KEY?: string; OPENAI_MODEL?: string; OPENAI_IMAGE_MODEL?: string; XAI_API_KEY?: string; XAI_MODEL?: string; OPENROUTER_API_KEY?: string; OPENROUTER_SITE_URL?: string; AI?: { run: AiRun } }
export type Msg = { role: string; content: string };
export interface LlmInput { messages: Msg[]; max_tokens: number; response_format?: unknown; search?: ('web' | 'x')[] }
export interface LlmOut { response: string; engine: Provider; model: string }

export const DEFAULTS = { openai: 'gpt-6.1-sol', xai: 'grok-4.7', image: 'gpt-image-2' } as const;
export const PROVIDER: Record<string, Provider> = { content: 'openai', design: 'openai', copy: 'openai', motion: 'openai', social: 'xai', maestro: 'xai', listening: 'xai', ahlam: 'openrouter' };
const URL_OF = { openai: 'https://api.openai.com/v1/responses', xai: 'https://api.x.ai/v1/responses' } as const;
export const OR_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const OR_TIMEOUT_MS = 60_000, OR_STREAM_MS = 120_000;
const clean = (s: string | undefined) => (s || '').replace(/[^a-z0-9.\-_:]/gi, '').slice(0, 80);

// The provider a tab would use now: its own if the key is there, else Workers AI if bound, else none
// `spent`: the tab has used its monthly cap (src/lib/usage.ts), so it goes to Workers AI, or to none when that is not bound.
// `route`: the owner's choice for this task (ai_routes). It wins only when its provider's key is there (and, for OpenRouter, a model id).
export function pick(e: LlmEnv, module: string, spent = false, route?: Route): { provider: Provider; model: string } | null {
  if (!spent && route) {
    const m = route.provider === 'openrouter' ? cleanModel(route.model) : clean(route.model);
    if (route.provider === 'openrouter' && e.OPENROUTER_API_KEY && OR_MODEL.test(m)) return { provider: 'openrouter', model: m };
    if (route.provider === 'openai' && e.OPENAI_API_KEY) return { provider: 'openai', model: m || clean(e.OPENAI_MODEL) || DEFAULTS.openai };
    if (route.provider === 'xai' && e.XAI_API_KEY) return { provider: 'xai', model: m || clean(e.XAI_MODEL) || DEFAULTS.xai };
    if (route.provider === 'workers' && e.AI) return { provider: 'workers', model: AI_MODEL };
  }
  const p = spent ? 'workers' : PROVIDER[module] || 'workers';
  if (p === 'openai' && e.OPENAI_API_KEY) return { provider: 'openai', model: clean(e.OPENAI_MODEL) || DEFAULTS.openai };
  if (p === 'xai' && e.XAI_API_KEY) return { provider: 'xai', model: clean(e.XAI_MODEL) || DEFAULTS.xai };
  // a task whose default is OpenRouter (the home assistant): only with the key, else Workers AI like the others
  if (p === 'openrouter' && e.OPENROUTER_API_KEY && OR_DEFAULT[module]) return { provider: 'openrouter', model: OR_DEFAULT[module]! };
  return e.AI ? { provider: 'workers', model: AI_MODEL } : null;
}

// The same env without the Workers AI binding: a call that must not fall back to the free model (it throws instead)
export const withoutFallback = (e: LlmEnv): LlmEnv => { const rest = { ...e }; delete rest.AI; return rest; };

// The owner's route for this call's task (its tab), when the caller says who is asking
const routeOf = async (ctx: UsageCtx | undefined, module: string): Promise<Route | undefined> => ctx ? (await routesOf(ctx.cfg, ctx.co)).get(tabOf(module, ctx)) : undefined;
// True when this task's route sends it to OpenRouter now (key and model there, cap not spent): the Debugger and the critic
// call Anthropic directly otherwise, so they ask this first.
export async function viaOpenRouter(e: LlmEnv, module: string, ctx?: UsageCtx): Promise<boolean> {
  const spent = ctx ? await overCap(ctx, module) : false;
  return pick(e, module, spent, await routeOf(ctx, module))?.provider === 'openrouter';
}

// Chat Completions body for OpenRouter. `usage.include` makes it return the cost it charged. JSON schemas are sent as OpenAI does.
// No live search or tools here: only the xAI adapter has them (grokSearch), and nothing else asks for them.
export function orBody(model: string, i: LlmInput, streaming = false): Record<string, unknown> {
  const out: Record<string, unknown> = { model, messages: i.messages, max_tokens: i.max_tokens, usage: { include: true } };
  const rf = i.response_format as { type?: string; json_schema?: unknown } | undefined;
  if (rf?.type === 'json_schema' && rf.json_schema) out.response_format = { type: 'json_schema', json_schema: { name: 'answer', strict: false, schema: rf.json_schema } };
  if (streaming) out.stream = true;
  return out;
}
// Site headers OpenRouter shows in its dashboard. ASCII only: a header value cannot hold Arabic.
export const orHeaders = (e: LlmEnv, key: string | undefined): Record<string, string> => ({
  authorization: `Bearer ${key}`, 'content-type': 'application/json', 'x-title': 'Well Ads',
  ...(/^https:\/\/[\x21-\x7e]+$/.test(e.OPENROUTER_SITE_URL || '') ? { 'http-referer': e.OPENROUTER_SITE_URL! } : {}),
});
type OrUsage = { prompt_tokens?: number; completion_tokens?: number; cost?: number };
// The answer text of a Chat Completions reply (a string, or parts)
export function orText(j: unknown): string {
  const c = (j as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
  if (typeof c === 'string') return c;
  return Array.isArray(c) ? c.map(x => (typeof x?.text === 'string' ? x.text : '')).join('') : '';
}
// Tokens and the cost OpenRouter charged (US dollars), which beats any price table of ours
const orUsed = (u: OrUsage | undefined): { usage?: { in: number; out: number }; costUsd?: number } => u ? { usage: { in: num(u.prompt_tokens), out: num(u.completion_tokens) }, ...(typeof u.cost === 'number' && isFinite(u.cost) && u.cost >= 0 ? { costUsd: u.cost } : {}) } : {};
// A plain Arabic sentence for a failure code, for what a normal user may read. The provider's own error stays in the logs.
export function llmMessage(err: unknown): string {
  const m = (err as Error)?.message || '';
  if (m === 'cap_reached') return 'التاب وصل سقفه الشهري للذكاء الاصطناعي. تواصل مع الإدارة.';
  if (m === 'no_model') return 'الذكاء الاصطناعي غير متصل الحين.';
  if (m === 'llm_busy') return 'الخدمة مشغولة الحين، جرّب بعد دقيقة.';
  return 'ما قدرت أكمل الحين، جرّب مرة ثانية بعد شوي.';
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

// `ctx` (who is asking) turns on the cost record and the monthly cap; callers without one (cron, fetchers) are not tracked.
export async function generate(e: LlmEnv, module: string, i: LlmInput, f: typeof fetch = fetch, ctx?: UsageCtx): Promise<LlmOut> {
  const spent = ctx ? await overCap(ctx, module) : false;
  const p = pick(e, module, spent, await routeOf(ctx, module));
  if (!p) throw new Error(spent ? 'cap_reached' : 'no_model');
  if (p.provider !== 'workers') {
    let busy = false;
    try {
      if (p.provider === 'openrouter') {
        // a timeout, so a slow model cannot hold the request open; the cost is what OpenRouter charged
        const r = await f(OR_URL, { method: 'POST', signal: AbortSignal.timeout(OR_TIMEOUT_MS), headers: orHeaders(e, e.OPENROUTER_API_KEY), body: JSON.stringify(orBody(p.model, i)) });
        if (r.ok) {
          const j = await r.json(), text = orText(j).trim();
          if (text) {
            record(ctx, module, { provider: 'openrouter', model: p.model, ...orUsed((j as { usage?: OrUsage })?.usage) });
            return { response: text, engine: 'openrouter', model: p.model };
          }
          console.warn('llm_empty', p.provider);
        } else { busy = r.status === 429 || r.status === 402 || r.status >= 500; console.warn('llm_failed', p.provider, r.status); }
      } else {
        const key = p.provider === 'openai' ? e.OPENAI_API_KEY : e.XAI_API_KEY;
        const r = await f(URL_OF[p.provider], { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body(p.provider, p.model, i)) });
        if (r.ok) {
          const j = await r.json(), text = textOf(j).trim();
          if (text) {
            const u = (j as { usage?: { input_tokens?: number; output_tokens?: number } })?.usage;
            const usage = u ? { in: num(u.input_tokens), out: num(u.output_tokens) } : undefined;
            record(ctx, module, { provider: p.provider, model: p.model, usage });
            return { response: text, engine: p.provider, model: p.model };
          }
          console.warn('llm_empty', p.provider);
        } else console.warn('llm_failed', p.provider, r.status);   // the status only: the body may echo the request
      }
    } catch (err) { busy = (err as Error).name === 'TimeoutError'; console.warn('llm_failed', p.provider, (err as Error).message); }
    if (!e.AI) throw new Error(busy ? 'llm_busy' : 'llm_failed');
  }
  const out = await e.AI!.run(AI_MODEL, { messages: i.messages, max_tokens: i.max_tokens, ...(i.response_format ? { response_format: i.response_format } : {}) });
  const r = (out as { response?: unknown })?.response;
  const wu = (out as { usage?: { prompt_tokens?: number; completion_tokens?: number } })?.usage;
  record(ctx, module, { provider: 'workers', model: AI_MODEL, usage: wu ? { in: num(wu.prompt_tokens), out: num(wu.completion_tokens) } : undefined });
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
export async function* sse(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader(), dec = new TextDecoder();
  // a stop ends a read that is waiting for the provider, whether or not the body itself honours the abort
  signal?.addEventListener('abort', () => { reader.cancel().catch(() => {}); }, { once: true });
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

// Tokens from characters when the provider never sent its usage (about 3 characters a token for Arabic): only for a cut stream
const guess = (i: LlmInput, out: string) => ({ in: Math.ceil(i.messages.reduce((n, m) => n + m.content.length, 0) / 3), out: Math.ceil(out.length / 3) });
const num = (x: unknown) => (typeof x === 'number' && isFinite(x) ? x : 0);

// Stops the upstream request whenever the consumer stops reading (the stop button, a closed tab, a break out of the loop):
// the inner generator's own controller is aborted in `finally`, which cancels the provider's response body.
export async function* stream(e: LlmEnv, module: string, i: LlmInput, f: typeof fetch = fetch, signal?: AbortSignal, ctx?: UsageCtx): AsyncGenerator<StreamEvent> {
  if (signal?.aborted) return;
  const ac = new AbortController(), stop = () => ac.abort();
  signal?.addEventListener('abort', stop, { once: true });
  try { yield* run(e, module, i, f, ac.signal, ctx); }
  finally { signal?.removeEventListener('abort', stop); ac.abort(); }
}

async function* run(e: LlmEnv, module: string, i: LlmInput, f: typeof fetch, signal: AbortSignal, ctx?: UsageCtx): AsyncGenerator<StreamEvent> {
  const spent = ctx ? await overCap(ctx, module) : false;
  const p = pick(e, module, spent, await routeOf(ctx, module));
  if (!p) { yield { type: 'error', message: spent ? 'cap_reached' : 'no_model' }; return; }
  let sent = false;
  if (p.provider !== 'workers') {
    const or = p.provider === 'openrouter', key = p.provider === 'openai' ? e.OPENAI_API_KEY : p.provider === 'xai' ? e.XAI_API_KEY : e.OPENROUTER_API_KEY;
    let cost: number | undefined;
    // Once the provider accepted the request it bills what it wrote, even if the stream is cut or the reader leaves:
    // the `finally` below records what was received (an estimate when no usage event arrived)
    let text = '', usage: { in: number; out: number } | undefined, started = false, logged = false;
    try {
      const r = or
        ? await f(OR_URL, { method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(OR_STREAM_MS)]), headers: orHeaders(e, key), body: JSON.stringify(orBody(p.model, i, true)) })
        : await f(URL_OF[p.provider as 'openai' | 'xai'], { method: 'POST', signal, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ ...body(p.provider as 'openai' | 'xai', p.model, i), stream: true }) });
      if (!r.ok || !r.body) throw new Error(`status ${r.status}`);
      started = true;
      let finished = false;
      for await (const m of sse(r.body, signal)) {
        if (m.data === '[DONE]') { finished = finished || or; break; }
        if (or) {
          // Chat Completions chunks. Comment lines (keep-alives) never reach here; usage comes in the last chunk before [DONE].
          let c: { error?: unknown; choices?: { delta?: { content?: unknown }; finish_reason?: string | null }[]; usage?: OrUsage };
          try { c = JSON.parse(m.data); } catch { continue; }
          if (c.error) throw new Error('provider_error');
          const t = c.choices?.[0]?.delta?.content;
          if (typeof t === 'string' && t) { text += t; sent = true; yield { type: 'delta', text: t }; }
          const fr = c.choices?.[0]?.finish_reason;
          if (fr === 'error') throw new Error('provider_error');
          if (fr) finished = true;
          if (c.usage) { const o = orUsed(c.usage); usage = o.usage; cost = o.costUsd; }
          continue;
        }
        let j: { type?: string; delta?: unknown; response?: { usage?: { input_tokens?: number; output_tokens?: number } } };
        try { j = JSON.parse(m.data); } catch { continue; }
        if (j.type === 'response.output_text.delta' && typeof j.delta === 'string' && j.delta) { text += j.delta; sent = true; yield { type: 'delta', text: j.delta }; }
        else if (j.type === 'response.completed' || j.type === 'response.incomplete') { finished = true; const u = j.response?.usage; if (u) usage = { in: num(u.input_tokens), out: num(u.output_tokens) }; }
        else if (j.type === 'response.failed' || j.type === 'error') throw new Error('provider_error');
      }
      if (!finished) throw new Error('stream_cut');
      if (!text.trim()) throw new Error('empty');
      record(ctx, module, { provider: p.provider, model: p.model, usage, ...(cost !== undefined ? { costUsd: cost } : {}) });
      logged = true;
      yield { type: 'done', response: text.trim(), engine: p.provider, model: p.model, ...(usage ? { usage } : {}) };
      return;
    } catch (err) {
      if (signal.aborted) return;
      console.warn('llm_stream_failed', p.provider, (err as Error).message);   // never the body: it may echo the request
    } finally {
      if (started && !logged) record(ctx, module, { provider: p.provider, model: p.model, usage: usage ?? guess(i, text), estimated: !usage, ...(cost !== undefined ? { costUsd: cost } : {}) });
    }
    if (!e.AI) { yield { type: 'error', message: 'llm_failed' }; return; }
    if (sent) yield { type: 'reset' };
  }
  try {
    const out = await e.AI!.run(AI_MODEL, { messages: i.messages, max_tokens: i.max_tokens, stream: true, ...(i.response_format ? { response_format: i.response_format } : {}) } as Parameters<AiRun>[1]);
    let text = '', usage: { in: number; out: number } | undefined;
    if (out instanceof ReadableStream) {
      for await (const m of sse(out, signal)) {
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
    record(ctx, module, { provider: 'workers', model: AI_MODEL, usage });
    yield { type: 'done', response: text.trim(), engine: 'workers', model: AI_MODEL, ...(usage ? { usage } : {}) };
  } catch (err) {
    if (signal.aborted) return;
    console.warn('llm_stream_failed', 'workers', (err as Error).message);
    yield { type: 'error', message: 'llm_failed' };
  }
}

// The events as a text/event-stream body, for a route to return. Each event is one `data:` line of JSON.
export function sseResponse(events: AsyncIterable<unknown>): Response {
  const enc = new TextEncoder(), it = events[Symbol.asyncIterator]();
  const line = (ev: unknown) => enc.encode('data: ' + JSON.stringify(ev) + '\n\n');
  return new Response(new ReadableStream<Uint8Array>({
    // pulled as the client reads; a client that leaves cancels the stream, which stops the generator and so the provider call
    async pull(c) {
      try { const n = await it.next(); if (n.done) c.close(); else c.enqueue(line(n.value)); }
      catch (err) { console.warn('sse_failed', (err as Error).message); c.enqueue(line({ type: 'error', message: 'llm_failed' })); c.close(); }
    },
    async cancel() { await it.return?.(); },
  }), { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
}

// Same shape as Workers AI's run(), for code written against it. The model argument is ignored: the tab decides.
export const aiFor = (e: LlmEnv, module: string, ctx?: UsageCtx): AiRun | undefined =>
  pick(e, module) ? (...a) => generate(e, module, a[1], fetch, ctx) : undefined;

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
