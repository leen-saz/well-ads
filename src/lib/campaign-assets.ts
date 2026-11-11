// The files a campaign's agents make (docs/ahlam.md): pictures by the Design module's image maker, speech by the Voiceover module's TTS. Both go
// through the same adapters, caps and cost records as their own tabs (src/lib/llm.ts imageOf: the Design tab's cap; the Gemini speech call:
// the Voiceover tab's cap). A file is kept in R2 under campaign/<company>/<campaign>/ and shown in the pack through /api/campaigns/file.
// When a maker cannot produce something (no key, the cap, a refusal, no storage) the answer says exactly why: nothing is hidden or faked.
import { sb, type Cfg, type Session } from './auth';
import { scoped } from './tenant';
import { imageOf, IMAGE_USD, type LlmEnv } from './llm';
import { WHY, geminiReady, notReady, type GeminiEnv } from './gemini';
import { overCap, record, usageCtx } from './usage';
import { backgroundPrompt, imageMiss, SIZES, WELL_PALETTE } from '../modules/design/design';
import { TTS_MODEL } from '../modules/voice/voice';
import { DEFAULTS, body as ttsBody, choice, guessUsage, usageIn, type Choice } from '../modules/voiceover/voiceover';
import type { Brand } from '../modules/knowledge/brand';

export type AssetEnv = LlmEnv & GeminiEnv & { FILES?: R2Bucket };
export interface Miss { miss: string; message: string; retry: boolean }
export const isMiss = (x: unknown): x is Miss => !!x && typeof x === 'object' && 'miss' in x;

// ---- what a campaign draws: the sizes its platforms need (one image per size, at most 3)
export const DESIGN_SIZES: Record<string, string[]> = { meta: ['story', 'square'], tiktok: ['story'], snapchat: ['story'], google: ['landscape', 'square'], x: ['landscape'] };
export function designSizes(platforms: string[]): string[] {
  const out = new Set<string>();
  for (const p of platforms) for (const s of DESIGN_SIZES[p] ?? []) out.add(s);
  return out.size ? [...out].slice(0, 3) : ['story', 'square'];
}
const PX: Record<string, '1024x1536' | '1024x1024' | '1536x1024'> = { story: '1024x1536', portrait: '1024x1536', square: '1024x1024', landscape: '1536x1024' };
export const TTS_VERSIONS = 2;   // the 30-second and the 10-second reading
// What the paid makers add to a campaign's estimate, before anything runs (the picture is billed per image, the speech by tokens)
export const TTS_USD = 0.03;
export function assetUsd(agent: string, platforms: string[]): number {
  if (agent === 'design') return Math.round(designSizes(platforms).length * IMAGE_USD * 1e6) / 1e6;
  if (agent === 'voice') return Math.round(TTS_VERSIONS * TTS_USD * 1e6) / 1e6;
  return 0;
}

// ---- the brand, as the agents are told it: the guide's palette, fonts and rule, plus what the company saved. Nothing is invented.
export const WELL_BRAND = `هوية Well (دليل الهوية، باليت v2.1): الألوان المعتمدة فقط: ${[['Purple Deep', '#221196'], ['Well Indigo', '#1D1069'], ['Pulse Purple', '#7E57FD'], ['Purple Soft', '#ACA6E1'], ['Pulse Pink', '#F86080'], ['عاجي', '#F6F0E3'], ['أبيض', '#FFFFFF']].map(([n, h]) => `${n} ${h}`).join('، ')}. قاعدة الـ3%: Pulse Pink لمسة صغيرة واحدة فقط (لا تتجاوز 3% من القطعة). الخطوط: Playfair Display للعناوين اللاتينية، Inter للنصوص اللاتينية، Noto Naskh Arabic للعربي. لا تستخدم أي لون أو خط خارج هذي القائمة، ولا تقل «أخضر Well».`;
export function brandText(brand: Pick<Brand, 'colors' | 'notes'>): string {
  return `${WELL_BRAND}${brand.colors.length ? `\nألوان العلامة المحفوظة في المعرفة: ${brand.colors.join(' ')}` : ''}${brand.notes.length ? `\nوصف مراجع الهوية البصرية: ${brand.notes.slice(0, 3).join(' | ')}` : ''}`;
}

