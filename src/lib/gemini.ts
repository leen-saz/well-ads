// Gemini for what the other providers here do not do in one call: reading audio, video and images, and speaking.
// Re-exported from src/lib/llm.ts, the one adapter every tab uses. Every call is recorded in ai_usage (src/lib/usage.ts).
// PAID: Gemini bills tokens (audio and video input cost more per token than text; speech output is billed per audio token).
// The key is a Worker secret Leen adds herself: GEMINI_API_KEY (docs/secrets/worker.env.example). Model ids come from
// Google's model page and can change without a deploy: GEMINI_MODEL, GEMINI_TTS_MODEL.
import { overCap, record, type UsageCtx } from './usage';

export interface GeminiEnv { GEMINI_API_KEY?: string; GEMINI_MODEL?: string; GEMINI_TTS_MODEL?: string }
export const GEMINI_MODEL = 'gemini-3-flash';
const BASE = 'https://generativelanguage.googleapis.com';
const clean = (s: string | undefined) => (s || '').replace(/[^a-z0-9.\-_]/gi, '').slice(0, 80);
export const geminiModel = (e: GeminiEnv): string => clean(e.GEMINI_MODEL) || GEMINI_MODEL;
export const geminiReady = (e: GeminiEnv): boolean => !!e.GEMINI_API_KEY;

export type Part =
  | { text: string }
  | { inline: { mime: string; data: string } }                                       // base64, small files (images)
  | { file: { mime: string; uri: string }; from?: number; to?: number };            // an uploaded file, optionally a time window in seconds

// Why a call failed, as a code a route can turn into plain words. Never carries the provider's body (it can echo the request).
export class GeminiError extends Error {
  constructor(public code: 'no_key' | 'capped' | 'rate_limited' | 'blocked' | 'empty' | 'failed', public status = 0) { super(code); }
}

const partOf = (p: Part): Record<string, unknown> => {
  if ('text' in p) return { text: p.text };
  if ('inline' in p) return { inlineData: { mimeType: p.inline.mime, data: p.inline.data } };
  return { fileData: { mimeType: p.file.mime, fileUri: p.file.uri }, ...(p.from !== undefined && p.to !== undefined ? { videoMetadata: { startOffset: `${Math.max(0, Math.floor(p.from))}s`, endOffset: `${Math.max(1, Math.ceil(p.to))}s` } } : {}) };
};

export interface GeminiInput { system?: string; parts: Part[]; max_tokens: number; json?: boolean; temperature?: number }
export interface GeminiOut { text: string; model: string; usage: { in: number; out: number; audioIn: number } }

export function geminiBody(i: GeminiInput): Record<string, unknown> {
  return {
    ...(i.system ? { systemInstruction: { parts: [{ text: i.system }] } } : {}),
    contents: [{ role: 'user', parts: i.parts.map(partOf) }],
    generationConfig: { maxOutputTokens: i.max_tokens, temperature: i.temperature ?? 0.2, ...(i.json ? { responseMimeType: 'application/json' } : {}) },
  };
}

interface Raw {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; promptTokensDetails?: { modality?: string; tokenCount?: number }[] };
}
const n = (x: unknown) => (typeof x === 'number' && isFinite(x) ? x : 0);
// Tokens the provider billed: the prompt (audio and video counted apart, they cost more), and the answer plus its thinking
export function usageOf(raw: Raw | undefined): GeminiOut['usage'] {
  const u = raw?.usageMetadata;
  const audioIn = (u?.promptTokensDetails || []).filter(d => d.modality === 'AUDIO' || d.modality === 'VIDEO').reduce((s, d) => s + n(d.tokenCount), 0);
  return { in: n(u?.promptTokenCount), out: n(u?.candidatesTokenCount) + n(u?.thoughtsTokenCount), audioIn };
}

