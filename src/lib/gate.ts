// Port of well-ads-dashboard web/middleware.js: nothing opens without login, and each user sees
// only the dashboards Leen picked. Returns a Response (redirect / refusal) or a pass decision.
import { env, verify, readCookie, SESSION, can, home, html, json, type AuthEnv, type Cfg, type Need, locked, LOCKED, WELL_ONLY } from './auth';
import { WELL_COMPANY } from './tenant';
import { LIVE } from '../modules/registry';

export type Pass = { pass: true; rewrite?: string };
export type Decision = Pass | Response;

const PUBLIC = [/^\/login\/?$/, /^\/reset\/?$/, /^\/welcome\/?$/, /^\/api\/auth\//, /^\/api\/health\/?$/, /^\/api\/connectors\/callback\/?$/,
  // Listening sources check: open on staging only, the owner elsewhere (src/modules/listening/probe.ts)
  /^\/api\/listening\/probe\/?$/,
  /^\/assets\//, /^\/_astro\//, /^\/m\/[0-9a-f-]{36}\/[0-9a-f]{32}\.(jpg|png|webp|mp4|mov)$/i, /^\/robots\.txt$/, /^\/favicon/];

// The five sidebar destinations (public/assets/sidebar.js GROUPS). /today/ is the start page; the others open
// the first tool of the destination this user may open, in sidebar order, and /today/ when none.
export const HUBS: Record<string, [Need, string][]> = {
  performance: [['ceo', '/'], ['creative', '/?view=creative'], ['listening', '/listening/']],
  create: [['design', '/design/'], ['copy', '/copy/'], ['voice', '/voice/'], ['social', '/social/'], ['content', '/content/'], ['journeys', '/journeys/']],
  review: [['control', '/control/'], ['compliance', '/compliance/'], ['maestro', '/maestro/']],
  system: [['connectors', '/connectors/'], ['knowledge', '/knowledge/'], ['debugger', '/debugger/']],
};
// What the pipeline builds and the control board and connectors keep is Well's alone (R2 pages and data, decisions, keys):
// another company's users never reach it, whatever dashboards they hold.
const WELL_NEEDS: Need[] = ['ceo', 'creative', 'control', 'connectors', 'media'];
const HUB = /^\/(performance|create|review|system)\/?$/;
// Short and earlier links of the same places
const ALIAS: Record<string, string> = { '/analytics': '/', '/home': '/today/', '/start': '/today/', '/history': '/control/?tab=log', '/review/history': '/control/?tab=log', '/permissions': '/admin/',
  // Motion graphics moved from Maestro into Design, then from /design/video/ into Design's type switch; ?id= rides along
  '/maestro/video': '/design/?type=motion', '/design/video': '/design/?type=motion' };

export function need(pathname: string, search: string): Need | null {
  if (PUBLIC.some(r => r.test(pathname))) return null;
  if (HUB.test(pathname) || ALIAS[pathname.replace(/\/$/, '')] || /^\/(api\/)?today(\/|$)/.test(pathname)) return 'any';
  if (/^\/(api\/)?admin(\/|$)/.test(pathname)) return 'owner';
  // Data health (a sub-page of the Manager): the owner only
  if (/^\/(api\/)?maestro\/(health|crm|vitals)(\/|$)/.test(pathname)) return 'owner';
  if (/^\/(api\/)?control(\/|$)/.test(pathname)) return 'control';
  if (/^\/(api\/)?connectors(\/|$)/.test(pathname)) return 'connectors';
  // Dashboard data: the route picks the user's copy (analytics, creative or their department)
  if (/^\/api\/dash\//.test(pathname)) return 'any';
  // Lessons of any tab: the route checks that tab's own level
  if (/^\/api\/lessons\//.test(pathname)) return 'any';
  // The shared library: the routes check each item's own tab
  if (/^\/(api\/)?library(\/|$)/.test(pathname)) return 'any';
  // Live modules: /<key>/ and /api/<key>/* need the module's own dashboard
  const mod = pathname.match(/^\/(?:api\/)?([a-z]+)(?:\/|$)/)?.[1];
  if (mod && LIVE.includes(mod)) return mod;
  if (/^\/(api\/)?account(\/|$)/.test(pathname)) return 'any';
  // Web Vitals reports: every signed-in user sends them, not only those with analytics
  if (/^\/api\/vitals\//.test(pathname)) return 'any';
  if (/^\/settings\/?$/.test(pathname)) return 'any';
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
  const alias = ALIAS[url.pathname.replace(/\/$/, '')];
  if (alias) {
    const to = new URL(alias, url.origin);
    url.searchParams.forEach((v, k) => { if (!to.searchParams.has(k)) to.searchParams.set(k, v); });
    return redirect(to.toString());
  }
  const hub = url.pathname.match(HUB)?.[1];
  if (hub) return redirect(new URL(HUBS[hub]!.find(([k]) => can(s, k, cfg) && (s.co === WELL_COMPANY || !WELL_NEEDS.includes(k)))?.[1] ?? '/today/', url.origin).toString());
  if (s.co !== WELL_COMPANY && WELL_NEEDS.includes(want)) return api ? json(403, { error: WELL_ONLY }) : html(403, WELL_ONLY);
  // Images: any user with at least one dashboard
  if (want === 'media') return (s.dash || []).length || s.role === 'owner' ? { pass: true } : html(403, 'ما عندك صلاحية');
  if (locked(s, want)) return api ? json(403, { error: LOCKED }) : html(403, LOCKED);
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
  const to = home();
  if (to === back) return html(403, 'ما عندك صلاحية على هذي اللوحة.');
  return redirect(new URL(to, url.origin).toString());
}
