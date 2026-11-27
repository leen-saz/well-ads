// The department filter of the overview page. A department is the ad's own `dept` (pipeline/classify.py); an ad with none
// is «brand». Filtering happens once, on the data, so every card, chart, funnel and table below sees the same ads.
import { type Dash, DEP_AR, DEP_EN } from './numbers';
import { pageLang } from './lang';

export interface DeptOption { key: string; name: string }
type DeptCfg = { order?: string[]; departments?: Record<string, { ar?: string }> };

export const adDept = (a: { dept?: string } | undefined): string => a?.dept || 'brand';

export const deptName = (d: Dash, key: string): string => {
  const cfg = ((d as { departments?: DeptCfg }).departments ?? {}).departments ?? {};
  return (pageLang() === 'en' ? DEP_EN[key] : undefined) ?? cfg[key]?.ar ?? DEP_AR[key] ?? key;
};

// The departments that have ads, in the dashboard's order. `scope` is a department manager's own list: they get only those
// and no «all» (the page itself is closed to them today, see routes.ts; this keeps the filter safe if that ever opens).
export function deptOptions(d: Dash, scope?: string[] | null): DeptOption[] {
  const present = new Set(Object.values(d.ads ?? {}).map(adDept));
  const order = ((d as { departments?: DeptCfg }).departments?.order ?? Object.keys((d as { departments?: DeptCfg }).departments?.departments ?? {}));
  const keys = [...order.filter(k => present.has(k)), ...[...present].filter(k => !order.includes(k))];
  return keys.filter(k => !scope?.length || scope.includes(k)).map(key => ({ key, name: deptName(d, key) }));
}

// What the URL's ?dept= means: a known department the user may see, else 'all' (or the manager's first one when they have a scope)
export function resolveDept(d: Dash, raw: string | null, scope?: string[] | null): string {
  const opts = deptOptions(d, scope);
  if (raw && opts.some(o => o.key === raw)) return raw;
  return scope?.length ? (opts[0]?.key ?? 'all') : 'all';
}

// The data with only this department's ads and rows. The CRM's paid list (paid_all) has no ad on it, so it can't be split by
// department: it is dropped and closings become the ad-linked ones, like a platform filter (analytics.ts outcome()).
export function filterDept(d: Dash, dept: string): Dash {
  if (dept === 'all') return d;
  const ads = Object.fromEntries(Object.entries(d.ads ?? {}).filter(([, a]) => adDept(a) === dept));
  const crm = (d as { crm?: { rows?: unknown[][]; paid_all?: unknown[][] } }).crm;
  const out: Dash & { crm?: unknown } = {
    ...d, ads, deptScoped: dept,
    rows: (d.rows ?? []).filter(r => ads[String(r[0])]),
  };
  if (crm) out.crm = { ...crm, paid_all: undefined, rows: (crm.rows ?? []).filter(r => ads[String(r[0])]) };
  return out;
}