// One generateContent call: the text of the answer and what it cost. `tab` bills it to a tab in ai_usage.
export async function gemini(e: GeminiEnv, module: string, i: GeminiInput, f: typeof fetch = fetch, ctx?: UsageCtx, signal?: AbortSignal): Promise<GeminiOut> {
  if (!e.GEMINI_API_KEY) throw new GeminiError('no_key');
  if (ctx && await overCap(ctx, module)) throw new GeminiError('capped');   // no free fallback for audio, video or speech: it stops
  const model = geminiModel(e);
  let r: Response;
  try {
    r = await f(`${BASE}/v1beta/models/${model}:generateContent`, { method: 'POST', ...(signal ? { signal } : {}), headers: { 'content-type': 'application/json', 'x-goog-api-key': e.GEMINI_API_KEY }, body: JSON.stringify(geminiBody(i)) });
  } catch (err) { console.warn('gemini_failed', (err as Error).message); throw new GeminiError('failed'); }
  if (r.status === 429) throw new GeminiError('rate_limited', 429);
  if (!r.ok) { console.warn('gemini_failed', r.status); throw new GeminiError('failed', r.status); }   // the status only
  const raw = await r.json() as Raw;
  const usage = usageOf(raw);
  record(ctx, module, { provider: 'gemini', model, usage: { in: usage.in, out: usage.out, audioIn: usage.audioIn } });   // billed even when the answer is unusable
  if (raw.promptFeedback?.blockReason || raw.candidates?.[0]?.finishReason === 'SAFETY') throw new GeminiError('blocked');
  const text = (raw.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('').trim();
  if (!text) throw new GeminiError('empty');
  return { text, model, usage };
}

// What a person sees when the key is missing: plain words for everyone, the secret's name only for the owner
export const notReady = (user: { role: string } | null | undefined, key = 'GEMINI_API_KEY'): string => {
  console.warn('not_enabled', key);
  return user?.role === 'owner' ? 'ما اكتمل تجهيزه. التفاصيل في صفحة الربط.' : 'ما اكتمل تجهيزه، بلّغ الإدارة';
};
// Plain words for a failed call, the same on every tab
export const WHY: Record<GeminiError['code'], string> = {
  no_key: 'ما اكتمل تجهيزه، بلّغ الإدارة', capped: 'وصل الصرف الشهري لهالتاب، بلّغ الإدارة', rate_limited: 'الخدمة مشغولة الحين، جرّب بعد دقيقة',
  blocked: 'ما قدرنا نعالج هالمحتوى', empty: 'ما طلع جواب، جرّب مرة ثانية', failed: 'الخدمة ما ردت، جرّب بعد شوي',
};

// ---- The Files API, for audio and video too big to send inline. The bytes go from R2 to Google as a stream (never held
// in memory); the file is deleted right after the transcript is made, so only text stays.
export interface GeminiFile { name: string; uri: string; mime: string; state: string }
type FileRaw = { file?: { name?: string; uri?: string; mimeType?: string; state?: string } };
const fileOf = (r: FileRaw, mime: string): GeminiFile => ({ name: r.file?.name || '', uri: r.file?.uri || '', mime: r.file?.mimeType || mime, state: r.file?.state || 'PROCESSING' });

// A stream with a known length (Workers' FixedLengthStream), so Google gets a Content-Length without the body being buffered
const fixed = (body: ReadableStream<Uint8Array>, bytes: number): ReadableStream<Uint8Array> => {
  const FLS = (globalThis as { FixedLengthStream?: new (n: number) => { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> } }).FixedLengthStream;
  if (!FLS) return body;
  const s = new FLS(bytes);
  void body.pipeTo(s.writable).catch(() => {});
  return s.readable;
};

export async function uploadFile(e: GeminiEnv, body: ReadableStream<Uint8Array>, mime: string, bytes: number, label: string, f: typeof fetch = fetch): Promise<GeminiFile> {
  if (!e.GEMINI_API_KEY) throw new GeminiError('no_key');
  const key = e.GEMINI_API_KEY;
  try {
    const start = await f(`${BASE}/upload/v1beta/files`, { method: 'POST', headers: {
      'x-goog-api-key': key, 'x-goog-upload-protocol': 'resumable', 'x-goog-upload-command': 'start',
      'x-goog-upload-header-content-length': String(bytes), 'x-goog-upload-header-content-type': mime, 'content-type': 'application/json' },
    body: JSON.stringify({ file: { display_name: label.slice(0, 60) } }) });
    const url = start.headers.get('x-goog-upload-url');
    if (start.status === 429) throw new GeminiError('rate_limited', 429);
    if (!start.ok || !url) throw new GeminiError('failed', start.status);
    const up = await f(url, { method: 'POST', headers: { 'content-length': String(bytes), 'x-goog-upload-offset': '0', 'x-goog-upload-command': 'upload, finalize' }, body: fixed(body, bytes), duplex: 'half' } as RequestInit);
    if (!up.ok) throw new GeminiError('failed', up.status);
    const file = fileOf(await up.json() as FileRaw, mime);
    if (!file.name || !file.uri) throw new GeminiError('failed');
    return file;
  } catch (err) {
    if (err instanceof GeminiError) throw err;
    console.warn('gemini_upload_failed', (err as Error).message);
    throw new GeminiError('failed');
  }
}

// Video is processed after the upload: wait for ACTIVE before asking about it
export async function fileState(e: GeminiEnv, name: string, mime: string, f: typeof fetch = fetch): Promise<GeminiFile> {
  if (!e.GEMINI_API_KEY || !/^files\/[a-z0-9-]{1,60}$/.test(name)) throw new GeminiError('no_key');
  const r = await f(`${BASE}/v1beta/${name}`, { headers: { 'x-goog-api-key': e.GEMINI_API_KEY } }).catch(() => null);
  if (!r?.ok) throw new GeminiError('failed', r?.status ?? 0);
  return fileOf({ file: { ...((await r.json()) as FileRaw['file']) } }, mime);
}

export async function deleteFile(e: GeminiEnv, name: string, f: typeof fetch = fetch): Promise<boolean> {
  if (!e.GEMINI_API_KEY || !/^files\/[a-z0-9-]{1,60}$/.test(name)) return false;
  try { return (await f(`${BASE}/v1beta/${name}`, { method: 'DELETE', headers: { 'x-goog-api-key': e.GEMINI_API_KEY } })).ok; } catch { return false; }
}
