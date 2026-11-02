// Weekly demand per lead source (CRM), used by /api/listening/demand. Route files export handlers only.
export type Lead = { source_platform?: string | null; created_at?: string | null };

export function weekly(leads: Lead[], now = Date.now()): { source: string; now: number; prev: number }[] {
  const w1 = now - 7 * 864e5, w2 = now - 14 * 864e5, by: Record<string, { now: number; prev: number }> = {};
  for (const l of leads) {
    const t = Date.parse(l.created_at || ''); if (!Number.isFinite(t) || t < w2) continue;
    const o = (by[l.source_platform || '?'] ||= { now: 0, prev: 0 });
    if (t >= w1) o.now++; else o.prev++;
  }
  return Object.entries(by).map(([source, v]) => ({ source, ...v })).sort((a, b) => b.now - a.now);
}