// ---- the picture
export interface Picture { bytes: Uint8Array<ArrayBuffer>; mime: string; size: string; w: number; h: number }
export async function drawPicture(e: AssetEnv, cfg: Cfg, user: Session, size: string, input: { offer: string; audience: string; dept: string }, colors: string[], style: string, f: typeof fetch = fetch): Promise<Picture | Miss> {
  const out = await imageOf(e, backgroundPrompt({ type: size === 'story' ? 'story' : 'ad', ...input }, colors.length ? colors : WELL_PALETTE, style), f, undefined, usageCtx(cfg, user), PX[size] ?? '1024x1536');
  if (!out.image) { const m = imageMiss(out, user); return { miss: m?.code ?? 'failed', message: m?.message ?? 'خدمة الصور ما ردّت', retry: m?.retry ?? true }; }
  const b64 = out.image.replace(/^data:image\/jpeg;base64,/, ''), bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const s = SIZES[size] ?? SIZES['story']!;
  return { bytes, mime: 'image/jpeg', size, w: s.w, h: s.h };
}

// ---- the speech (16-bit PCM from the model -> a WAV file)
export function pcmToWav(pcm: Uint8Array, rate = 24000): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(44 + pcm.length), v = new DataView(out.buffer);
  const tag = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  tag(0, 'RIFF'); v.setUint32(4, 36 + pcm.length, true); tag(8, 'WAVE'); tag(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); tag(36, 'data'); v.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}
