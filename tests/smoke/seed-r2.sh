#!/bin/sh
# Synthetic pages in the local R2 bucket, where the pipeline's dashboards would be (src/lib/site.ts)
set -e
B=well-ads-files-local
O="--local --config dist/server/wrangler.smoke.json --persist-to .wrangler/smoke-state"
npx wrangler r2 object put $B/site/dash.json --file tests/smoke/fixtures/dash.json --content-type application/json $O
npx wrangler r2 object put $B/site/index.html --file tests/smoke/fixtures/index.html --content-type text/html $O
npx wrangler r2 object put $B/site/c/index.html --file tests/smoke/fixtures/index.html --content-type text/html $O
