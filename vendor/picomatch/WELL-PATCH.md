# Well patch: picomatch (GHSA-fc5q-39xc-vjpf / CVE-2026-112366)

This directory is picomatch **4.0.7** (MIT, original `LICENSE` kept) with one upstream fix applied, published here as
version `4.0.8-well.1`. `package.json` points npm at it with `overrides` entry `"picomatch": "$picomatch"` and a
`devDependencies` entry `"picomatch": "file:vendor/picomatch"`.

## Why

`picomatch <= 4.0.7` has a ReDoS: single-branch repeated extglobs such as `+(*)` or `+(*a)` compile to a regex with
nested quantifiers and backtrack exponentially. The advisory lists no patched release, so `npm audit --audit-level=high`
failed on every PR (24 high findings, all through picomatch: astro, vite, vitest, tinyglobby, fdir, anymatch, ...).
It is build/test-time only (not reachable from the live site), but we close it instead of waiving it.

The nested `anymatch@3.1.3 -> picomatch 2.3.2` copy was flagged too (advisory range `<= 4.0.7`). anymatch only calls
`picomatch(glob, options)`, which is identical in 4.x, so everything is deduped onto this one 4.x copy (the 2.x copy is
gone from the lockfile).

## Upstream change

Upstream PR: https://github.com/micromatch/picomatch/pull/237 (related: #238, #194), still open when vendored.
Only `lib/parse.js` is changed; the PR's test is reproduced in `tests/unit/picomatch-vendor.test.ts`.
What it does: when a `+()`/`*()` extglob has a single branch that is a self-repeating star (`*`, `*a`, `a*b`), the
group is collapsed to `(?:...)` / `(?:...)?` instead of `(?:...)+`, so quantifiers never nest. Matching results are unchanged.

Applied diff (applies cleanly to 4.0.7, no hand edits):

```diff
diff --git a/lib/parse.js b/lib/parse.js
index 0bb4116..04a3425 100644
--- a/lib/parse.js
+++ b/lib/parse.js
@@ -270,6 +270,49 @@ const getStarExtglobSequenceChars = pattern => {
   return chars;
 };
 
+const isSelfRepeatingStarBranch = branch => {
+  let escaped = false;
+  let bracket = false;
+  let star = false;
+
+  for (let i = 0; i < branch.length; i++) {
+    const ch = branch[i];
+
+    if (escaped === true) {
+      escaped = false;
+      continue;
+    }
+
+    if (ch === '\\') {
+      escaped = true;
+      continue;
+    }
+
+    if (bracket === true) {
+      if (ch === ']') bracket = false;
+      continue;
+    }
+
+    if (ch === '[') {
+      bracket = true;
+      continue;
+    }
+
+    if (/[/(){}|!+@]/.test(ch)) {
+      return false;
+    }
+
+    if (ch === '*') {
+      if (branch[i + 1] === '*') {
+        return false;
+      }
+      star = true;
+    }
+  }
+
+  return star && !escaped && !bracket;
+};
+
 const repeatedExtglobRecursion = pattern => {
   let depth = 0;
   let value = pattern.trim();
@@ -343,6 +386,10 @@ const analyzeRepeatedExtglob = (body, options) => {
       : { risky: true };
   }
 
+  if (branches.length === 1 && isSelfRepeatingStarBranch(branches[0])) {
+    return { risky: false, collapse: true };
+  }
+
   return { risky: false };
 };
 
@@ -565,6 +612,10 @@ const parse = (input, options) => {
       return;
     }
 
+    if (analysis.collapse === true && (token.type === 'plus' || token.type === 'star')) {
+      token.close = token.type === 'plus' ? ')' : ')?';
+    }
+
     let output = token.close + (opts.capture ? ')' : '');
     let rest;
 
```

## Removal rule

Delete this directory, the `overrides.picomatch` entry, the `devDependencies.picomatch` entry, the `vendor/` ignores in
`eslint.config.js` and `tsconfig.json`, and `tests/unit/picomatch-vendor.test.ts`, then run `npm install`, as soon as
picomatch **>= 4.0.8 containing this fix** is published (check `npm view picomatch version` and the PR). Then confirm
`npm audit --audit-level=high` still passes. `tests/unit/repo-hygiene.test.ts` fails if this file or the override is removed
by accident; when removing on purpose, delete that assertion too.
