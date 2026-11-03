// Versioned copies of our scripts and styles (src/lib/asset-paths.mjs): which paths move, and how the references
// between modules are rewritten so a versioned module only loads versioned modules.
import { describe, expect, it } from 'vitest';
import { rewriteRefs, versioned } from '../../src/lib/asset-paths.mjs';
import { versionAssets } from '../../src/lib/assets';

describe('versioned', () => {
  it('moves /assets and /modules scripts and styles', () => {
    expect(versioned('/assets/router.js', 'abc')).toBe('/r/abc/assets/router.js');
    expect(versioned('/assets/app.css', 'abc')).toBe('/r/abc/assets/app.css');
    expect(versioned('/modules/overview/client.js', 'abc')).toBe('/r/abc/modules/overview/client.js');
  });
  it('leaves fonts, logos, other paths, and everything without a version', () => {
    expect(versioned('/assets/fonts/thmanyahsans-Regular.woff2', 'abc')).toBeNull();
    expect(versioned('/assets/logos/meta.svg', 'abc')).toBeNull();
    expect(versioned('/_astro/page.js', 'abc')).toBeNull();
    expect(versioned('https://x/assets/a.js', 'abc')).toBeNull();
    expect(versioned('/assets/router.js', '')).toBeNull();
  });
});

describe('rewriteRefs', () => {
  it('points quoted module paths at the versioned folder; relative imports, fonts and logos stay', () => {
    const src = [
      "import { $ } from '/assets/common.js';",
      'import { x } from "./sidebar.js";',
      "const m = await import(`/modules/${name}/client.js`);",
      "url(/assets/fonts/a.woff2) '/assets/logos/' + p",
      "fetch('/api/modules/list')",
    ].join('\n');
    expect(rewriteRefs(src, 'abc')).toBe([
      "import { $ } from '/r/abc/assets/common.js';",
      'import { x } from "./sidebar.js";',
      "const m = await import(`/r/abc/modules/${name}/client.js`);",
      "url(/assets/fonts/a.woff2) '/assets/logos/' + p",
      "fetch('/api/modules/list')",
    ].join('\n'));
  });
});

describe('versionAssets', () => {
  it('leaves responses alone without a version or when not HTML', () => {
    const html = new Response('<script src="/assets/router.js"></script>', { headers: { 'content-type': 'text/html' } });
    expect(versionAssets(html, '')).toBe(html);
    const json = new Response('{}', { headers: { 'content-type': 'application/json' } });
    expect(versionAssets(json, 'abc')).toBe(json);
  });
});
