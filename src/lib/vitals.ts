// Web Vitals reports from the pages (public/assets/vitals.js): only a clean path and numbers in range are kept
const num = (v: unknown, max: number): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 1000) / 1000 : null;
};
// The report as logged: the tab's path (no query string), the three vitals and the server response time
export function cleanVitals(b: Record<string, unknown>): Record<string, unknown> | null {
  const raw = String(b.path || '').split(/[?#]/)[0]!.slice(0, 80);
  if (!/^\/[\w\-/]*$/.test(raw)) return null;
  // An id in the path is not a page: /c/<uuid> and /x/123 count as /c/:id and /x/:id
  const path = raw.split('/').map(seg => (/^[0-9a-f-]{8,}$/i.test(seg) || /^\d+$/.test(seg) ? ':id' : seg)).join('/');
  const out = { path, lcp: num(b.lcp, 120_000), inp: num(b.inp, 60_000), cls: num(b.cls, 50), ttfb: num(b.ttfb, 120_000), mobile: !!b.mobile };
  return out.lcp == null && out.inp == null && out.cls == null && out.ttfb == null ? null : out;
}

// ---- The owner's card: the last 24 hours per page, from the web_vitals table
export interface VitalRow { path: string; lcp: number | null; inp: number | null; cls: number | null; ttfb: number | null; mobile: boolean }
export interface VitalPage { path: string; n: number; mobile: number; lcp: number | null; inp: number | null; cls: number | null; ttfb: number | null }
// Google's targets (good): LCP 2.5 s, INP 200 ms, CLS 0.1. TTFB is shown as the server's own speed.
export const TARGETS = { lcp: 2500, inp: 200, cls: 0.1, ttfb: 800 } as const;

// 75th percentile, the figure Core Web Vitals are judged by
export function p75(values: (number | null)[]): number | null {
  const v = values.filter((x): x is number => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const x = v[Math.min(v.length - 1, Math.ceil(v.length * 0.75) - 1)]!;
  return Math.round(x * 1000) / 1000;
}
export function summarize(rows: VitalRow[]): VitalPage[] {
  const by = new Map<string, VitalRow[]>();
  for (const r of rows) by.set(r.path, [...(by.get(r.path) ?? []), r]);
  return [...by.entries()].map(([path, rs]) => ({
    path, n: rs.length, mobile: rs.filter(r => r.mobile).length,
    lcp: p75(rs.map(r => r.lcp)), inp: p75(rs.map(r => r.inp)), cls: p75(rs.map(r => r.cls)), ttfb: p75(rs.map(r => r.ttfb)),
  })).sort((a, b) => b.n - a.n);
}
