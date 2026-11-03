// Motion-graphics video (docs/motion-video.md). OpenAI's video API was shut down on 2026-09-24, so the video is code:
// ChatGPT writes a scene plan (Spec) over the approved design and voice, the browser animates it
// (public/modules/design/frame.js). Every plan from a model passes cleanSpec() before it is stored.
import type { Msg } from '../../lib/llm';

export type Ratio = '9:16' | '1:1' | '16:9';
export type Anim = 'fade' | 'rise' | 'pop' | 'type' | 'slide';
export type Move = 'in' | 'out' | 'left' | 'right' | 'none';
export interface Scene { from: number; to: number; text: string; anim: Anim; pos: 'top' | 'center' | 'bottom'; size: 's' | 'm' | 'l' }
export interface Spec { seconds: number; ratio: Ratio; move: Move; colors: { text: string; band: string; accent: string }; scenes: Scene[]; cta: { text: string; from: number } | null }

export const RATIOS: Ratio[] = ['9:16', '1:1', '16:9'];
export const ANIMS: Record<Anim, string> = { fade: 'ظهور ناعم', rise: 'يطلع من تحت', pop: 'تكبير سريع', type: 'كتابة حرف حرف', slide: 'سحب من الجنب' };
const MOVES: Move[] = ['in', 'out', 'left', 'right', 'none'];
const POS = ['top', 'center', 'bottom'] as const;
const SIZES = ['s', 'm', 'l'] as const;
const HEX = /^#[0-9a-f]{6}$/i;
export const MAX_SCENES = 12;
export const DEFAULT_COLORS = { text: '#FFFFFF', band: '#1D1069', accent: '#E9A23B' };

const num = (v: unknown, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n * 10) / 10)) : d; };
const one = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list as readonly unknown[]).includes(v) ? v as T : d;
const line = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// The voice length: under 3 seconds is no video (0), over 90 is cut to 90
export const clampSeconds = (v: unknown): number => Number(v) >= 3 ? num(v, 3, 90, 0) : 0;
export const ratioOf = (v: unknown): Ratio => one(v, RATIOS, '9:16');

// A plan from anywhere (model, template, stored row) → a safe plan, or null when nothing usable is left.
// Times are clamped to the voice length, scenes sorted and capped, unknown animations/colours replaced.
export function cleanSpec(raw: unknown, seconds: number, ratio: Ratio, brand: string[] = []): Spec | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const c = (r.colors && typeof r.colors === 'object' ? r.colors : {}) as Record<string, unknown>;
  const pal = brand.filter(x => HEX.test(x));
  const colour = (v: unknown, d: string) => HEX.test(String(v)) ? String(v).toUpperCase() : d;
  const scenes = (Array.isArray(r.scenes) ? r.scenes : []).map((s: Record<string, unknown>): Scene | null => {
    const text = line(s?.text, 90);
    const from = num(s?.from, 0, seconds, -1), to = num(s?.to, 0, seconds, -1);
    if (!text || from < 0 || to - from < 0.5) return null;
    return { from, to, text, anim: one(s.anim, Object.keys(ANIMS) as Anim[], 'fade'), pos: one(s.pos, POS, 'center'), size: one(s.size, SIZES, 'm') };
  }).filter((s): s is Scene => !!s).sort((a, b) => a.from - b.from);
  // Overlaps would stack two texts: an earlier scene ends where the next one starts
  scenes.forEach((s, k) => { const next = scenes[k + 1]; if (next && s.to > next.from) s.to = next.from; });
  scenes.splice(0, scenes.length, ...scenes.filter(s => s.to - s.from >= 0.5).slice(0, MAX_SCENES));
  const ctaRaw = (r.cta && typeof r.cta === 'object' ? r.cta : null) as Record<string, unknown> | null;
  const ctaText = line(ctaRaw?.text, 40);
  const cta = ctaText ? { text: ctaText, from: num(ctaRaw?.from, 0, Math.max(0, seconds - 1), Math.max(0, seconds - 3)) } : null;
  if (!scenes.length && !cta) return null;
  return {
    seconds, ratio, move: one(r.move, MOVES, 'in'), scenes, cta,
    colors: { text: colour(c.text, DEFAULT_COLORS.text), band: colour(c.band, pal[0] || DEFAULT_COLORS.band), accent: colour(c.accent, pal[1] || DEFAULT_COLORS.accent) },
  };
}

