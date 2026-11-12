// Port of well-ads-dashboard web/middleware.js: nothing opens without login, and each user sees
// only the dashboards Leen picked. Returns a Response (redirect / refusal) or a pass decision.
import { env, verify, renew, clearCookie, readCookie, SESSION, can, home, html, json, type AuthEnv, type Cfg, type Need, locked, LOCKED, WELL_ONLY } from './auth';
import { WELL_COMPANY } from './tenant';
import { LIVE, MODULES } from '../modules/registry';

export type Pass = { pass: true; rewrite?: string; cookie?: string };
export type Decision = Pass | Response;

const PUBLIC = [/^\/login\/?$/, /^\/reset\/?$/, /^\/welcome\/?$/, /^\/api\/auth\//, /^\/api\/health\/?$/, /^\/api\/connectors\/callback\/?$/,
  // Listening sources check: open on staging only, the owner elsewhere (src/modules/listening/probe.ts)
  /^\/api\/listening\/probe\/?$/,
  /^\/assets\//, /^\/_astro\//, /^\/m\/[0-9a-f-]{36}\/[0-9a-f]{32}\.(jpg|png|webp|mp4|mov)$/i, /^\/robots\.txt$/, /^\/favicon/];

// The five sidebar destinations (public/assets/sidebar.js GROUPS). /today/ is the start page; the others open
// the first tool of the destination this user may open, in sidebar order, and /today/ when none.
export const HUBS: Record<string, [Need, string][]> = {
  performance: [['ceo', '/'], ['creative', '/?view=creative'], ['listening', '/listening/']],
  create: [['design', '/design/'], ['voice', '/voice/'], ['voiceover', '/voice/?tab=voiceover'], ['social', '/social/'], ['content', '/content/'], ['copy', '/content/?tab=copy'], ['journeys', '/journeys/']],
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

// Tabs shown as a section of another tab: /voiceover/ is /voice/?tab=voiceover, /copy/ is /content/?tab=copy (same access as before)
const intoOf = (key: string): string | undefined => MODULES.find(m => m.key === key)?.into;

export function need(pathname: string, search: string): Need | null {
  if (PUBLIC.some(r => r.test(pathname))) return null;
  if (HUB.test(pathname) || ALIAS[pathname.replace(/\/$/, '')] || /^\/(api\/)?today(\/|$)/.test(pathname)) return 'any';
  if (/^\/(api\/)?admin(\/|$)/.test(pathname)) return 'owner';
  // Data health (a sub-page of the Manager): the owner only
  if (/^\/(api\/)?maestro\/(health|crm|vitals|audit|critique)(\/|$)/.test(pathname)) return 'owner';
  if (/^\/(api\/)?control(\/|$)/.test(pathname)) return 'control';
  // The Media buyer is a tab of the decisions board («توصيات القواعد»): its API asks for the same dashboard
  if (/^\/api\/buyer(\/|$)/.test(pathname)) return 'control';
  if (/^\/(api\/)?connectors(\/|$)/.test(pathname)) return 'connectors';
  // Dashboard data: the route picks the user's copy (analytics, creative or their department)
  if (/^\/api\/dash\//.test(pathname)) return 'any';
  // Campaign plans of the home assistant: any signed-in user writes wishes; the routes check who sees and who approves
  if (/^\/api\/campaigns\//.test(pathname)) return 'any';
  // Lessons of any tab: the route checks that tab's own level
  if (/^\/api\/lessons\//.test(pathname)) return 'any';
  // The shared library: the routes check each item's own tab
  if (/^\/(api\/)?library(\/|$)/.test(pathname)) return 'any';
  // Live modules: /<key>/ and /api/<key>/* need the module's own dashboard
  const mod = pathname.match(/^\/(?:api\/)?([a-z]+)(?:\/|$)/)?.[1];
  if (mod && LIVE.includes(mod)) {
    // The section picked with ?tab= is the child module's: its own access and lock
    const tab = !pathname.startsWith('/api/') ? new URLSearchParams(search).get('tab') : null;
    return tab && intoOf(tab) === mod ? tab : mod;
  }
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

// A section that is off for this company (or a user without access): a page in Well's own shell that says so and offers a way back,
// never a bare white page with a «sign in» link that looks like the session dropped
const closed = (origin: string, want: string, why: 'locked' | 'company' | 'noaccess') => new Response(null, { status: 302, headers: { location: new URL(`/soon/?t=${encodeURIComponent(want)}&why=${why}`, origin).toString(), 'cache-control': 'no-store' } });
// Pages get that screen; data files (.json, images) keep a plain 403
const denied = (url: URL, want: string, why: 'locked' | 'company' | 'noaccess', msg: string) => /\.[a-z0-9]+$/i.test(url.pathname) ? html(403, msg) : closed(url.origin, want, why);
const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to, 'cache-control': 'no-store' } });

// A page opened after the 10-minute recheck renews the session right here (one profile read) and sets the new cookie
// on its own answer. It used to redirect to /api/auth/refresh and back: two more round trips for the browser.
export async function gate(request: Request, e: AuthEnv): Promise<Decision> {
  const renewed: { cookie?: string } = {};
  const d = await decide(request, e, renewed);
  if (!renewed.cookie) return d;
  if (d instanceof Response) { const h = new Headers(d.headers); h.append('set-cookie', renewed.cookie); return new Response(d.body, { status: d.status, statusText: d.statusText, headers: h }); }
  return { ...d, cookie: renewed.cookie };
}

async function decide(request: Request, e: AuthEnv, renewed: { cookie?: string }): Promise<Decision> {
  const url = new URL(request.url);
  // The standalone Media buyer page is gone: its place is a tab of the decisions board
  if (/^\/buyer\/?$/.test(url.pathname)) return new Response(null, { status: 301, headers: { location: '/control/?tab=buyer', 'cache-control': 'public, max-age=3600' } });
  const want = need(url.pathname, url.search);
  if (!want) return { pass: true };
  const api = url.pathname.startsWith('/api/');
  let cfg: Cfg;
  try { cfg = env(e); } catch {
    return api ? json(503, { error: 'الإعداد غير مكتمل' }) : html(503, 'الإعداد غير مكتمل. تواصل مع مسؤولة اللوحة.');
  }
  let s = await verify(readCookie(request, SESSION), cfg.secret);
  const back = url.pathname + url.search;
  if (!s) {
    if (api) return json(401, { error: 'سجّل الدخول' });
    const login = new URL('/login/', url.origin);
    login.searchParams.set('next', back);
    return redirect(login.toString());
  }
  // The API re-reads permissions from the DB itself. Pages re-check every 10 minutes.
  if (s.stale && !api) {
    let r: Awaited<ReturnType<typeof renew>> | null = null;
    try { r = await renew(cfg, s); } catch { /* Supabase unreachable: take the old way, which answers with its own error */ }
    if (!r) return redirect(new URL('/api/auth/refresh?next=' + encodeURIComponent(back), url.origin).toString());
    if (r.kind === 'login') return new Response(null, { status: 302, headers: { location: new URL('/login/', url.origin).toString(), 'set-cookie': clearCookie(), 'cache-control': 'no-store' } });
    if (r.kind === 'expired') return html(401, 'انتهت الجلسة.');
    // Supabase hiccup (5xx / 429): keep the session as it is, the next page tries again, nobody is logged out
    if (r.kind === 'ok') { s = r.session; renewed.cookie = r.cookie; }
  }
  const alias = ALIAS[url.pathname.replace(/\/$/, '')];
  if (alias) {
    const to = new URL(alias, url.origin);
    url.searchParams.forEach((v, k) => { if (!to.searchParams.has(k)) to.searchParams.set(k, v); });
    return redirect(to.toString());
  }
  const hub = url.pathname.match(HUB)?.[1];
  if (hub) return redirect(new URL(HUBS[hub]!.find(([k]) => can(s, k, cfg) && (s.co === WELL_COMPANY || !WELL_NEEDS.includes(k)))?.[1] ?? '/today/', url.origin).toString());
  if (s.co !== WELL_COMPANY && WELL_NEEDS.includes(want)) return api ? json(403, { error: WELL_ONLY }) : denied(url, want, 'company', WELL_ONLY);
  // Images: any user with at least one dashboard
  if (want === 'media') return (s.dash || []).length || s.role === 'owner' ? { pass: true } : html(403, 'ما عندك صلاحية');
  if (locked(s, want)) return api ? json(403, { error: LOCKED }) : denied(url, want, 'locked', LOCKED);
  if (can(s, want, cfg)) {
    // The old address of a section: its place inside the tab it moved into
    const host = !api ? intoOf(want) : undefined;
    if (host && url.pathname.replace(/\/$/, '') === '/' + want) return redirect(new URL(`/${host}/?tab=${want}`, url.origin).toString());
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
  if (to === back) return denied(url, want, 'noaccess', 'ما عندك صلاحية على هذي اللوحة.');
  return redirect(new URL(to, url.origin).toString());
}
