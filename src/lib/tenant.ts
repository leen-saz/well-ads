// SaaS: every row belongs to one company. Well is the first company (migration 006).
// The server uses the service role, which bypasses RLS, so every query names its company itself.
export const WELL_COMPANY = '00000000-0000-0000-0000-000000000001';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const companyOf = (id: unknown): string => (typeof id === 'string' && UUID.test(id) ? id.toLowerCase() : WELL_COMPANY);

// Adds the company filter to a Supabase REST path: /rest/v1/x?select=* -> /rest/v1/x?select=*&company_id=eq.<id>
export function scoped(path: string, company: string): string {
  if (!UUID.test(company)) throw new Error('bad company');
  return `${path}${path.includes('?') ? '&' : '?'}company_id=eq.${company}`;
}
