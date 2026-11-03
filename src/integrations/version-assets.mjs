// Build step for src/lib/asset-paths.mjs: hashes public/assets and public/modules scripts and styles, tells the server
// bundle the version (__ASSET_V__), and after the build copies them to dist/client/r/<version>/ with their references
// rewritten, sent immutable. Only on `astro build`: in `astro dev` pages keep the plain paths.
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, appendFileSync, writeFileSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rewriteRefs } from '../lib/asset-paths.mjs';

const OWN = /\.(?:js|css)$/;
const files = dir => readdirSync(dir).flatMap(f => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? (/^(fonts|logos)$/.test(f) ? [] : files(p)) : OWN.test(f) ? [p] : [];
});

export default function versionAssets() {
  let v = '';
  return {
    name: 'version-assets',
    hooks: {
      'astro:config:setup'({ command, config, updateConfig }) {
        if (command !== 'build') return;
        const pub = fileURLToPath(config.publicDir);
        const h = createHash('sha256');
        for (const p of ['assets', 'modules'].flatMap(d => files(join(pub, d))).sort()) h.update(relative(pub, p)).update('\0').update(readFileSync(p));
        v = h.digest('hex').slice(0, 12);
        updateConfig({ vite: { define: { __ASSET_V__: JSON.stringify(v) } } });
      },
      'astro:build:done'({ dir, logger }) {
        if (!v) return;
        const client = fileURLToPath(dir);
        const out = join(client, 'r', v);
        let n = 0;
        for (const p of ['assets', 'modules'].flatMap(d => files(join(client, d)))) {
          const to = join(out, relative(client, p));
          mkdirSync(dirname(to), { recursive: true });
          writeFileSync(to, rewriteRefs(readFileSync(p, 'utf8'), v));
          n++;
        }
        appendFileSync(join(client, '_headers'), '\n# Versioned copies of /assets and /modules (src/integrations/version-assets.mjs)\n/r/*\n  Cache-Control: public, max-age=31536000, immutable\n');
        logger.info(`${n} scripts and styles copied to /r/${v}/`);
      },
    },
  };
}
