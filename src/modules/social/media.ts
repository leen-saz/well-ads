// Post media in R2: social/<company>/<random>.<ext>, served publicly at /m/<company>/<random>.<ext> (lib/site.ts).
// The name is 128 random bits, so a link can only be found by someone it was shared with (as with Meta's own CDN).
export const MEDIA_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov' };
const MB = 1024 * 1024;
// Limits per kind, enforced from the Content-Length header BEFORE a byte of the body is read. The file is streamed to R2 and
// never held in the Worker's memory (128 MB per isolate, shared by every request on it), so these are Meta's practical limits,
// not memory limits: Instagram takes photos up to 8 MB; a video this size uploads in well under a minute and Meta fetches it quickly.
export const IMAGE_MAX = 8 * MB;
export const VIDEO_MAX = 64 * MB;
export const MEDIA_MAX = VIDEO_MAX;
export const limitOf = (type: string): number => (type.startsWith('video/') ? VIDEO_MAX : IMAGE_MAX);
export const tooBig = (type: string): string => type.startsWith('video/')
  ? `الفيديو أكبر من ${VIDEO_MAX / MB} ميقا. صغّره (قصّه أو اضغطه) وارفعه مرة ثانية`
  : `الصورة أكبر من ${IMAGE_MAX / MB} ميقا. صغّرها وارفعها مرة ثانية`;

// What the first bytes of a file say it is (JPEG, PNG, WebP, MP4/MOV), or null. The declared type must match it.
export function sniff(b: Uint8Array): string | null {
  const at = (i: number, s: string) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && at(1, 'PNG')) return 'image/png';
  if (at(0, 'RIFF') && at(8, 'WEBP')) return 'image/webp';
  if (at(4, 'ftyp')) return at(8, 'qt') ? 'video/quicktime' : 'video/mp4';
  return null;
}
const UUID = /^[0-9a-f-]{36}$/i;

export function mediaKey(company: string, ext: string, rnd: () => string = () => crypto.randomUUID().replace(/-/g, '')): string {
  if (!UUID.test(company)) throw new Error('bad company');
  return `social/${company.toLowerCase()}/${rnd()}.${ext}`;
}

// /m/<company>/<32 hex>.<ext> -> the R2 key, or null
export function mediaPath(pathname: string): string | null {
  const m = pathname.match(/^\/m\/([0-9a-f-]{36})\/([0-9a-f]{32})\.(jpg|png|webp|mp4|mov)$/i);
  return m ? `social/${m[1]!.toLowerCase()}/${m[2]!.toLowerCase()}.${m[3]!.toLowerCase()}` : null;
}
