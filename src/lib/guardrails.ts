// control_settings.guardrails is one JSON per platform row, written by several people (the emergency stop by anyone with the
// board, limits and rules by the owner). A plain read, change, write of the whole JSON lets a slow writer put back an old value:
// the owner saves limits with kill=false in hand while someone presses the emergency stop, and the stop is silently undone.
// So every write goes through here: the row is changed only if it is still the one that was read (`updated_at` unchanged),
// otherwise it is read again and the change is applied on top of the newer value.
import { sb, type Cfg } from './auth';

type Row = Record<string, unknown>;
const TRIES = 6;

export interface Patched { ok: boolean; guardrails: Row; before: Row }

// `mutate` gets a copy of the current guardrails and returns the new JSON, or null for "nothing to change".
export async function patchGuardrails(cfg: Cfg, platform: string, mutate: (g: Row) => Row | null, by: string | null | undefined): Promise<Patched> {
  const p = encodeURIComponent(platform);
  for (let i = 0; i < TRIES; i++) {
    const r = await sb<{ guardrails?: Row | null; updated_at?: string | null }[]>(cfg, `/rest/v1/control_settings?platform=eq.${p}&select=guardrails,updated_at`, { admin: true });
    if (!r.ok || !Array.isArray(r.data)) return { ok: false, guardrails: {}, before: {} };
    const row = r.data[0];
    if (!row) {
      // No row yet: create it empty (a parallel creator wins harmlessly), then read again
      const c = await sb(cfg, '/rest/v1/control_settings', { method: 'POST', admin: true, headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' }, body: { platform, mode: 'manual', guardrails: {} } });
      if (!c.ok) return { ok: false, guardrails: {}, before: {} };
      continue;
    }
    const before = { ...((row.guardrails ?? {}) as Row) };
    const next = mutate({ ...before });
    if (next === null) return { ok: true, guardrails: before, before };
    const old = row.updated_at ?? null;
    let at = new Date().toISOString();
    if (old && Date.parse(old) >= Date.parse(at)) at = new Date(Date.parse(old) + 1).toISOString();   // always a new value, so a parallel writer's check fails
    const w = await sb<Row[]>(cfg, `/rest/v1/control_settings?platform=eq.${p}&updated_at=${old ? `eq.${encodeURIComponent(old)}` : 'is.null'}`, {
      method: 'PATCH', admin: true, headers: { Prefer: 'return=representation' }, body: { guardrails: next, updated_by: by ?? null, updated_at: at },
    });
    if (!w.ok) return { ok: false, guardrails: before, before };
    if (Array.isArray(w.data) && w.data.length === 1) return { ok: true, guardrails: next, before };
    // 0 rows: someone wrote in between. Read again and apply the change on top of theirs.
  }
  return { ok: false, guardrails: {}, before: {} };
}

// The emergency stop, read fresh. A database that cannot be read is treated as "stop": never as "kill is off".
export async function killOn(cfg: Cfg): Promise<boolean> {
  const r = await sb<{ guardrails?: Row | null }[]>(cfg, '/rest/v1/control_settings?platform=eq.global&select=guardrails', { admin: true });
  if (!r.ok || !Array.isArray(r.data)) return true;
  return r.data[0]?.guardrails?.kill === true;
}
