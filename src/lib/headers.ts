// Security headers added to every response. CSP itself comes from Astro (security.csp) for pages.
export const SECURITY_HEADERS: Record<string, string> = {
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
  // Same-origin frames only: the sidebar keeps opened tabs alive in frames (public/assets/keep.js)
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  // No cross-origin window may keep a reference to our pages (no popups are opened by the app).
  'Cross-Origin-Opener-Policy': 'same-origin',
  // Browser features the app never uses stay off, so an injected script cannot switch them on (none is used in src or public/assets).
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), hid=(), midi=(), display-capture=(), accelerometer=(), gyroscope=(), magnetometer=()',
};

export function withSecurityHeaders(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  if (!out.headers.has('Content-Security-Policy')) {
    // API and asset responses: nothing may run or be framed.
    out.headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  }
  return out;
}
