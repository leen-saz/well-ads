// Vault writes for the connectors (Supabase Vault through the service-role-only RPCs of 005_connectors.sql).
// Values never come back to the browser; the audit log names the fields only. Shared by the connect routes and the
// Social tab's page chooser (src/modules/social/routes.ts).
import { sb, audit, type Cfg, type Session } from './auth';
import type { Values } from './connectors';

type Row = Record<string, unknown>;
const rows = (d: unknown): Row[] => (Array.isArray(d) ? (d as Row[]) : []);

// drop: names to remove from the vault and from the platform's saved names (a stale value that must not stay bound)
export async function saveValues(cfg: Cfg, user: Session, p: { id: string }, method: 'key' | 'oauth', values: Values,
  { shown = {}, expiresIn = null, checked = null, drop = [] }: { shown?: Values | undefined; expiresIn?: number | null; checked?: string | null; drop?: string[] | undefined } = {}): Promise<void> {
  const names = Object.keys(values);
  for (const name of names) {
    const r = await sb(cfg, '/rest/v1/rpc/connector_put', { method: 'POST', admin: true, body: { p_name: name, p_value: values[name] } });
    if (!r.ok) throw new Error('vault write failed');
  }
  const gone = drop.filter(n => !names.includes(n));
  if (gone.length) await sb(cfg, '/rest/v1/rpc/connector_drop', { method: 'POST', admin: true, body: { p_names: gone } });
  const old = await sb(cfg, `/rest/v1/connections?platform=eq.${encodeURIComponent(p.id)}&select=names,shown`, { admin: true });
  const prev = (old.ok ? rows(old.data)[0] : undefined) || { names: [], shown: {} };
  const row: Row = {
    platform: p.id, method, names: [...new Set([...((prev.names as string[]) || []), ...names])].filter(n => !gone.includes(n)), shown: { ...((prev.shown as Values) || {}), ...shown },
    connected_by: user.email, connected_at: new Date().toISOString(), checked,
  };
  if (expiresIn) row.expires_at = new Date(Date.now() + expiresIn * 1000).toISOString();
  else if (method === 'key') row.expires_at = null;
  const w = await sb(cfg, '/rest/v1/connections', { method: 'POST', admin: true, headers: { Prefer: 'return=minimal,resolution=merge-duplicates' }, body: row });
  if (!w.ok) throw new Error('connections write failed');
  await audit(cfg, user, 'connector_saved', { target: { platform: p.id, method, names } });
}
