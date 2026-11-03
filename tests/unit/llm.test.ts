// Text models: each tab's provider, Workers AI when the key is missing or the provider fails, the Responses API body,
// and live search that never falls back.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULTS, aiFor, body, generate, grokSearch, openaiImage, pick, textOf } from '../../src/lib/llm';
import { AI_MODEL } from '../../src/modules/content/content';
import { cleanSuggestion, suggestPrompt } from '../../src/modules/social/social';

const AI = { run: vi.fn(async () => ({ response: 'من Workers AI' })) };
const ok = (j: unknown) => new Response(JSON.stringify(j), { status: 200 });
const MSG = [{ role: 'system', content: 'معرفة' }, { role: 'user', content: 'اكتب' }];
afterEach(() => { AI.run.mockClear(); });

describe('which model', () => {
  it("Leen's split: Content + Design on OpenAI, Social, Maestro and Listening on Grok, the rest on Workers AI", () => {
    const e = { OPENAI_API_KEY: 'k', XAI_API_KEY: 'k', AI };
    expect(pick(e, 'content')).toEqual({ provider: 'openai', model: DEFAULTS.openai });
    expect(pick(e, 'design')?.provider).toBe('openai');
    expect(pick(e, 'copy')?.provider).toBe('openai');
    for (const m of ['social', 'maestro', 'listening']) expect(pick(e, m)).toEqual({ provider: 'xai', model: DEFAULTS.xai });
    expect(pick(e, 'voice')).toEqual({ provider: 'workers', model: AI_MODEL });
  });
  it('no key = Workers AI; nothing bound = no model; env model ids win and are cleaned', () => {
    expect(pick({ AI }, 'content')?.provider).toBe('workers');
    expect(pick({}, 'content')).toBeNull();
    expect(aiFor({}, 'content')).toBeUndefined();
    expect(pick({ XAI_API_KEY: 'k', XAI_MODEL: 'grok-4.3 ; rm' }, 'social')?.model).toBe('grok-4.3rm');
  });
});

describe('Responses API', () => {
  it('sends the messages, the token cap, OpenAI JSON schemas and Grok search tools', () => {
    const schema = { type: 'object' };
    expect(body('openai', 'm', { messages: MSG, max_tokens: 100, response_format: { type: 'json_schema', json_schema: schema } }))
      .toEqual({ model: 'm', input: MSG, max_output_tokens: 100, text: { format: { type: 'json_schema', name: 'answer', schema, strict: false } } });
    expect(body('xai', 'g', { messages: MSG, max_tokens: 50, response_format: { type: 'json_schema', json_schema: schema }, search: ['x', 'web'] }))
      .toEqual({ model: 'g', input: MSG, max_output_tokens: 50, tools: [{ type: 'x_search' }, { type: 'web_search' }] });
  });
  it('reads output_text or the message parts', () => {
    expect(textOf({ output_text: 'أ' })).toBe('أ');
    expect(textOf({ output: [{ type: 'web_search_call' }, { type: 'message', content: [{ type: 'output_text', text: 'ب' }, { type: 'output_text', text: 'ج' }] }] })).toBe('بج');
    expect(textOf(null)).toBe('');
  });
});

describe('generate', () => {
  it('calls the provider with the key, and says which engine wrote it', async () => {
    const f = vi.fn(async () => ok({ output_text: 'من ChatGPT' }));
    const out = await generate({ OPENAI_API_KEY: 'sk-test', AI }, 'content', { messages: MSG, max_tokens: 10 }, f as unknown as typeof fetch);
    expect(out).toEqual({ response: 'من ChatGPT', engine: 'openai', model: DEFAULTS.openai });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    expect(AI.run).not.toHaveBeenCalled();
  });
  it('falls back to Workers AI when the provider fails or answers empty', async () => {
    for (const r of [new Response('quota', { status: 429 }), ok({ output: [] })]) {
      const out = await generate({ XAI_API_KEY: 'k', AI }, 'social', { messages: MSG, max_tokens: 10 }, (async () => r) as unknown as typeof fetch);
      expect(out.engine).toBe('workers');
      expect(out.response).toBe('من Workers AI');
    }
    await expect(generate({ XAI_API_KEY: 'k' }, 'social', { messages: MSG, max_tokens: 10 }, (async () => { throw new Error('down'); }) as unknown as typeof fetch)).rejects.toThrow();
  });
  it('live search goes to Grok only and never falls back', async () => {
    const f = vi.fn(async () => ok({ output_text: '[]' }));
    expect(await grokSearch({ XAI_API_KEY: 'k', AI }, MSG, ['x'], 100, f as unknown as typeof fetch)).toBe('[]');
    expect(JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body)).tools).toEqual([{ type: 'x_search' }]);
    expect(await grokSearch({ AI }, MSG, ['x'], 100, f as unknown as typeof fetch)).toBeNull();
    expect(await grokSearch({ XAI_API_KEY: 'k', AI }, MSG, ['x'], 100, (async () => new Response('', { status: 500 })) as unknown as typeof fetch)).toBeNull();
    expect(AI.run).not.toHaveBeenCalled();
  });
});

describe('social suggestion', () => {
  it('stays inside the shortest platform limit and drops quotes and labels', () => {
    expect(suggestPrompt('محاليل في البيت', ['x', 'facebook'])).toContain('الحد 280 حرف');
    expect(cleanSuggestion('«المنشور: احجز جلستك»', ['facebook'])).toBe('احجز جلستك');
    const long = cleanSuggestion('كلمة '.repeat(100), ['x']);
    expect(long.length).toBeLessThanOrEqual(280);
    expect(long.endsWith('كلمة')).toBe(true);
  });
});

describe('openaiImage', () => {
  it('asks the Images API once and returns a data URL', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const f = (async (url: string, init: RequestInit) => { calls.push({ url, body: JSON.parse(String(init.body)) }); return new Response(JSON.stringify({ data: [{ b64_json: 'QUJD' }] })); }) as unknown as typeof fetch;
    expect(await openaiImage({ OPENAI_API_KEY: 'k' }, 'bg', f)).toBe('data:image/jpeg;base64,QUJD');
    expect(calls[0]!.url).toBe('https://api.openai.com/v1/images/generations');
    expect(calls[0]!.body.model).toBe('gpt-image-2');
  });
  it('is off without a key and null on a failure', async () => {
    expect(await openaiImage({}, 'bg')).toBeNull();
    const f = (async () => new Response('no', { status: 500 })) as unknown as typeof fetch;
    expect(await openaiImage({ OPENAI_API_KEY: 'k' }, 'bg', f)).toBeNull();
  });
});

describe('openaiImage with a product photo', () => {
  it('sends the photo to the edits endpoint as a file', async () => {
    let url = '', form: FormData | null = null;
    const f = (async (u: string, init: RequestInit) => { url = u; form = init.body as FormData; return new Response(JSON.stringify({ data: [{ b64_json: 'WFla' }] })); }) as unknown as typeof fetch;
    const out = await openaiImage({ OPENAI_API_KEY: 'k' }, 'scene', f, { bytes: new Uint8Array([1, 2, 3]), mime: 'image/jpeg' });
    expect(out).toBe('data:image/jpeg;base64,WFla');
    expect(url).toBe('https://api.openai.com/v1/images/edits');
    expect(form!.get('model')).toBe('gpt-image-2');
    expect(form!.get('image')).toBeInstanceOf(Blob);
  });
});
