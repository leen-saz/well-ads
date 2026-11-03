// Pages point at the versioned copies of our scripts and styles (src/lib/asset-paths.mjs). The version is set by the
// build (src/integrations/version-assets.mjs); without it (astro dev, tests) pages keep the plain paths.
import { versioned } from './asset-paths.mjs';

declare const __ASSET_V__: string | undefined;
export const ASSET_V: string = typeof __ASSET_V__ === 'string' ? __ASSET_V__ : '';

const point = (attr: string, v: string) => ({
  element(el: Element) {
    const to = versioned(el.getAttribute(attr) ?? '', v);
    if (to) el.setAttribute(attr, to);
  },
});

// Every HTML page this Worker sends: Astro pages and the dashboards from R2 (nav.js)
export function versionAssets(res: Response, v = ASSET_V): Response {
  if (!v || typeof HTMLRewriter === 'undefined' || !(res.headers.get('content-type') ?? '').startsWith('text/html')) return res;
  return new HTMLRewriter().on('script[src]', point('src', v)).on('link[href]', point('href', v)).transform(res);
}
