// Our own scripts and styles (public/assets, public/modules) have fixed names, so browsers revalidated every one on
// each full page load, one import level after another. The build copies them to /r/<version>/… (version = a hash of
// their contents, src/integrations/version-assets.mjs) with the references between them rewritten, and that folder is
// sent immutable. Pages point at the copy (src/lib/assets.ts); the originals stay where they are for anything else.
// Fonts and logos keep their own paths (cached on their own).

// A /assets or /modules script or style, as written in a page or between modules
const OWN = /^\/(assets|modules)\/(?!fonts\/|logos\/)[^?#]*\.(?:js|css)$/;

/** The versioned path of one of our scripts or styles, or null for anything else. */
export function versioned(path, v) {
  return v && OWN.test(path) ? `/r/${v}${path}` : null;
}

/** A script or style with its quoted /assets/… and /modules/… references pointed at the versioned folder. */
export function rewriteRefs(text, v) {
  return text.replace(/(["'`(])\/(assets|modules)\/(?!fonts\/|logos\/)/g, `$1/r/${v}/$2/`);
}