// Without a model: the headline first, then the script's sentences spread over the voice, and a CTA at the end
export function templateSpec(i: { headline: string; script: string; seconds: number; ratio: Ratio; colors?: string[] }): Spec | null {
  const parts = i.script.split(/(?<=[.!؟?،\n])\s*/).map(s => s.trim()).filter(Boolean).slice(0, MAX_SCENES - 1);
  const texts = [i.headline.trim(), ...parts].filter(Boolean);
  const end = Math.max(1.5, i.seconds - 2.5), step = end / Math.max(1, texts.length);
  const anims: Anim[] = ['pop', 'rise', 'fade', 'slide'];
  return cleanSpec({
    move: 'in',
    scenes: texts.map((text, k) => ({ text, from: k * step, to: (k + 1) * step, anim: k === 0 ? 'pop' : anims[k % anims.length], pos: k === 0 ? 'center' : 'bottom', size: k === 0 ? 'l' : 'm' })),
    cta: { text: 'احجز الحين', from: end },
  }, i.seconds, i.ratio, i.colors);
}

// The JSON object in a model's answer (bare, fenced or with words around it)
export function parseSpec(text: string): unknown {
  const t = text.replace(/```(?:json)?/gi, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}

const SHAPE = `{"move":"in|out|left|right|none","colors":{"text":"#RRGGBB","band":"#RRGGBB","accent":"#RRGGBB"},"scenes":[{"from":0,"to":2.5,"text":"...","anim":"${Object.keys(ANIMS).join('|')}","pos":"top|center|bottom","size":"s|m|l"}],"cta":{"text":"...","from":0}}`;
const RULES = `قواعد:
- الأوقات بالثواني من 0 إلى المدة، والمشاهد ما تتداخل، وكل مشهد 1.5 ثانية على الأقل.
- النص قصير (أقل من 90 حرف)، بلهجة سعودية، يخاطب المتلقي بالمذكر، ويمشي مع الكلام المسموع في وقته.
- ممنوع وعود الشفاء أو المبالغة الطبية (أنظمة وزارة الصحة).
- رد بـ JSON فقط بهالشكل: ${SHAPE}`;

export function specPrompt(i: { headline: string; script: string; seconds: number; ratio: Ratio; colors: string[] }): Msg[] {
  return [{ role: 'user', content: `أنت مصمم موشن جرافيك لإعلانات Well (رعاية صحية منزلية في السعودية).
عندك تصميم معتمد (صورة ثابتة، مقاس ${i.ratio}) وتعليق صوتي معتمد مدته ${i.seconds} ثانية. اكتب خطة مشاهد تتحرك فوق التصميم على وقت الصوت.
العنوان: ${i.headline || '—'}
نص التعليق الصوتي: ${i.script || '—'}
${i.colors.length ? `ألوان العلامة: ${i.colors.join(' ')}` : ''}
${RULES}` }];
}

// An edit: the current plan and the user's words → a full new plan (the old one stays as its own version)
export function editPrompt(current: Spec, change: string): Msg[] {
  return [{ role: 'user', content: `هذي خطة فيديو موشن حالية (JSON):
${JSON.stringify({ move: current.move, colors: current.colors, scenes: current.scenes, cta: current.cta })}
المدة ${current.seconds} ثانية، والمقاس ${current.ratio}.
المستخدم طلب هالتعديل: «${change}»
طبّق التعديل بس، وخل الباقي مثل ما هو. رجّع الخطة كاملة.
${RULES}` }];
}

// Uploads: the design image and the voice file, kept in R2 under motion/<company>/
export const UPLOAD: Record<'design' | 'voice', { types: Record<string, string>; max: number; label: string }> = {
  design: { types: { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }, max: 8_000_000, label: 'التصميم لازم PNG أو JPG أو WebP' },
  voice: { types: { 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a' }, max: 20_000_000, label: 'الصوت لازم WAV أو MP3 أو M4A' },
};
export function checkUpload(kind: string, type: string, size: number): { ext?: string; error?: string } {
  const u = UPLOAD[kind as 'design' | 'voice'];
  if (!u) return { error: 'نوع غير معروف' };
  const ext = u.types[type];
  if (!ext) return { error: u.label };
  if (size > u.max) return { error: `الملف أكبر من الحد (${Math.round(u.max / 1e6)} ميقا)` };
  if (size <= 0) return { error: 'الملف فاضي' };
  return { ext };
}
export const fileKey = (co: string, ext: string, rnd: () => string = () => crypto.randomUUID().replace(/-/g, '')) => `motion/${co}/${rnd()}.${ext}`;
export const ownKey = (co: string, key: unknown): key is string => typeof key === 'string' && new RegExp(`^motion/${co}/[0-9a-f]{32}\\.(png|jpg|webp|wav|mp3|m4a)$`).test(key);