export function parseSpeech(raw: string): { pcm: Uint8Array; rate: number } | null {
  try {
    const j = JSON.parse(raw) as { candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string }; inline_data?: { data?: string; mime_type?: string } }[] } }[] };
    for (const p of j.candidates?.[0]?.content?.parts ?? []) {
      const d = p.inlineData ?? p.inline_data;
      const data = d?.data, mime = (d as { mimeType?: string; mime_type?: string } | undefined)?.mimeType ?? (d as { mime_type?: string } | undefined)?.mime_type ?? '';
      if (!data) continue;
      const bin = atob(data), pcm = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) pcm[i] = bin.charCodeAt(i);
      return { pcm, rate: Number(/rate=(\d+)/.exec(mime)?.[1]) || 24000 };
    }
  } catch { /* not the shape: no speech */ }
  return null;
}
export interface Speech { wav: Uint8Array<ArrayBuffer>; seconds: number }
export async function speakText(e: AssetEnv, cfg: Cfg, user: Session, text: string, voice: Choice, f: typeof fetch = fetch): Promise<Speech | Miss> {
  if (!geminiReady(e)) return { miss: 'no_key', message: notReady(user), retry: false };
  const ctx = usageCtx(cfg, user, 'voiceover');
  if (ctx && await overCap(ctx, 'voiceover')) return { miss: 'capped', message: WHY.capped, retry: false };
  const model = (e.GEMINI_TTS_MODEL || TTS_MODEL).replace(/[^a-z0-9.\-]/gi, '');
  let r: Response;
  try {
    r = await f(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': e.GEMINI_API_KEY! }, body: JSON.stringify(ttsBody({ ...voice, text })) });
  } catch { return { miss: 'failed', message: WHY.failed, retry: true }; }
  if (r.status === 429) return { miss: 'rate_limited', message: WHY.rate_limited, retry: true };
  if (!r.ok) return { miss: 'failed', message: WHY.failed, retry: true };
  const raw = await r.text(), sp = parseSpeech(raw);
  if (!sp) return { miss: 'empty', message: WHY.empty, retry: true };
  const real = usageIn(raw);
  record(ctx, 'voiceover', { provider: 'gemini', model, usage: real ?? guessUsage(text, raw), estimated: !real });
  return { wav: pcmToWav(sp.pcm, sp.rate), seconds: Math.round((sp.pcm.length / (sp.rate * 2)) * 10) / 10 };
}

// Subtitles from a script and the length of its recording: phrases of at most ~42 characters, timed by their share of the characters
const tc = (s: number) => { const ms = Math.round(s * 1000), p = (n: number, w = 2) => String(n).padStart(w, '0'); return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`; };
export function srtOf(text: string, seconds: number): string {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean), parts: string[] = [];
  let cur = '';
  for (const w of words) { if (cur && (cur + ' ' + w).length > 42) { parts.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; }
  if (cur) parts.push(cur);
  const total = parts.reduce((s, p) => s + p.length, 0) || 1;
  let at = 0;
  return parts.map((p, i) => { const d = (p.length / total) * seconds, line = `${i + 1}\n${tc(at)} --> ${tc(at + d)}\n${p}\n`; at += d; return line; }).join('\n');
}

// ---- storage: R2, one folder per campaign, served only through /api/campaigns/file (which checks who may see the campaign)
const rnd = () => crypto.randomUUID().replace(/-/g, '');
export const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'audio/wav': 'wav' };
export const assetKey = (co: string, campaign: string, ext: string): string => `campaign/${co}/${campaign}/${rnd()}.${ext}`;
export const ownAsset = (co: string, campaign: string, key: unknown): key is string => typeof key === 'string' && new RegExp(`^campaign/${co}/${campaign}/[0-9a-f]{32}\\.(jpg|png|wav)$`).test(key);
export async function keep(e: AssetEnv, co: string, campaign: string, bytes: Uint8Array<ArrayBuffer>, mime: string): Promise<string | Miss> {
  if (!e.FILES) return { miss: 'no_storage', message: 'تخزين الملفات مو مفعّل في هالبيئة، فما انحفظ الملف.', retry: false };
  const key = assetKey(co, campaign, EXT[mime] ?? 'bin');
  try { await e.FILES.put(key, bytes, { httpMetadata: { contentType: mime } }); } catch { return { miss: 'no_storage', message: 'ما قدرت أحفظ الملف الحين، جرّب مرة ثانية.', retry: true }; }
  return key;
}
// The files of outputs that are being dropped (a rewrite): deleted from R2 as well, so nothing is left behind
export async function dropAssets(cfg: Cfg, e: AssetEnv, co: string, filter: string): Promise<void> {
  const r = await sb<{ body?: { key?: unknown } }[]>(cfg, scoped(`/rest/v1/campaign_outputs?select=body&${filter}`, co), { admin: true });
  const keys = (r.ok && Array.isArray(r.data) ? r.data : []).map(x => x.body?.key).filter((k): k is string => typeof k === 'string' && k.startsWith(`campaign/${co}/`));
  if (keys.length && e.FILES) { try { await e.FILES.delete(keys); } catch { /* the rows go anyway: an orphan file is only space */ } }
  await sb(cfg, scoped(`/rest/v1/campaign_outputs?${filter}`, co), { method: 'DELETE', admin: true });
}

// ---- the budget guard: a riyal amount the user never gave must not appear in the optimization plan
export const MONEY = /\d[\d,.٫٬]*\s*(?:ألف\s*)?(?:ريال|ر\.?\s?س|SAR|﷼)/i;
export const moneyIn = (text: string): boolean => MONEY.test(text);

// The brand's saved voice (Voiceover tab settings), or the default; a missing table is the default too
export async function brandVoice(cfg: Cfg, co: string): Promise<Choice> {
  const r = await sb<Record<string, unknown>[]>(cfg, scoped('/rest/v1/voiceover_settings?select=voice,accent,tone,pace&limit=1', co), { admin: true });
  return r.ok && Array.isArray(r.data) && r.data[0] ? choice(r.data[0]) : DEFAULTS;
}
