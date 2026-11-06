// Smoke suite: derives a local Worker config from the build output. The Workers AI binding is dropped
// because it always talks to the remote account, and CI has no Cloudflare login. Run after `npm run build`.
import { readFileSync, writeFileSync } from 'node:fs';
const src = new URL('../../dist/server/wrangler.json', import.meta.url);
const cfg = JSON.parse(readFileSync(src, 'utf8'));
delete cfg.ai;
writeFileSync(new URL('../../dist/server/wrangler.smoke.json', import.meta.url), JSON.stringify(cfg));
console.log('dist/server/wrangler.smoke.json written');
