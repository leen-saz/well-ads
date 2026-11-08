// شكل رحلة العميل: ارتفاع كل مرحلة من حجمها (مقياس مخفّف) وضيق الوصلة من قوة الخطوة، واتجاهه حسب اللغة.
// الحكم نفسه (كل خطوة مقابل هدف ثابت) في judge.ts، من نفس ملف القواعد اللي تستخدمه اللوحة الرئيسية.
export type { Step, StepKey, Verdict, Severity } from './judge';

// ---- The band. Heights on an eased scale ((v / top)^EASE) between minH and maxH: it visibly shrinks with the numbers
// (a log scale made 1.9M impressions and 27K clicks look alike) while the sale stage stays visible. Every link narrows
// into a neck (NECK of the smaller stage), pinched further by a weak step's score, so a weak step reads as the bottleneck.
export const EASE = 0.25, NECK = 0.6, MIN_NECK = 8;
export interface Shape { heights: number[]; waists: number[] }
export function shape(volumes: (number | null)[], linkScores: (number | null)[], maxH: number, minH: number): Shape {
  const top = Math.max(1, ...volumes.map(v => v ?? 0));
  const h = (v: number | null) => (v == null || v <= 0 ? minH : minH + (maxH - minH) * (v / top) ** EASE);
  const heights = volumes.map(h);
  const waists = linkScores.map((s, i) => Math.max(MIN_NECK, Math.min(heights[i]!, heights[i + 1]!) * NECK * Math.max(0.35, Math.min(1, s ?? 1))));
  return { heights, waists };
}

// Where stage i sits: stage 1 on the right when the page reads right to left (Arabic), on the left in English
export const stageX = (i: number, n: number, width: number, rtl = true): number => (rtl ? width - (i + 0.5) * (width / n) : (i + 0.5) * (width / n));
export const linkX = (i: number, n: number, width: number, rtl = true): number => (stageX(i, n, width, rtl) + stageX(i + 1, n, width, rtl)) / 2;

// The band's points left to right for d3-shape's area: a flat run over each stage and a waist between stages
export function points(s: Shape, width: number, rtl = true, plateau = 0.42): { x: number; h: number }[] {
  const n = s.heights.length, slot = width / n, cx = (i: number) => stageX(i, n, width, rtl);
  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => cx(i) - cx(j));
  const out: { x: number; h: number }[] = [];
  order.forEach((i, k) => {
    out.push({ x: cx(i) - (slot * plateau) / 2, h: s.heights[i]! }, { x: cx(i) + (slot * plateau) / 2, h: s.heights[i]! });
    const j = order[k + 1];
    if (j != null) out.push({ x: (cx(i) + cx(j)) / 2, h: s.waists[Math.min(i, j)]! });
  });
  out[0] = { ...out[0]!, x: 0 }; out[out.length - 1] = { ...out[out.length - 1]!, x: width };
  return out;
}
