// The customer journey: the same funnel as the main dashboard (pipeline/dash/05-render.js), the sale stage always there,
// and the same numbers as the pipeline page for the same dates (tests/parity/golden.json, built from the same fixture).
import { describe, expect, it } from 'vitest';
import { FUNNEL_COLOURS, FUNNEL_WIDTHS, NO_CRM, journey, outcome } from './analytics';
import type { Dash } from './numbers';
import fixture from '../../../tests/parity/fixtures/ads.json';
import golden from '../../../tests/parity/golden.json';
import render from '../../../pipeline/dash/05-render.js?raw';

const FX = fixture as unknown as Dash;
const G = golden as unknown as Record<string, { sections: { id: string; kpis: [string, string, string][] }[] }>;
// The pipeline page's journey numbers for a view, by label ("1,883,479" → 1883479, "16.52ر.س" → 16.52, "1.42%" → 1.42)
const shown = (view: string) => Object.fromEntries(G[view]!.sections.find(s => s.id === 'kpis')!.kpis
  .map(([l, v]) => [l, v === '—' ? null : Number(v.replace('ر.س', '').replace(/[^\d.]/g, ''))]));
const stat = (o: ReturnType<typeof journey>) => Object.fromEntries(o.stages.flatMap(s => [s.main, ...s.sub, ...(s.rate ? [s.rate] : [])]).map(x => [x.label, x.now]));

describe('overview: customer journey', () => {
  it('four layers, each narrower than the one above, in the main dashboard colours', () => {
    const j = journey(outcome(FX, '2026-10-15', '2026-10-21'));
    expect(j.stages.map(s => s.n)).toEqual(['الوعي', 'الاهتمام', 'التحويل', 'البيع']);
    const w = j.stages.map(s => s.width);
    expect(w.every((x, i) => i === 0 || x < w[i - 1]!)).toBe(true);
    expect(j.stages.slice(1).every(s => s.rate)).toBe(true);
    expect(render).toContain(`const widths = ${JSON.stringify(FUNNEL_WIDTHS).replace(/,/g, ', ')}`);
    expect(render).toContain(JSON.stringify(FUNNEL_COLOURS).replace(/"/g, "'"));
  });

  it('the sale layer shows with no CRM: "—" and the reason', () => {
    const j = journey(outcome(FX, '2026-10-15', '2026-10-21'));
    const sale = j.stages[3]!;
    expect([sale.main, ...sale.sub, sale.rate!].every(x => x.now == null && x.key == null)).toBe(true);
    expect(j.noCrm).toBe(NO_CRM);
  });

  it('the sale layer with CRM: every paid closing, or the ad-linked ones when that list is missing', () => {
    const k = Object.keys(FX.ads ?? {})[0]!;
    const withAll = { ...FX, crm: { rows: [[k, '2026-10-16', '2026-10-17', true, 900]], paid_all: [['2026-10-16', '2026-10-17', 900, 'x'], ['2026-10-18', '2026-10-19', 400, 'y']] } } as unknown as Dash;
    const a = journey(outcome(withAll, '2026-10-15', '2026-10-21'));
    expect(a.noCrm).toBeNull();
    expect(a.stages[3]!.main).toMatchObject({ key: 'closings', now: 2 });
    // One CRM lead for hundreds of fixture leads: the ad-linked figures are «غير مربوط», not 1 or 0
    const by = (label: string) => a.stages[3]!.sub.find(x => x.label === label);
    expect(by('إقفالات من الإعلانات')).toMatchObject({ key: null, now: null, missing: 'غير مربوط' });
    // Not tied to ads: the amount is the CRM's total, said so, and the ads' share is «غير مربوط», not 0
    expect(a.stages[3]!.amount).toMatchObject({ label: 'إجمالي المدفوع (CRM)', key: 'paid', now: 1300 });
    expect(by('المبيعات من الإعلانات')).toMatchObject({ now: null, missing: 'غير مربوط' });
    expect(a.stages[3]!.rate).toMatchObject({ now: null, missing: 'غير مربوط' });
    const rowsOnly = { ...FX, crm: { rows: [[k, '2026-10-16', '2026-10-17', true, 900]] } } as unknown as Dash;
    expect(journey(outcome(rowsOnly, '2026-10-15', '2026-10-21')).stages[3]!.main).toMatchObject({ key: 'booked', now: 1 });
  });

  for (const [view, from, to] of [['overview 7d', '2026-10-15', '2026-10-21'], ['overview 30d', '2026-09-22', '2026-10-21'], ['overview last month', '2026-09-01', '2026-09-30']] as const) {
    it(`same numbers as the analytics page (${view})`, () => {
      const page = shown(view), mine = stat(journey(outcome(FX, from, to)));
      const labels: [string, string][] = [['الظهور', 'الظهور'], ['تكلفة الألف ظهور', 'تكلفة الألف ظهور'], ['نسبة النقر', 'نسبة النقر'],
        ['نقرات الرابط والسوايب', 'نقرات الرابط والسوايب'], ['تكلفة النقرة', 'تكلفة النقرة'], ['من نقرة إلى ليد', 'من نقرة إلى ليد أو محادثة'],
        ['الليدز', 'الليدز'], ['تكلفة الليد', 'تكلفة الليد'], ['محادثات واتساب وماسنجر', 'محادثات واتساب وماسنجر']];
      for (const [theirs, ours] of labels) {
        expect(page[theirs], theirs).not.toBeUndefined();
        expect(mine[ours], ours).toBeCloseTo(page[theirs] as number, 1);
      }
    });
  }
});
