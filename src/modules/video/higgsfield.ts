// Higgsfield (Seedance) behind the Engine interface. PAID per second of finished video.
// Secrets (Worker secrets, set by the owner; names only in docs/secrets/worker.env.example): HIGGSFIELD_API_KEY, HIGGSFIELD_API_SECRET.
// Optional: HIGGSFIELD_SEEDANCE_MODEL (model path, default bytedance/seedance/v1/lite).
// The request shapes follow Higgsfield Cloud's public docs as mirrored by third parties (docs.higgsfield.ai): the owner
// should check them against the live reference before the first paid run. Nothing here logs a body: it may echo the request.
import { EngineError, avatarOf, avatarPrompt, type Engine, type EngineEnv, type Status } from './engine';

const BASE = 'https://platform.higgsfield.ai';
const DEFAULT_MODEL = 'bytedance/seedance/v1/lite';
const clean = (s: unknown) => String(s ?? '').replace(/[^a-z0-9/._-]/gi, '').replace(/\.\./g, '').slice(0, 80);
const env = (e: EngineEnv, k: string) => String((e as Record<string, unknown>)[k] || '').trim();
const key = (e: EngineEnv) => env(e, 'HIGGSFIELD_API_KEY');
const secret = (e: EngineEnv) => env(e, 'HIGGSFIELD_API_SECRET');

const auth = (e: EngineEnv) => ({ authorization: `Key ${key(e)}:${secret(e)}`, 'content-type': 'application/json', accept: 'application/json' });
const SAY_BUSY = 'محرك الفيديو مشغول، بنعيد المحاولة تلقائي';

// Provider status words → ours
const STATE: Record<string, Status['state']> = { queued: 'queued', in_progress: 'running', processing: 'running', completed: 'done', failed: 'failed', nsfw: 'failed', canceled: 'failed' };

export const higgsfield: Engine = {
  id: 'higgsfield-seedance',
  label: 'Higgsfield · Seedance',
  secrets: ['HIGGSFIELD_API_KEY', 'HIGGSFIELD_API_SECRET'],
  caps: {
    kinds: ['text-to-video', 'image-to-video', 'avatar'],
    ratios: ['9:16', '1:1', '16:9'],
    clipSeconds: [5, 10],
    resolutions: ['720p', '1080p'],
    maxPromptChars: 1500,
    needsImage: ['image-to-video'],
    needsVoice: ['avatar'],
  },
  configured: e => !!key(e) && !!secret(e),

  async submit(e, i, f = fetch) {
    const model = clean(env(e, 'HIGGSFIELD_SEEDANCE_MODEL')) || DEFAULT_MODEL;
    const hasImage = !!i.imageUrl;
    const avatar = i.kind === 'avatar' ? avatarOf(i.avatarId) : undefined;
    const prompt = avatar ? avatarPrompt(avatar, i.prompt) : i.prompt;
    const body: Record<string, unknown> = { prompt, aspect_ratio: i.ratio, duration: i.seconds, resolution: i.resolution,
      ...(hasImage ? { image_url: i.imageUrl } : {}), ...(i.voiceUrl ? { audio_url: i.voiceUrl } : {}) };
    let r: Response;
    try { r = await f(`${BASE}/${model}/${hasImage ? 'image-to-video' : 'text-to-video'}`, { method: 'POST', headers: auth(e), body: JSON.stringify(body) }); }
    catch { throw new EngineError('network', true, SAY_BUSY); }
    if (r.status === 401 || r.status === 403) throw new EngineError('auth', false, 'مفاتيح محرك الفيديو مرفوضة، بلّغ الإدارة');
    if (r.status === 429 || r.status >= 500) throw new EngineError(r.status === 429 ? 'rate' : 'upstream', true, SAY_BUSY);
    if (!r.ok) throw new EngineError('rejected', false, 'المحرك رفض الطلب، عدّل الوصف أو الصورة وجرّب');
    const j = (await r.json().catch(() => ({}))) as { request_id?: unknown };
    const ref = typeof j.request_id === 'string' ? j.request_id : '';
    if (!/^[\w-]{6,80}$/.test(ref)) throw new EngineError('no_ref', true, SAY_BUSY);
    return { ref };
  },

  async status(e, ref, f = fetch) {
    if (!/^[\w-]{6,80}$/.test(ref)) throw new EngineError('bad_ref', false, 'طلب غير صحيح');
    let r: Response;
    try { r = await f(`${BASE}/requests/${ref}/status`, { headers: auth(e) }); }
    catch { throw new EngineError('network', true, SAY_BUSY); }
    if (r.status === 429 || r.status >= 500) throw new EngineError('upstream', true, SAY_BUSY);
    if (!r.ok) throw new EngineError('status_failed', false, 'ما قدرنا نعرف حالة الفيديو');
    const j = (await r.json().catch(() => ({}))) as { status?: string; video?: { url?: string }; videos?: { url?: string }[] };
    const state = STATE[String(j.status || '').toLowerCase()] ?? 'running';
    const url = j.video?.url || j.videos?.[0]?.url;
    if (state === 'done' && !url) return { state: 'failed', code: 'no_video' };
    return { state, ...(state === 'done' ? { url } : {}), ...(state === 'failed' ? { code: String(j.status || 'failed').toLowerCase() === 'nsfw' ? 'blocked' : 'failed' } : {}) };
  },
};
