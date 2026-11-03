// One adapter for the text models, so each tab names a provider and the rest stays the same.
// Leen's choice: Content + Design + the motion video plan (Maestro's video page) → OpenAI; Social, Maestro and Listening → Grok (xAI). Voice and the rest stay on Workers AI.
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

// A background image from OpenAI's Images API (the design tab). PAID per image (more for higher quality and size).
// No fallback: Workers AI has no image model we use. Returns a data: URL, or null with the reason logged.
export async function openaiImage(e: LlmEnv, prompt: string, f: typeof fetch = fetch): Promise<string | null> {
  if (!e.OPENAI_API_KEY) return null;
  try {
    const r = await f('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { authorization: `Bearer ${e.OPENAI_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: clean(e.OPENAI_IMAGE_MODEL) || DEFAULTS.image, prompt, n: 1, size: '1024x1536', quality: 'medium', output_format: 'jpeg' }) });
    if (!r.ok) { console.warn('image_failed', r.status); return null; }
    const b64 = ((await r.json()) as { data?: { b64_json?: string }[] })?.data?.[0]?.b64_json;
    return b64 ? `data:image/jpeg;base64,${b64}` : null;
  } catch (err) { console.warn('image_failed', (err as Error).message); return null; }
}
