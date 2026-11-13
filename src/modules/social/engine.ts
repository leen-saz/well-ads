// The publishing-engine layer of the Social tab: which platform goes out through which engine, what each platform accepts
// (the capability map), the shape of a result, and the checks that run BEFORE any call leaves for a platform.
//
// Two engines publish for us, and only after the named approver approved the post (cron.ts is the only caller):
//   native: our own Graph API code (social.ts) for Facebook and Instagram.
//   postiz: an open-source publisher we call over HTTPS (postiz.ts) for TikTok, X and LinkedIn. Postiz is only an engine:
//           its own approval or draft features are never used as the gate (see docs/social-engine.md).
// A platform with no engine (Snapchat) is saved as a reminder.
//
// Adding a platform Postiz supports: one SOCIAL entry here (engine: 'postiz', limits), its Postiz identifier and settings in
// postiz.ts (IDENT, settingsFor), and its name in i18n-en.js. Nothing else.
export type EngineId = 'native' | 'postiz';

export const SOCIAL = {
  facebook: { name: 'فيسبوك', max: 63206, engine: 'native', live: true },
  instagram: { name: 'انستقرام', max: 2200, engine: 'native', live: true, needsMedia: true },
  tiktok: { name: 'تيك توك', max: 2200, engine: 'postiz', live: true, needsMedia: true },
  x: { name: 'X', max: 280, engine: 'postiz', live: true },
  linkedin: { name: 'لينكدإن', max: 3000, engine: 'postiz', live: true },
  snapchat: { name: 'سناب شات', max: 250, engine: null, live: false, needsMedia: true },
} as const;
// `live` here = "an engine exists in the code for this platform". Whether it can go out right now (engine configured and the
// account connected) is decided at run time: social.ts readiness() and the status the routes compute.
export type SocialPlatform = keyof typeof SOCIAL;
export const engineOf = (p: SocialPlatform): EngineId | null => SOCIAL[p].engine;

export interface Media { url: string; type: 'image' | 'video' }
export interface Draft { platforms: SocialPlatform[]; body: string; media: Media[]; publish_at: string; mode: 'auto' | 'manual' }
export type Tokens = Record<string, string | undefined>;

// ---- Results. One per platform, kept on the post (social_posts.results) so a crash or a retry knows what already went out.
// code = the plain reason the page shows (the client has its words); detail = the platform's own message, for the owner only.
export type Code = 'not_connected' | 'no_media' | 'token' | 'permission' | 'busy' | 'media_rejected' | 'video_failed' | 'video_timeout' | 'unconfirmed' | 'unsaved' | 'network' | 'platform' | 'unsupported' | 'invalid' | 'many_accounts';
export interface Result {
  ok: boolean; id?: string; code?: Code; detail?: string;
  // sending = the call that posts was started (a crash here leaves it unknown); processing = the platform is still preparing
  // or sending it (the next run continues it); publishing = Instagram's container is ready and the publish call was started
  state?: 'sending' | 'processing' | 'publishing'; creation_id?: string; since?: string;
  // postiz engine only: the channel the post went to and the media already uploaded for it (so a continued run does not repeat them)
  channel?: string; media?: { id: string; path: string }[];
}
export type Results = Record<string, Result>;

export class Fail extends Error { constructor(public code: Code, public detail = '') { super(code); } }

export interface Ctx {
  save?: (r: Result) => Promise<void>;       // persist the platform's progress before the next step (crash safety)
  wait?: (ms: number) => Promise<void>;
  now?: number; polls?: number; pollMs?: number;
  timeoutMs?: number;                        // postiz: per-call timeout
}

// ---- Capability map: what each platform accepts of the media. Body length and "needs media" are in SOCIAL.
interface Cap { images: number; mp4Only?: boolean }
export const CAPS: Record<SocialPlatform, Cap> = {
  facebook: { images: 10 }, instagram: { images: 10 }, snapchat: { images: 1 },
  // the Postiz upload accepts mp4 for video (not mov or webm)
  tiktok: { images: 35, mp4Only: true }, x: { images: 4, mp4Only: true }, linkedin: { images: 9, mp4Only: true },
};
// How a platform counts a text against its limit. Only X differs from a plain character count: any link counts 23 whatever its
// length (t.co), an emoji counts 2 however it is built (skin tone, joiner), and every other character counts 1 only inside the
// ranges X lists (Latin up to U+10FF, which holds Arabic; general punctuation U+2000-200D, U+2010-201F, U+2032-2037) and 2
// outside them. So CJK counts 2, and so do the ellipsis (U+2026), the bullet (U+2022), arrows and the rial sign (U+FDFC), which
// Arabic copy uses often (https://docs.x.com/fundamentals/counting-characters, read 2026-11-12; the ranges are X's own
// twitter-text config v3: https://github.com/twitter/twitter-text/blob/master/config/v3.json, read 2026-11-13). The text is
// counted in NFC, as X does. Counting by .length would refuse a post X accepts whenever it carries a long booking link, and
// would accept a post X refuses when it is near the limit and carries those signs.
const URL_RE = /https?:\/\/[^\s]+/gi, EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const xWeight = (cp: number): number => (cp <= 0x10ff || (cp >= 0x2000 && cp <= 0x200d) || (cp >= 0x2010 && cp <= 0x201f) || (cp >= 0x2032 && cp <= 0x2037) ? 1 : 2);
export function textLength(platform: SocialPlatform, body: string): number {
  if (platform !== 'x') return body.length;
  let n = 0;
  for (const part of body.normalize('NFC').split(URL_RE).flatMap((t, i, a) => (i < a.length - 1 ? [t, null] : [t]))) {
    if (part === null) { n += 23; continue; }
    for (const { segment: g } of GRAPHEMES.segment(part)) {
      if (EMOJI_RE.test(g)) n += 2;
      else for (const ch of g) n += xWeight(ch.codePointAt(0)!);
    }
  }
  return n;
}
const BAD_VIDEO = /\.(mov|webm|m4v|avi)(\?|#|$)/i;

// Before any upstream call: does this post fit the platform? '' = yes, else the plain reason (Arabic, the user's words).
export function capCheck(platform: SocialPlatform, post: Pick<Draft, 'body' | 'media'>): string {
  const s = SOCIAL[platform], c = CAPS[platform];
  const imgs = post.media.filter(m => m.type === 'image'), vids = post.media.filter(m => m.type === 'video');
  if (textLength(platform, post.body) > s.max) return `النص أطول من حد ${s.name} (${s.max} حرف)`;
  if (vids.length > 1) return 'فيديو واحد بس لكل منشور';
  if (vids.length && imgs.length) return 'فيديو واحد أو صور، مو الاثنين مع بعض';
  if (imgs.length > c.images) return `${s.name} يقبل ${c.images} ${c.images === 1 ? 'صورة' : 'صور'} على الأكثر`;
  if (c.mp4Only && vids.some(v => BAD_VIDEO.test(v.url))) return `${s.name} يقبل الفيديو بصيغة MP4 بس`;
  if (!post.body && !post.media.length) return 'اكتب نص أو أضف صورة/فيديو';
  if ('needsMedia' in s && s.needsMedia && !post.media.length) return `${s.name} يحتاج صورة أو فيديو`;
  return '';
}
