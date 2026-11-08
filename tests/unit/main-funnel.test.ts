// The main dashboard's customer journey (funnelHTML at the end of pipeline/dash/05-render.js), run on its own with the page's helpers stubbed:
// a horizontal pipe that narrows with the numbers, «غير مربوط» instead of a false 0%, and the bottleneck rules.
import { describe, expect, it } from 'vitest';
import render from '../../pipeline/dash/05-render.js?raw';

// The funnel section of the page script: from its header comment to the end of the file
const START = '// رحلة العميل كأنبوب أفقي';
const src = render.slice(render.indexOf(START));

type Fn = (...a: unknown[]) => unknown;
type Api = { FUN: { MIN: number; MAX: number }; funShape: Fn; funPath: Fn; funX: (i: number) => number; funSteps: Fn; funVerdict: Fn; funUnlinked: Fn; funnelHTML: Fn };
// The page's script runs with these names in scope (no Node typings in this project, so no node:vm)
function page(over: { crm?: unknown; rows?: unknown[][]; LANG?: string } = {}) {
  const fmt = (n: number | null, d = 0) => (n == null || !isFinite(n) ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }));
  const scope: Record<string, unknown> = {
    D: { rows: over.rows ?? [], crm: over.crm }, ADS: { a: { platform: 'facebook', goal: 'lead' } }, S: { from: '2026-10-01', to: '2026-10-30', crmBy: 'lead' },
    LANG: over.LANG ?? 'ar', matchesSlice: () => true, tr: (s: string) => s, ui: (ar: string) => ar, money: () => 'ر.س', fmt,
    qty: (n: number) => fmt(n), sar: (n: number | null) => (n == null ? '—' : fmt(n, 2)), pct: (n: number | null) => (n == null ? '—' : fmt(n, 2) + '%'),
    addDays: (s: string, n: number) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); },
    delta: (x: number | null, y: number | null) => (x == null || y == null || !y ? '<span class="delta flat">— لا مقارنة</span>' : `<span class="delta">${x > y ? '▲' : '▼'} عن الفترة السابقة</span>`),
  };
  const run = new Function(...Object.keys(scope), src + '\n;return { FUN, funShape, funPath, funX, funSteps, funVerdict, funUnlinked, funnelHTML };');
  return run(...Object.values(scope)) as Api;
}
const base = { spend: 15000, impr: 200000, clicks: 3000, leads: 70, conv: 20, crmLeads: 60, booked: 6, allPaidN: 8, ctr: 1.5, cpl: 50, closeRate: 10 };
const usual = { click: 1.5, lead: 3, cpl: 50 };
type Step = { key: string; level: string; score: number | null; unlinked?: boolean; line: string };

describe('main dashboard: customer journey', () => {
  it('the funnel section is found', () => expect(render.indexOf(START)).toBeGreaterThan(0));

  it('the pipe narrows with the numbers on an eased scale, with a neck on every link; stage 1 on the right in Arabic', () => {
    const f = page(), sh = f.funShape([2000000, 30000, 600, 12], [1, 1, 1]) as { heights: number[]; waists: number[] };
    expect(sh.heights.every((h, i) => i === 0 || h < sh.heights[i - 1]!)).toBe(true);
    expect(sh.heights[1]).toBeLessThan(f.FUN.MAX * 0.6);
    expect(sh.heights[3]).toBeGreaterThan(f.FUN.MIN);
    sh.waists.forEach((w, i) => expect(w).toBeLessThan(Math.min(sh.heights[i]!, sh.heights[i + 1]!)));
    expect(f.funX(0)).toBeGreaterThan(f.funX(3));
    expect(page({ LANG: 'en' }).funX(0)).toBeLessThan(page({ LANG: 'en' }).funX(3));
    expect(f.funPath(sh)).toMatch(/^M0,[\d.]+C.*Z$/);
  });

  it('paid closings in the CRM with none tied to an ad: «غير مربوط», no 0%, never the bottleneck', () => {
    const crm = { rows: [['a', '2026-10-05', '', false, 0]], paid_all: [['2026-10-05', '2026-10-06', 900, 'manual']] };
    const f = page({ crm }), a = { ...base, booked: 0, closeRate: 0, allPaidN: 45 };
    expect(f.funUnlinked(a)).toBe('none');
    const steps = f.funSteps(a, { ...base }, usual, 3, 3, 'none') as Step[];
    const sale = steps.find(s => s.key === 'sale')!;
    expect(sale).toMatchObject({ unlinked: true, score: null });
    expect(sale.line).toContain('45 اقفالة');
    expect(sale.line).toContain('مو صفر');
    expect((f.funVerdict(steps) as { step: string; unlinked: boolean }).step).not.toBe('sale');
    const html = f.funnelHTML(a, {}) as string;
    expect(html).toContain('غير مربوط');
    expect(html).not.toContain('0.00%');
    expect(html).toContain('مرحلة البيع غير مربوطة');
  });

  it('no CRM at all, or too few leads tied to an ad: also «غير مربوط»', () => {
    expect(page().funUnlinked(base)).toBe('nocrm');
    expect(page({ crm: { rows: [], paid_all: [] } }).funUnlinked({ ...base, crmLeads: 5 })).toBe('cover');
    expect(page({ crm: { rows: [['a', '2026-10-05', '2026-10-05', true, 900]], paid_all: [] } }).funUnlinked(base)).toBeNull();
  });

  it('a step under its floor is the bottleneck before one only weaker than usual', () => {
    const f = page({ crm: { rows: [], paid_all: [] } });
    const steps = f.funSteps({ ...base, cpl: 81.5 }, { ...base, cpl: 66.5 }, { click: null, lead: null, cpl: null }, 1.43, 1.72, null) as Step[];
    expect(f.funVerdict(steps)).toMatchObject({ step: 'lead', level: 'bad', title: 'النقرات ما تصير ليدز' });
  });

  it('every change figure in the block says what it compares against', () => {
    const f = page({ crm: { rows: [['a', '2026-10-05', '2026-10-05', true, 900]], paid_all: [['2026-10-05', '2026-10-05', 900, 'x']] } });
    const html = f.funnelHTML({ ...base, cpm: 75, cpc: 5, roas: 0.6 }, { ...base, impr: 150000, cpm: 70, cpc: 4, roas: 0.5 }) as string;
    const deltas = html.match(/<span class="delta">[^<]*<\/span>/g) ?? [];
    expect(deltas.length).toBeGreaterThan(5);
    deltas.forEach(d => expect(d).toContain('عن الفترة السابقة'));
    expect(html).not.toContain('لا مقارنة');
  });
});
