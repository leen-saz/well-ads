// Token Vault (docs/PRD.md §3.0, M11): the one place that reads or writes platform secrets. Well keeps its existing names ('conn:NAME',
// read by the hourly pull too); every other company has its own names ('conn:<company>:NAME', 042_vault_company.sql) and can only
// ever get its own. Values never leave the server: callers pass them to an adapter, never to a page, a log or an answer.
import { sb, missingSchema, type Cfg } from '../lib/auth';
import { WELL_COMPANY } from '../lib/tenant';

export type Tokens = Record<string, string>;
const NAME = /^[A-Z][A-Z0-9_]{1,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const toMap = (d: unknown): Tokens => Object.fromEntries((Array.isArray(d) ? d as { name: string; value: string }[] : []).map(x => [x.name, x.value]));
function company(co: string): string {
  if (!UUID.test(co)) throw new Error('vault: bad company');
  return co;
}

/** The company's secrets by name. A company without any (or before 042 is applied) gets {}; a failed read too, logged without values. */
export async function tokensOf(cfg: Cfg, co: string): Promise<Tokens> {
  const well = company(co) === WELL_COMPANY;
  const r = await sb<{ name: string; value: string }[]>(cfg, well ? '/rest/v1/rpc/connector_env' : '/rest/v1/rpc/connector_env_co',
    { method: 'POST', admin: true, body: well ? {} : { p_company: co } });
  if (!r.ok && !missingSchema(r)) console.warn('vault_read_failed', r.status);
  return r.ok ? toMap(r.data) : {};
}

/** Saves one secret for the company. Throws on a bad name, an empty value or a failed write (the caller says so in plain words). */
export async function putToken(cfg: Cfg, co: string, name: string, value: string): Promise<void> {
  if (!NAME.test(name)) throw new Error('vault: bad name');
  if (!value) throw new Error('vault: empty value');
  const well = company(co) === WELL_COMPANY;
  const r = await sb(cfg, well ? '/rest/v1/rpc/connector_put' : '/rest/v1/rpc/connector_put_co',
    { method: 'POST', admin: true, body: well ? { p_name: name, p_value: value } : { p_company: co, p_name: name, p_value: value } });
  if (!r.ok) throw new Error('vault write failed');
}

/** Removes the company's secrets by name (unknown names are ignored). */
export async function dropTokens(cfg: Cfg, co: string, names: string[]): Promise<void> {
  const ok = names.filter(n => NAME.test(n));
  if (!ok.length) return;
  const well = company(co) === WELL_COMPANY;
  await sb(cfg, well ? '/rest/v1/rpc/connector_drop' : '/rest/v1/rpc/connector_drop_co',
    { method: 'POST', admin: true, body: well ? { p_names: ok } : { p_company: co, p_names: ok } });
}
