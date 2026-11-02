// Post media in R2: social/<company>/<random>.<ext>, served publicly at /m/<company>/<random>.<ext> (lib/site.ts).
// The name is 128 random bits, so a link can only be found by someone it was shared with (as with Meta's own CDN).
export const MEDIA_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov' };
export const MEDIA_MAX = 95 * 1024 * 1024;
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
