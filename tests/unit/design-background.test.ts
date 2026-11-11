// Design backgrounds (Leen, 2026-11-11: pieces came out on a pale, empty background with no reason given). Every way the
// picture can be missing has a reason the user sees, retry only where it can help, and the page draws a designed Well
// background (palette v2.1, one Pulse Pink touch) instead of a flat pale fill. Synthetic data only.
/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { imageOf } from '../../src/lib/llm';
import { clearSnaps } from '../../src/lib/usage';
import { WELL_PALETTE, backgroundPrompt, imageMiss, imageSize } from '../../src/modules/design/design';
import { background, brief } from '../../src/modules/design/routes';
import client from '../../public/modules/design/client.js?raw';

const CO = '00000000-0000-0000-0000-000000000001';
const E = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'owner@example.com' };
const cfg = A.env(E);
const EDITOR: A.Profile = { id: '33333333-3333-3333-3333-333333333333', email: 'editor@example.com', active: true, company_id: CO, access: { design: 'edit' } };
const editor = A.sessionFor(EDITOR, cfg);
const req = async (path: string, body: unknown) => new Request('https://well.example' + path, { method: 'POST', body: JSON.stringify(body),
  headers: { cookie: `${A.SESSION}=${encodeURIComponent(await A.sign(editor, cfg.secret))}`, origin: 'https://well.example', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' } });
const ok = (d: unknown) => new Response(JSON.stringify(d), { status: 200 });

// Supabase answers empty (no ads, no brand, nothing spent); OpenAI answers what the test says
function world(images: () => Response, spent = 0) {
  const sent: { url: string; body: Record<string, unknown> | null }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    sent.push({ url, body: typeof init.body === 'string' ? JSON.parse(init.body) : null });
    if (url.includes('/profiles?')) return ok([EDITOR]);
    if (url.includes('/rpc/ai_spend')) return ok(spent ? [{ module: 'design', cost_usd: spent }] : []);
    if (url.startsWith('https://api.openai.com/v1/images')) return images();
    if (url.startsWith('https://api.openai.com/')) return ok({ output_text: '[]' });
    return ok([]);
  }));
  return sent;
}
afterEach(() => { vi.unstubAllGlobals(); clearSnaps(); });

describe('why there is no picture', () => {
  const f = (r: Response) => (async () => r) as unknown as typeof fetch;
  it('no key, a safety refusal, a server error, an empty answer', async () => {
    expect(await imageOf({}, 'bg')).toEqual({ image: null, miss: 'no_key' });
    const refused = new Response(JSON.stringify({ error: { code: 'moderation_blocked', message: 'x' } }), { status: 400 });
    expect(await imageOf({ OPENAI_API_KEY: 'k' }, 'bg', f(refused))).toEqual({ image: null, miss: 'refused', status: 400 });
    expect(await imageOf({ OPENAI_API_KEY: 'k' }, 'bg', f(new Response('down', { status: 503 })))).toEqual({ image: null, miss: 'failed', status: 503 });
    expect(await imageOf({ OPENAI_API_KEY: 'k' }, 'bg', f(ok({ data: [] })))).toEqual({ image: null, miss: 'failed' });
  });
  it('each reason is a plain sentence; retry only where trying again can help', () => {
    const user = editor;
    const capped = imageMiss({ image: null, miss: 'capped' }, user)!;
    expect(capped).toMatchObject({ code: 'capped', retry: false });
    expect(capped.message).toContain('الصرف الشهري');
    expect(imageMiss({ image: null, miss: 'no_key' }, user)).toMatchObject({ code: 'no_key', retry: false });
    expect(imageMiss({ image: null, miss: 'refused' }, user)).toMatchObject({ code: 'refused', retry: true });
    expect(imageMiss({ image: null, miss: 'failed', status: 502 }, user)!.message).toContain('502');
    expect(imageMiss({ image: 'data:image/jpeg;base64,QQ==' }, user)).toBeNull();
  });
});

