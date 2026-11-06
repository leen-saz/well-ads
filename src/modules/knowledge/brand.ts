// الهوية والبصريات: ملفات العلامة لكل شركة (الشعار، الألوان، الخطوط، دليل العلامة، صور مرجعية).
// الملفات في R2 تحت brand/<company>/<random>.<ext> وما تنفتح إلا من السيرفر بعد التحقق من الشركة والصلاحية.
// التصميم يقرا الفعّال منها في كل مرة (brandFor)، فالمستخدم ما يرفعها كل مرة.
import { sb, json, type Cfg } from '../../lib/auth';
import { scoped } from '../../lib/tenant';

export type BrandKind = 'logo' | 'colors' | 'font' | 'guide' | 'reference';
const IMG = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const MB = 1024 * 1024;
// Allowed types and sizes per kind (images are downscaled in the browser first)
export const BRAND_KINDS: Record<Exclude<BrandKind, 'colors'>, { ar: string; types: Record<string, string>; max: number }> = {
  logo: { ar: 'الشعار', types: { ...IMG, 'image/svg+xml': 'svg' }, max: 2 * MB },
  font: { ar: 'خط', types: { 'font/woff2': 'woff2', 'font/woff': 'woff', 'font/ttf': 'ttf', 'font/otf': 'otf', 'application/font-woff2': 'woff2' }, max: 5 * MB },
  guide: { ar: 'دليل العلامة (PDF)', types: { 'application/pdf': 'pdf' }, max: 20 * MB },
  reference: { ar: 'صورة مرجعية', types: IMG, max: 5 * MB },
};
export const MAX_ACTIVE_REFS = 4;

export interface Asset {
  id: number; kind: BrandKind; title: string; r2_key: string | null; mime: string | null; size: number | null;
  value: string | null; description: string | null; active: boolean;
  created_by?: string | null; updated_by?: string | null; created_at?: string; updated_at?: string;
}

const UUID = /^[0-9a-f-]{36}$/i;
export function brandKey(company: string, ext: string, rnd: () => string = () => crypto.randomUUID().replace(/-/g, '')): string {
  if (!UUID.test(company)) throw new Error('bad company');
  return `brand/${company.toLowerCase()}/${rnd()}.${ext}`;
}

// What an upload may be: the kind, its type and size. Returns the file extension, or why not.
export function checkFile(kind: string, type: string, size: number): { ext?: string; error?: string } {
  const k = BRAND_KINDS[kind as keyof typeof BRAND_KINDS];
  if (!k) return { error: 'نوع غير معروف' };
  const ext = k.types[type.toLowerCase() as keyof typeof k.types];
  if (!ext) return { error: `${k.ar}: الصيغة ${type || 'غير معروفة'} مو مسموحة` };
  if (!size) return { error: 'الملف فاضي' };
  if (size > k.max) return { error: `${k.ar}: الحد ${k.max / MB} ميقا` };
  return { ext };
}

// Brand colours as typed: hex codes, one or more ("#1D1069، #7E57FD"). Main (dark) first, then accent.
export function cleanColors(input: unknown): string[] {
  const out = [...String(input || '').matchAll(/#?([0-9a-f]{6}|[0-9a-f]{3})\b/gi)].map(m => {
    const h = m[1]!.toLowerCase();
    return '#' + (h.length === 3 ? [...h].map(c => c + c).join('') : h);
  });
  return [...new Set(out)].slice(0, 8);
}

// The bytes of one file, for a page of this company only. Fonts and images inline; nothing in the file can run.
export async function serveFile(cfg: Cfg, co: string, id: number, files: R2Bucket | undefined, activeOnly: boolean): Promise<Response> {
  const r = await sb<Asset[]>(cfg, scoped(`/rest/v1/brand_assets?id=eq.${id}&select=id,kind,r2_key,mime,title,active${activeOnly ? '&active=is.true' : ''}`, co), { admin: true });
  const a = r.ok && Array.isArray(r.data) ? r.data[0] : undefined;
  if (!a?.r2_key || !files || !a.r2_key.startsWith(`brand/${co}/`)) return json(404, { error: 'الملف غير موجود' });
  const obj = await files.get(a.r2_key);
  if (!obj) return json(404, { error: 'الملف غير موجود' });
  return new Response(obj.body, { headers: {
    'content-type': a.mime || 'application/octet-stream', 'cache-control': 'private, max-age=3600',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox", 'x-content-type-options': 'nosniff',
    ...(a.kind === 'guide' ? { 'content-disposition': `inline; filename="brand-guide.pdf"` } : {}),
  } });
}

export interface Brand { colors: string[]; logo: number | null; fonts: { id: number; title: string }[]; refs: { id: number; description: string }[]; notes: string[] }

// The active brand of a company, for the design module. A failed read (e.g. migration 016 not applied) = no brand.
export async function brandFor(cfg: Cfg, co: string): Promise<Brand> {
  const b: Brand = { colors: [], logo: null, fonts: [], refs: [], notes: [] };
  try {
    const r = await sb<Asset[]>(cfg, scoped('/rest/v1/brand_assets?select=id,kind,title,value,description&active=is.true&order=updated_at.desc&limit=50', co), { admin: true });
    if (!r.ok || !Array.isArray(r.data)) return b;
    for (const a of r.data) {
      if (a.kind === 'colors' && !b.colors.length) b.colors = cleanColors(a.value);
      else if (a.kind === 'logo' && b.logo === null) b.logo = a.id;
      else if (a.kind === 'font' && b.fonts.length < 2) b.fonts.push({ id: a.id, title: a.title });
      else if (a.kind === 'reference' && b.refs.length < MAX_ACTIVE_REFS) b.refs.push({ id: a.id, description: a.description || '' });
    }
    b.notes = b.refs.map(x => x.description).filter(Boolean);
  } catch { /* no brand */ }
  return b;
}
