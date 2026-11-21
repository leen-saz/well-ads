// Queue slots (docs/PRD.md §3.2, milestone M6): the company's weekly publishing times, in Riyadh time (UTC+3, no daylight saving).
// «أضف للطابور» puts a post in the first slot from now on that no other scheduled or published post already holds.
// The queue only picks a time: the post still waits for its approver as every post does.
export interface Slot { weekday: number; at_local: string }   // weekday 0 = Sunday … 6 = Saturday; at_local 'HH:MM'
export const RIYADH_MS = 3 * 3600_000;
export const LEAD_MS = 10 * 60_000;        // a slot closer than this to now is skipped (the approver needs a moment)
export const HORIZON_DAYS = 28;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** A valid slot, or null. Seconds are dropped; anything else is refused. */
export function cleanSlot(v: unknown): Slot | null {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const weekday = Number(o.weekday);
  const at = String(o.at_local ?? '').slice(0, 5);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !HHMM.test(at)) return null;
  return { weekday, at_local: at };
}

/** Every slot instant (UTC ms) in [from, from + days), in time order. */
export function slotTimes(slots: Slot[], from: number, days = HORIZON_DAYS): number[] {
  const out: number[] = [];
  const startDay = Math.floor((from + RIYADH_MS) / 864e5);   // the Riyadh calendar day of `from`
  for (let d = 0; d <= days; d++) {
    const dayStartUtc = (startDay + d) * 864e5 - RIYADH_MS;   // Riyadh midnight of that day, in UTC
    const weekday = new Date((startDay + d) * 864e5).getUTCDay();
    for (const s of slots) {
      if (s.weekday !== weekday) continue;
      const m = HHMM.exec(s.at_local); if (!m) continue;
      const t = dayStartUtc + (Number(m[1]) * 60 + Number(m[2])) * 60_000;
      if (t >= from && t < from + days * 864e5) out.push(t);
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/** The first free slot from now + LEAD_MS. `taken` holds the publish times (ISO or ms) already used. null = no slot or all taken. */
export function nextSlot(slots: Slot[], taken: (string | number)[], now = Date.now()): string | null {
  const used = new Set(taken.map(x => Math.floor((typeof x === 'number' ? x : Date.parse(x)) / 60_000)));
  for (const t of slotTimes(slots, now + LEAD_MS)) if (!used.has(Math.floor(t / 60_000))) return new Date(t).toISOString();
  return null;
}