describe('the picture fits the chosen sizes and the brand', () => {
  it('one shape for all chosen sizes: tall unless only wide or only square', () => {
    expect(imageSize(['story', 'square'])).toBe('1024x1536');
    expect(imageSize(['square'])).toBe('1024x1024');
    expect(imageSize(['landscape'])).toBe('1536x1024');
    expect(imageSize(['nope'])).toBe('1024x1536');
    expect(imageSize(undefined)).toBe('1024x1536');
  });
  it('the prompt asks for a full scene in Well colours, and keeps the MOH limits', () => {
    const p = backgroundPrompt({ type: 'ad', offer: 'فيتامين سي', audience: '', dept: '' }, [], '');
    expect(p).toContain(WELL_PALETTE.join(' '));
    expect(p).toContain('edge to edge');
    for (const rule of ['No text', 'before/after', 'no children as the subject', 'testimonials']) expect(p).toContain(rule);
    expect(backgroundPrompt({ type: 'ad', offer: '', audience: '', dept: '' }, ['#112233'], '')).toContain('#112233');
  });
});

describe('routes', () => {
  const BODY = { type: 'ad', offer: 'فيتامين سي في البيت', sizes: ['story', 'square'] };
  it('brief: a failed picture comes back with its reason, and the copy is still there', async () => {
    world(() => new Response('down', { status: 500 }));
    const r = await (await brief.POST(await req('/api/design/brief', BODY), { ...E, OPENAI_API_KEY: 'k' } as never)).json() as Record<string, unknown>;
    expect(r.image).toBeNull();
    expect(r.imageError).toMatchObject({ code: 'failed', retry: true });
    expect((r.variants as unknown[]).length).toBeGreaterThan(0);
  });
  it('brief: a spent cap says so (no call to the Images API)', async () => {
    const sent = world(() => ok({ data: [{ b64_json: 'QQ==' }] }), 50);
    const r = await (await brief.POST(await req('/api/design/brief', BODY), { ...E, OPENAI_API_KEY: 'k' } as never)).json() as Record<string, unknown>;
    expect(r.imageError).toMatchObject({ code: 'capped', retry: false });
    expect(sent.some(s => s.url.includes('/v1/images'))).toBe(false);
  });
  it('background: the retry draws only the picture, in the shape of the chosen sizes', async () => {
    const sent = world(() => ok({ data: [{ b64_json: 'QQ==' }] }));
    const r = await (await background.POST(await req('/api/design/background', { ...BODY, sizes: ['landscape'] }), { ...E, OPENAI_API_KEY: 'k' } as never)).json() as Record<string, unknown>;
    expect(r).toEqual({ image: 'data:image/jpeg;base64,QQ==', imageError: null });
    expect(sent.find(s => s.url.includes('/v1/images/generations'))!.body).toMatchObject({ size: '1536x1024' });
    expect(sent.some(s => s.url.endsWith('/v1/responses'))).toBe(false);
  });
});

describe('the page without a picture', () => {
  it('draws the Well backdrop, not a pale fill, with one Pulse Pink touch', () => {
    expect(client).not.toContain('#ECE6FB');
    expect(client).toContain('else backdrop(ctx, W, H, pal)');
    const hexes = [...client.matchAll(/#[0-9A-F]{6}/g)].map(m => m[0]);
    expect(hexes.filter(h => !WELL_PALETTE.includes(h))).toEqual([]);
    expect(client.match(/WELL\.pink/g)).toHaveLength(1);
  });
  it('uses the brand fonts and says why there is no picture, with a retry', () => {
    for (const f of ['noto-naskh-arabic.woff2', 'inter-latin.woff2', 'playfair-display-900.woff2']) expect(client).toContain(f);
    expect(client).toContain("'/api/design/background'");
    expect(client).toContain('res.imageError');
  });
});
