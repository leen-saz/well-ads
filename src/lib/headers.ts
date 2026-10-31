// Security headers added to every response. CSP itself comes from Astro (security.csp) for pages.
export const SECURITY_HEADERS: Record<string, string> = {
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
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
