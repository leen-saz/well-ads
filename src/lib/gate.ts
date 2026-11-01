// Port of well-ads-dashboard web/middleware.js: nothing opens without login, and each user sees
// only the dashboards Leen picked. Returns a Response (redirect / refusal) or a pass decision.
import { env, verify, readCookie, SESSION, can, home, html, json, type AuthEnv, type Cfg, type Need } from './auth';

export type Pass = { pass: true; rewrite?: string };
export type Decision = Pass | Response;

const PUBLIC = [/^\/login\/?$/, /^\/reset\/?$/, /^\/api\/auth\//, /^\/api\/health\/?$/, /^\/api\/connectors\/callback\/?$/,
  /^\/assets\//, /^\/_astro\//, /^\/robots\.txt$/, /^\/favicon/];

export function need(pathname: string, search: string): Need | null {
  if (PUBLIC.some(r => r.test(pathname))) return null;
  if (/^\/(api\/)?admin(\/|$)/.test(pathname)) return 'owner';
  if (/^\/(api\/)?control(\/|$)/.test(pathname)) return 'control';
  if (/^\/(api\/)?connectors(\/|$)/.test(pathname)) return 'connectors';
  if (/^\/(api\/)?social(\/|$)/.test(pathname)) return 'social';
  if (/^\/(api\/)?account(\/|$)/.test(pathname)) return 'any';
  if (/^\/soon\/?$/.test(pathname)) return 'any';
  if (/^\/creative\/?$/.test(pathname)) return 'creative';
  if (/^\/dept\//.test(pathname)) return new URLSearchParams(search).get('view') === 'creative' ? 'creative' : 'ceo';
  if (/^\/c\//.test(pathname)) return 'creative';
  if (/^\/thumbs\//.test(pathname)) return 'media';
  if (pathname === '/' && new URLSearchParams(search).get('view') === 'creative') return 'creative';
  return 'ceo';
}

const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to, 'cache-control': 'no-store' } });

export async function gate(request: Request, e: AuthEnv): Promise<Decision> {
  const url = new URL(request.url);
  const want = need(url.pathname, url.search);
  if (!want) return { pass: true };
  const api = url.pathname.startsWith('/api/');
  let cfg: Cfg;
  try { cfg = env(e); } catch {
    return api ? json(503, { error: 'الإعداد غير مكتمل' }) : html(503, 'الإعداد غير مكتمل. تواصل مع مسؤولة اللوحة.');
  }
  const s = await verify(readCookie(request, SESSION), cfg.secret);
  const back = url.pathname + url.search;
  if (!s) {
    if (api) return json(401, { error: 'سجّل الدخول' });
    const login = new URL('/login/', url.origin);
    login.searchParams.set('next', back);
    return redirect(login.toString());
  }
  // The API re-reads permissions from the DB itself. Pages re-check every 10 minutes.
  if (s.stale && !api) {
    const r = new URL('/api/auth/refresh', url.origin);
    r.searchParams.set('next', back);
    return redirect(r.toString());
  }
  // Images: any user with at least one dashboard
  if (want === 'media') return (s.dash || []).length || s.role === 'owner' ? { pass: true } : html(403, 'ما عندك صلاحية');
  if (can(s, want, cfg)) {
    // Department manager: analytics and creative open from their department copy only
    const scope: string[] = Array.isArray(s.depts) ? s.depts : [];
    const m = url.pathname.match(/^\/dept\/([a-z]+)\/?/);
    if (m) return !scope.length || scope.includes(m[1] as string) ? { pass: true } : html(403, 'ما عندك صلاحية على هذا القسم.');
    if (scope.length && (want === 'ceo' || want === 'creative')) {
      const pick = url.searchParams.get('d');
      const d = pick && scope.includes(pick) ? pick : scope[0];
      return { pass: true, rewrite: new URL(`/dept/${d}/${url.search}`, url.origin).toString() };
    }
    // Creative without analytics: the copy with ad numbers only, no organic and no Google
    if (want === 'creative' && !can(s, 'ceo', cfg) && !url.pathname.startsWith('/c/')) {
      return { pass: true, rewrite: new URL(`/c/${url.search}`, url.origin).toString() };
    }
    return { pass: true };
  }
  if (api) return json(403, { error: 'ما عندك صلاحية' });
  const to = home(s, cfg);
  if (to === back) return html(403, 'ما عندك صلاحية على هذي اللوحة.');
  return redirect(new URL(to, url.origin).toString());
}
