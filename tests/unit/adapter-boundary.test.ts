// M10 (docs/PRD.md §3.0): the platform APIs are reached from src/mcp/adapters only. Any other source file that names a platform API
// host fails here, except the few listed below, each with the milestone that moves it. The list can only shrink: an entry whose file
// no longer names a host fails too, so it is removed when the move happens.
// @ts-expect-error node:fs exists under vitest (the Worker types do not include node)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const HOSTS = /graph\.facebook\.com|adsapi\.snapchat\.com|accounts\.snapchat\.com\/login\/oauth2\/access_token|business-api\.tiktok\.com|open\.tiktokapis\.com|googleads\.googleapis\.com|api\.linkedin\.com|api\.x\.com/;
const LATER: Record<string, string> = {
  'src/lib/connectors.ts': 'connecting an account (OAuth exchange, page list, the connect check): moves with the Token Vault and refresher, M11',
  'src/lib/mcp-oauth.ts': 'the OAuth client for TikTok’s own MCP server: becomes the TikTok adapter, M14',
  'src/modules/journeys/journeys.ts': 'WhatsApp sends: not connected (Leen’s rule); moves with the inbox, M15',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = `${dir}/${n}`;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(n) && !/\.test\.|\.spec\.|-mock\./.test(n)) out.push(p);
  }
  return out;
}
const files = walk('src');

describe('platform calls live in src/mcp/adapters', () => {
  it('no source file outside the adapters names a platform API host', () => {
    const bad = files.filter(f => !f.startsWith('src/mcp/adapters/') && !(f in LATER) && HOSTS.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
  it('every file still waiting to move still needs its entry', () => {
    for (const f of Object.keys(LATER)) expect(HOSTS.test(readFileSync(f, 'utf8')), f).toBe(true);
  });
  it('the adapters exist: Meta ads, Snapchat ads, Meta Graph publishing, Postiz', () => {
    for (const f of ['ads', 'meta-ads', 'snap-ads', 'meta-graph', 'postiz']) expect(files).toContain(`src/mcp/adapters/${f}.ts`);
  });
});

describe('platform secrets go through the Token Vault', () => {
  it('only src/mcp/vault.ts calls the vault functions (connector_env, connector_put, connector_drop and their per-company forms)', () => {
    const bad = files.filter(f => f !== 'src/mcp/vault.ts' && /rpc\/connector_(env|put|drop)/.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
});
