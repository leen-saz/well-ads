// The one token source in every HTML page (docs/PRD.md §4.2): /assets/tokens.css is linked first in <head>, so
// app.css, ui.css and the pipeline pages' sidebar (nav.js) all read the same colours. No theme switch: content is
// light and the menus are always dark (Leen, 2026-11-19), both decided in tokens.css.
export const TOKENS_HREF = '/assets/tokens.css';

export function withTokens(res: Response): Response {
  if (typeof HTMLRewriter === 'undefined' || !(res.headers.get('content-type') ?? '').startsWith('text/html')) return res;
  return new HTMLRewriter()
    .on('head', { element(el) { el.prepend(`<link rel="stylesheet" href="${TOKENS_HREF}">`, { html: true }); } })
    .transform(res);
}
