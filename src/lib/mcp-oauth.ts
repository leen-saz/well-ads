// Sign-in to TikTok's official hosted MCP server (TikTok for Business), the same server Grok used through MCP.
// Standard MCP authorization: dynamic client registration (no developer app), PKCE S256, `resource` indicator,
// public client (token_endpoint_auth_method "none"), refresh tokens. Endpoints read from the server's metadata
// on 2026-11-01: <resource>/oauth/.well-known/oauth-authorization-server.
export const TIKTOK_MCP = {
  resource: 'https://business-api.tiktok.com/open_mcp/tt-ads-mcp-flat',
  authorize: 'https://business-api.tiktok.com/portal/mcp-tt4b-authorize',
  token: 'https://business-api.tiktok.com/open_mcp/tt-ads-mcp-flat/oauth/token',
  register: 'https://business-api.tiktok.com/open_mcp/tt-ads-mcp-flat/oauth/register',
  scope: 'mcp:tt4b',
} as const;

// TikTok ends the authorization after 30 days; the connectors page shows the date and offers "Reconnect"
export const TIKTOK_MCP_DAYS = 30;

const b64u = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64u(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}

export async function registerClient(redirect: string, f: typeof fetch = fetch): Promise<string> {
  const r = await f(TIKTOK_MCP.register, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Well Ads', redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'], token_endpoint_auth_method: 'none', scope: TIKTOK_MCP.scope,
    }),
  });
  const d = (await r.json().catch(() => ({}))) as { client_id?: string };
  if (!r.ok || !d.client_id) throw new Error(`mcp register ${r.status}`);
  return d.client_id;
}

export function authorizeUrl({ clientId, redirect, state, challenge }: { clientId: string; redirect: string; state: string; challenge: string }): string {
  const q = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: redirect, state, scope: TIKTOK_MCP.scope,
    code_challenge: challenge, code_challenge_method: 'S256', resource: TIKTOK_MCP.resource,
  });
  return `${TIKTOK_MCP.authorize}?${q}`;
}

export async function exchangeCode({ clientId, code, verifier, redirect }: { clientId: string; code: string; verifier: string; redirect: string },
  f: typeof fetch = fetch): Promise<{ refresh: string }> {
  const r = await f(TIKTOK_MCP.token, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: clientId, code_verifier: verifier, resource: TIKTOK_MCP.resource,
    }),
  });
  const d = (await r.json().catch(() => ({}))) as { refresh_token?: string };
  if (!r.ok || !d.refresh_token) throw new Error(`mcp token ${r.status}`);
  return { refresh: d.refresh_token };
}
