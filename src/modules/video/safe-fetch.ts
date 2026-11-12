// Reads a public web page for the brief, safely. The address comes from a user, so it is checked before and after every redirect:
// https only, no sign-in in the address, port 443, no private or local address (literal IPs, "localhost", internal-looking names),
// a time limit, a size limit, text/html only. Cloudflare Workers cannot reach a private network anyway; this stops the attempt
// early and keeps the rule testable. Pure besides the injected fetch.
const MAX_BYTES = 1_500_000, TIMEOUT_MS = 8_000, MAX_REDIRECTS = 3;

function privateV4(h: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}
function privateV6(h: string): boolean {
  const x = h.replace(/^\[|\]$/g, '').toLowerCase();
  if (!x.includes(':')) return false;
  if (x === '::' || x === '::1') return true;
  const mapped = /^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/.exec(x);
  if (mapped) {
    if (mapped[1]) return privateV4(mapped[1]);
    const hi = parseInt(mapped[2]!, 16), lo = parseInt(mapped[3]!, 16);
    return privateV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return /^(fc|fd|fe[89ab])/.test(x) || x.startsWith('64:ff9b');
}

// Why an address is refused, or null when it may be read
export function refuse(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return 'الرابط غير صحيح'; }
  if (u.protocol !== 'https:') return 'الرابط لازم يبدأ بـ https';
  if (u.username || u.password) return 'الرابط ما يقبل اسم مستخدم';
  if (u.port && u.port !== '443') return 'الرابط غير مسموح';
  const h = u.hostname.toLowerCase();
  if (!h || h === 'localhost' || /\.(localhost|local|internal|lan|home|corp|intranet)$/.test(h) || (!h.includes('.') && !h.includes(':'))) return 'الرابط غير مسموح';
  if (privateV4(h) || privateV6(h)) return 'الرابط غير مسموح';
  return null;
}

export type Page = { ok: true; url: string; html: string } | { ok: false; error: string };

export async function readPage(raw: string, f: typeof fetch = fetch): Promise<Page> {
  let url = raw.trim();
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const why = refuse(url);
    if (why) return { ok: false, error: why };
    let r: Response;
    try {
      r = await f(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'Mozilla/5.0 (compatible; WellBriefBot/1.0)', 'accept-language': 'ar,en;q=0.8' } });
    } catch { return { ok: false, error: 'ما قدرت أفتح الصفحة، تأكد من الرابط وجرّب' }; }
    if (r.status >= 300 && r.status < 400) {
      const next = r.headers.get('location');
      if (!next) return { ok: false, error: 'ما قدرت أفتح الصفحة' };
      try { url = new URL(next, url).toString(); } catch { return { ok: false, error: 'الرابط غير صحيح' }; }
      continue;
    }
    if (!r.ok) return { ok: false, error: 'ما قدرت أفتح الصفحة، الموقع رفض الطلب' };
    const type = (r.headers.get('content-type') || '').split(';')[0]!.trim().toLowerCase();
    if (!/^(text\/html|application\/xhtml\+xml|text\/plain)$/.test(type)) return { ok: false, error: 'هذا الرابط مو صفحة نصية' };
    if (Number(r.headers.get('content-length') || 0) > MAX_BYTES) return { ok: false, error: 'الصفحة كبيرة زيادة' };
    if (!r.body) return { ok: false, error: 'الصفحة فاضية' };
    // Read up to the limit, then stop: a page without a length header cannot fill the Worker's memory
    const reader = r.body.getReader(), parts: Uint8Array[] = [];
    let n = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        n += value.byteLength;
        if (n > MAX_BYTES) { await reader.cancel().catch(() => {}); return { ok: false, error: 'الصفحة كبيرة زيادة' }; }
        parts.push(value);
      }
    } catch { return { ok: false, error: 'انقطعت قراءة الصفحة، جرّب مرة ثانية' }; }
    const all = new Uint8Array(n); let at = 0;
    for (const p of parts) { all.set(p, at); at += p.byteLength; }
    return { ok: true, url, html: new TextDecoder('utf-8', { fatal: false }).decode(all) };
  }
  return { ok: false, error: 'الصفحة تحوّل كثير، جرّب الرابط النهائي' };
}
