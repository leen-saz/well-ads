// The video engine layer. A tab never talks to a provider: it talks to an Engine, which says what it can do (a capability
// map) and checks every request against that map BEFORE anything goes upstream, so the user gets a clear sentence in
// Arabic instead of the provider's raw 400. Pure: no network here (the adapters in higgsfield.ts do the calls).
// The two-engine idea and the capability map are inspired by DaVinci's AI Influencer; no code or prompt is copied.
export const RATIOS = ['9:16', '1:1', '16:9'] as const;
export type Ratio = typeof RATIOS[number];
export const AD_SECONDS = [15, 30, 60] as const;
export type Kind = 'text-to-video' | 'image-to-video' | 'avatar';
export const KIND_AR: Record<Kind, string> = { 'text-to-video': 'من وصف', 'image-to-video': 'من صورة', avatar: 'أفاتار يتكلم' };

export interface Capability {
  kinds: Kind[];
  ratios: Ratio[];
  clipSeconds: number[];          // lengths one clip can have
  resolutions: string[];
  maxPromptChars: number;
  needsImage: Kind[];             // kinds that must come with a source image
  needsVoice: Kind[];             // kinds that must come with a voice file
}

// What one clip request holds, after cleaning
export interface ClipInput {
  kind: Kind; prompt: string; ratio: Ratio; seconds: number; resolution: string;
  imageUrl?: string; voiceUrl?: string; avatarId?: string;
}
export interface Status { state: 'queued' | 'running' | 'done' | 'failed'; url?: string | undefined; code?: string | undefined }

// retryable: the same request may work later (a busy engine, a network drop). Anything else is the request's own fault.
export class EngineError extends Error {
  constructor(readonly code: string, readonly retryable: boolean, readonly say: string) { super(code); }
}

export type EngineEnv = object;
export interface Engine {
  id: string;
  label: string;
  caps: Capability;
  // the secret names the owner must set; shown as a hint to the owner only
  secrets: string[];
  configured(e: EngineEnv): boolean;
  submit(e: EngineEnv, i: ClipInput, f?: typeof fetch): Promise<{ ref: string }>;
  status(e: EngineEnv, ref: string, f?: typeof fetch): Promise<Status>;
}

const httpsUrl = (u: unknown): string | null => {
  try { const x = new URL(String(u)); return x.protocol === 'https:' && !x.username && !x.password ? x.toString() : null; } catch { return null; }
};

// Checks a request against an engine's map. Returns the cleaned input, or every problem in plain Arabic (never a code).
export function validate(caps: Capability, raw: Record<string, unknown>): { input?: ClipInput; problems: string[] } {
  const problems: string[] = [];
  const kind = String(raw.kind || '') as Kind;
  if (!caps.kinds.includes(kind)) problems.push('نوع الفيديو هذا ما يدعمه المحرك');
  const ratio = String(raw.ratio || '') as Ratio;
  if (!caps.ratios.includes(ratio)) problems.push(`المقاس ${ratio || 'غير محدد'} ما يدعمه المحرك، المتاح: ${caps.ratios.join(' و ')}`);
  const seconds = Number(raw.seconds);
  if (!caps.clipSeconds.includes(seconds)) problems.push(`اللقطة الواحدة ${caps.clipSeconds.join(' أو ')} ثواني بس`);
  const resolution = String(raw.resolution || caps.resolutions[0]);
  if (!caps.resolutions.includes(resolution)) problems.push(`الدقة ${resolution} غير متاحة، المتاح: ${caps.resolutions.join(' و ')}`);
  const prompt = String(raw.prompt ?? '').replace(/\s+/g, ' ').trim();
  if (!prompt) problems.push('اكتب وصف اللقطة');
  else if (prompt.length > caps.maxPromptChars) problems.push(`وصف اللقطة أطول من المسموح (${caps.maxPromptChars} حرف)`);
  const imageUrl = raw.imageUrl ? httpsUrl(raw.imageUrl) : null;
  if (raw.imageUrl && !imageUrl) problems.push('رابط الصورة لازم يبدأ بـ https');
  if (caps.needsImage.includes(kind) && !imageUrl) problems.push('هالنوع يحتاج صورة');
  const voiceUrl = raw.voiceUrl ? httpsUrl(raw.voiceUrl) : null;
  if (raw.voiceUrl && !voiceUrl) problems.push('رابط الصوت لازم يبدأ بـ https');
  if (caps.needsVoice.includes(kind) && !voiceUrl) problems.push('الأفاتار يحتاج ملف صوت');
  if (problems.length) return { problems };
  const avatarId = raw.avatarId ? String(raw.avatarId).replace(/[^a-z0-9_-]/gi, '').slice(0, 40) : undefined;
  return { problems, input: { kind, prompt, ratio, seconds, resolution, ...(imageUrl ? { imageUrl } : {}), ...(voiceUrl ? { voiceUrl } : {}), ...(avatarId ? { avatarId } : {}) } };
}

// A 15, 30 or 60 second ad is a list of clips. Plans the clip lengths for an ad length with the engine's own clip sizes.
export function splitSeconds(total: number, clips: number[]): number[] {
  const sizes = [...clips].sort((x, y) => y - x), smallest = sizes[sizes.length - 1] as number, out: number[] = [];
  for (let left = total; left > 0;) { const fit = sizes.find(c => c <= left) ?? smallest; out.push(fit); left -= fit; }
  return out;
}

// ---- Avatar registry: skills, not one fixed avatar. Each skill says what it needs and how the shot is written.
export interface AvatarSkill { id: string; ar: string; en: string; does: string; doesEn: string; needsVoice: boolean }
export const AVATARS: AvatarSkill[] = [
  { id: 'presenter', ar: 'مقدّم يشرح', en: 'Presenter', does: 'شخص يقدّم الخدمة مباشرة للكاميرا، بنبرة هادئة وواثقة', doesEn: 'A person presenting the service straight to camera, calm and confident', needsVoice: true },
  { id: 'doctor-voice', ar: 'صوت طبي هادئ', en: 'Calm clinical voice', does: 'لقطة رسمية بخلفية عيادة، بدون وعود علاج', doesEn: 'A formal clinic setting, no cure promises', needsVoice: true },
  { id: 'friendly-host', ar: 'مقدّمة ودودة', en: 'Friendly host', does: 'مقدّمة قريبة من الجمهور تحكي تجربة الخدمة بخفة', doesEn: 'A relatable host sharing the service experience lightly', needsVoice: true },
];
export const avatarOf = (id: unknown): AvatarSkill | undefined => AVATARS.find(a => a.id === id);
export const avatarPrompt = (a: AvatarSkill, line: string): string => `${a.doesEn}. Speaking to camera in Saudi Arabic: "${line}"`;
