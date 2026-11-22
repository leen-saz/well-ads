/* eslint-disable @typescript-eslint/no-explicit-any -- recorded request bodies are read loosely in assertions */
// Token Vault per company (M11, 042_vault_company.sql): Well keeps its names; any other company reads and writes its own only.
// @ts-expect-error node:fs exists under vitest (the Worker types do not include node)
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokensOf, putToken, dropTokens } from '../../src/mcp/vault';
import { WELL_COMPANY } from '../../src/lib/tenant';

const cfg = { url: 'https://sb.example', anon: 'anon', service: 'service' } as never;
const OTHER = '11111111-2222-4333-8444-555555555555';
type Call = { path: string; body: any };
function world(answer: (path: string) => Response) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (u: string, init: RequestInit = {}) => {
    const path = String(u).replace('https://sb.example', '');
    calls.push({ path, body: init.body ? JSON.parse(String(init.body)) : null });
    return answer(path);
  }));
  return calls;
}
const ok = (v: unknown) => new Response(JSON.stringify(v), { status: 200 });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('tokensOf', () => {
  it('Well reads its existing names (connector_env, no arguments)', async () => {
    const calls = world(() => ok([{ name: 'META_ACCESS_TOKEN', value: 'w' }]));
    expect(await tokensOf(cfg, WELL_COMPANY)).toEqual({ META_ACCESS_TOKEN: 'w' });
    expect(calls).toEqual([{ path: '/rest/v1/rpc/connector_env', body: {} }]);
  });
  it('another company reads its own (connector_env_co with its id), and gets {} before 042 or on a failure', async () => {
    let calls = world(() => ok([{ name: 'META_ACCESS_TOKEN', value: 'o' }]));
    expect(await tokensOf(cfg, OTHER)).toEqual({ META_ACCESS_TOKEN: 'o' });
    expect(calls).toEqual([{ path: '/rest/v1/rpc/connector_env_co', body: { p_company: OTHER } }]);
    calls = world(() => new Response(JSON.stringify({ code: 'PGRST202', message: 'Could not find the function' }), { status: 404 }));
    expect(await tokensOf(cfg, OTHER)).toEqual({});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    world(() => new Response('{}', { status: 500 }));
    expect(await tokensOf(cfg, OTHER)).toEqual({});
  });
  it('a company id that is not a uuid is refused before any call', async () => {
    const calls = world(() => ok([]));
    await expect(tokensOf(cfg, "x' or 1=1")).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});

describe('putToken / dropTokens', () => {
  it('Well writes connector_put; another company writes connector_put_co with its id', async () => {
    const calls = world(() => ok(null));
    await putToken(cfg, WELL_COMPANY, 'META_ACCESS_TOKEN', 'v1');
    await putToken(cfg, OTHER, 'META_ACCESS_TOKEN', 'v2');
    expect(calls).toEqual([
      { path: '/rest/v1/rpc/connector_put', body: { p_name: 'META_ACCESS_TOKEN', p_value: 'v1' } },
      { path: '/rest/v1/rpc/connector_put_co', body: { p_company: OTHER, p_name: 'META_ACCESS_TOKEN', p_value: 'v2' } },
    ]);
  });
  it('a bad name, an empty value or a failed write throws; drop skips bad names', async () => {
    let calls = world(() => ok(null));
    await expect(putToken(cfg, OTHER, 'lower', 'v')).rejects.toThrow();
    await expect(putToken(cfg, OTHER, 'GOOD_NAME', '')).rejects.toThrow();
    await dropTokens(cfg, OTHER, ['bad name']);
    expect(calls).toEqual([]);
    await dropTokens(cfg, OTHER, ['A_B', 'nope']);
    expect(calls).toEqual([{ path: '/rest/v1/rpc/connector_drop_co', body: { p_company: OTHER, p_names: ['A_B'] } }]);
    calls = world(() => new Response('{}', { status: 500 }));
    await expect(putToken(cfg, WELL_COMPANY, 'GOOD_NAME', 'v')).rejects.toThrow('vault write failed');
    expect(calls).toHaveLength(1);
  });
});

describe('042_vault_company.sql', () => {
  const sql = readFileSync('supabase/migrations/042_vault_company.sql', 'utf8');
  it('Well’s reader stops seeing other companies’ names; every function is for the service role only', () => {
    expect(sql).toMatch(/connector_env\(\)[\s\S]*s\.name !~ '\^conn:\[0-9a-f\]\{8\}-/);
    for (const f of ['connector_env()', 'connector_put_co(uuid, text, text)', 'connector_drop_co(uuid, text[])', 'connector_env_co(uuid)']) {
      expect(sql).toContain(`revoke all on function public.${f} from public, anon, authenticated;`);
      expect(sql).toContain(`grant execute on function public.${f} to service_role;`);
    }
    expect(sql).toContain("security definer set search_path = ''");
  });
});
