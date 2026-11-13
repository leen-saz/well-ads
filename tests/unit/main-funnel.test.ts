// The main dashboard's customer journey (funnelHTML at the end of pipeline/dash/05-render.js), run on its own with the page's helpers stubbed:
// a horizontal pipe that narrows with the numbers, and the marketing judge (pipeline/dash/00-judge.js, the same file Overview uses).
import { describe, expect, it } from 'vitest';
import render from '../../pipeline/dash/05-render.js?raw';
import { J } from '../../src/modules/overview/judge';

// The funnel section of the page script: from its header comment to the end of the file
const START = '// رحلة العميل كأنبوب أفقي';
const src = render.slice(render.indexOf(START));

type Fn = (...a: unknown[]) => unknown;
type Verdict = { level: string; step: string | null; owner: string | null; evidence: string; sar: number | null; unlinked: unknown; steps: { key: string; level: string; unattributed: boolean; line: string }[] };
type Api = { FUN: { MIN: number; MAX: number }; funShape: Fn; funPath: Fn; funX: (i: number) => number; funJudge: (a: unknown) => Verdict; funnelHTML: Fn; funTargetsHTML: () => string };
// The period's rows match `base` below: one ad, one day
const ROWS = [['a', '2026-10-05', 15000, 200000, 3000, 70, 20]];
// The page's script runs with these names in scope (no Node typings in this project, so no node:vm)
function page(over: { crm?: unknown; rows?: unknown[][]; LANG?: string } = {}) {
  const fmt = (n: number | null, d = 0) => (n == null || !isFinite(n) ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }));
  const lang = over.LANG ?? 'ar';
  const scope: Record<string, unknown> = {
    D: { rows: over.rows ?? ROWS, crm: over.crm }, ADS: { a: { platform: 'facebook', goal: 'lead' } },
    S: { from: '2026-10-01', to: '2026-10-30', crmBy: 'lead', plat: 'all', stat: 'all', dept: '', camp: '', goal: '', fmt: '' }, MAX: '2026-10-30',
    LANG: lang, JUDGE: J, render: () => {}, document: { addEventListener: () => {} }, localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    matchesSlice: () => true, tr: (s: string) => s, ui: (ar: string, en: string) => (lang === 'en' ? en : ar), money: () => 'ريال', fmt,
    qty: (n: number) => fmt(n), sar: (n: number | null) => (n == null ? '—' : fmt(n, 2)), pct: (n: number | null) => (n == null ? '—' : fmt(n, 2) + '%'),
    addDays: (s: string, n: number) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); },
    delta: (x: number | null, y: number | null) => (x == null || y == null || !y ? '<span class="delta flat">— لا مقارنة</span>' : `<span class="delta">${x > y ? '▲' : '▼'} عن الفترة السابقة</span>`),
  };
  const run = new Function(...Object.keys(scope), src + '\n;return { FUN, funShape, funPath, funX, funJudge, funnelHTML, funTargetsHTML };');
  return run(...Object.values(scope)) as Api;
}
const base = { spend: 15000, impr: 200000, clicks: 3000, leads: 70, conv: 20, crmLeads: 60, booked: 6, allPaidN: 8, allPaid: 12000, ctr: 1.5, cpl: 50, closeRate: 10 };
const tiedCrm = { rows: Array.from({ length: 60 }, (_, i) => ['a', '2026-10-05', i < 6 ? '2026-10-06' : '', i < 6, i < 6 ? 1500 : 0]), paid_all: Array.from({ length: 8 }, () => ['2026-10-05', '2026-10-06', 1500, 'x']) };

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

  it('paid closings in the CRM with none tied to an ad: sales are still judged on the whole CRM; only the ads\' own figures are «غير مربوط»', () => {
    const crm = { rows: [['a', '2026-10-05', '', false, 0]], paid_all: Array.from({ length: 45 }, () => ['2026-10-05', '2026-10-06', 900, 'manual']) };
    const f = page({ crm }), a = { ...base, booked: 0, closeRate: 0, allPaidN: 45 };
    const v = f.funJudge(a), sale = v.steps.find(s => s.key === 'sale')!;
    expect(sale).toMatchObject({ unattributed: false });
    expect(sale.line).toContain('مقابل هدف 8%');
    expect(v.unlinked).not.toBeNull();
    const html = f.funnelHTML(a, {}) as string;
    expect(html).toContain('الربط بالإعلانات ناقص');
    expect(html).toMatch(/اقفالات من الإعلانات<\/span><span class="v">غير مربوط/);
    // The sale link: 45 ÷ 90 leads and chats, not «غير مربوط» and not 0%
    expect(html).toContain('>50.00%</text>');
  });

  it('no CRM at all: the sale link is «غير مربوط», not judged, and the note says why', () => {
    const f = page(), v = f.funJudge(base);
    expect(v.steps.find(s => s.key === 'sale')).toMatchObject({ level: 'na', unattributed: true });
    expect(v.steps.map(s => s.key)).toEqual(['click', 'lead', 'sale', 'cpl']);
    expect(v.step).not.toBe('sale');
    const html = f.funnelHTML(base, {}) as string;
    expect(html).toContain('نظام العملاء مو موصول بهالأرقام');
    expect(html).not.toContain('0.00%');
  });

  it('the same verdict as Overview for the same numbers (one rules file)', () => {
    const f = page({ crm: tiedCrm }), a = { ...base, ctr: 0.5, clicks: 1000, impr: 200000 };
    const mine = f.funJudge(a);
    const theirs = J.judge({ top: { impr: 200000, clicks: 1000, results: 90, spend: 15000, cpl: 50 },
      sale: { crm: true, results: 90, spend: 15000, closings: 8, paid: 12000, adClosings: 6, adLeads: 60, wide: false },
      cohort: J.cohort([['2026-10-05', 90]], tiedCrm.paid_all.map(r => [r[0], r[1]] as [string, string]), '2026-10-01', '2026-10-30', '2026-10-30', 30) }, J.targets(), 'ar', {
      pct: v => `${Number(v.toFixed(Math.abs(v) < 0.1 ? 3 : 2)).toLocaleString('en-US', { maximumFractionDigits: 3 })}%`, sar: v => v.toFixed(0), x: v => v.toFixed(2), qty: v => String(v), num: (v, d) => v.toFixed(d) });
    expect(mine.level).toBe(theirs.level);
    expect(mine.step).toBe(theirs.step);
    expect(mine.sar ?? 0).toBeCloseTo(theirs.sar ?? 0);
    expect(mine.steps.map(s => s.level)).toEqual(theirs.steps.map(s => s.level));
  });

  it('each step names the department that owns it; the verdict names the worst', () => {
    const f = page({ crm: tiedCrm });
    expect(f.funJudge({ ...base, clicks: 600 })).toMatchObject({ step: 'click', owner: 'الإنتاج / الكريتيف' });
    const v = f.funJudge(base);
    expect(v.steps.find(s => s.key === 'lead')).toBeDefined();
    expect(['sale', 'lead', 'cpa', 'roas']).toContain(v.step);
    expect(v.level).not.toBe('fine');
  });

  it('no green «تمام» badge while a step is under target; the targets table says «افتراضي — عدّله»', () => {
    const f = page({ crm: tiedCrm }), html = f.funnelHTML({ ...base }, {}) as string;
    expect(html).toMatch(/<div class="fverdict (watch|bad|bad dis)">/);
    const t = f.funTargetsHTML();
    expect(t.match(/data-ftarget="/g)).toHaveLength(7);
    expect(t.match(/افتراضي — عدّله/g)).toHaveLength(7);
  });

  it('the sale stage shows the sales amount; the CRM total, said so, when the closings are not tied to ads', () => {
    const tied = page({ crm: tiedCrm }).funnelHTML({ ...base, value: 9000 }, {}) as string;
    expect(tied).toContain('مبلغ المبيعات: 12,000.00');
    const loose = page({ crm: { rows: [['a', '2026-10-05', '', false, 0]], paid_all: [['2026-10-05', '2026-10-06', 900, 'manual']] } })
      .funnelHTML({ ...base, booked: 0, closeRate: 0, allPaidN: 45, allPaid: 67500, value: 0 }, {}) as string;
    expect(loose).toContain('إجمالي المدفوع (CRM): 67,500.00');
    expect(loose).toMatch(/المبيعات من الإعلانات<\/span><span class="v">غير مربوط/);
    expect(loose).toContain('<b>نظام العملاء / العمليات</b>');
  });

  it('one «التحليل» heading over the lines', () => {
    const html = page({ crm: tiedCrm }).funnelHTML({ ...base }, {}) as string;
    expect(html.match(/<h4 class="flines-h">/g)).toHaveLength(1);
    expect(html).toContain('<h4 class="flines-h">التحليل</h4>');
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
