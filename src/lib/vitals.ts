// Web Vitals reports from the pages (public/assets/vitals.js): only a clean path and numbers in range are kept
const num = (v: unknown, max: number): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 1000) / 1000 : null;
};
// The report as logged: the tab's path (no query string), the three vitals and the server response time
export function cleanVitals(b: Record<string, unknown>): Record<string, unknown> | null {
  const path = String(b.path || '').split(/[?#]/)[0]!.slice(0, 80);
  if (!/^\/[\w\-/]*$/.test(path)) return null;
  const out = { path, lcp: num(b.lcp, 120_000), inp: num(b.inp, 60_000), cls: num(b.cls, 50), ttfb: num(b.ttfb, 120_000), mobile: !!b.mobile };
  return out.lcp == null && out.inp == null && out.cls == null && out.ttfb == null ? null : out;
}
