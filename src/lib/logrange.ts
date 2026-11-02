// Activity log filter: ?from / ?to as whole days in Riyadh time (UTC+3, no DST), both ends included.
// Returns PostgREST filters on audit_log.at; bad dates are ignored.
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export function logRange(from: string | null, to: string | null): string {
  const iso = (d: string, add: number) => new Date(Date.parse(`${d}T00:00:00+03:00`) + add * 864e5).toISOString();
  let q = '';
  if (from && DAY.test(from) && Number.isFinite(Date.parse(from))) q += `&at=gte.${iso(from, 0)}`;
  if (to && DAY.test(to) && Number.isFinite(Date.parse(to))) q += `&at=lt.${iso(to, 1)}`;
  return q;
}
