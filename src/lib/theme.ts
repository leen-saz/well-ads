// The theme of every HTML page (docs/PRD.md §4.2-4.3). The browser keeps the choice in the «well-theme» cookie
// (light / dark / system, set from the account menu by public/assets/theme.js). Here, before the first paint:
//  - <html data-theme> is set from the cookie, so there is no flash of the wrong theme and no inline script (strict CSP);
//  - the one token source /assets/tokens.css is linked first in <head>, so app.css, ui.css and the pipeline pages all
//    read the same colours. No cookie = light, exactly as before.
export const THEME_COOKIE = 'well-theme';
export const THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEMES)[number];
export const TOKENS_HREF = '/assets/tokens.css';

/** The theme named by the request's cookie, or light. Anything else in the cookie is ignored. */
export function themeOf(cookie: string | null): Theme {
  const m = /(?:^|;\s*)well-theme=([a-z]+)/.exec(cookie ?? '');
  const v = m?.[1];
  return (THEMES as readonly string[]).includes(v ?? '') ? (v as Theme) : 'light';
}

export function withTheme(res: Response, cookie: string | null): Response {
  if (typeof HTMLRewriter === 'undefined' || !(res.headers.get('content-type') ?? '').startsWith('text/html')) return res;
  const theme = themeOf(cookie);
  return new HTMLRewriter()
    .on('html', { element(el) { el.setAttribute('data-theme', theme); } })
    .on('head', { element(el) { el.prepend(`<link rel="stylesheet" href="${TOKENS_HREF}">`, { html: true }); } })
    .transform(res);
}
