// Arabic number formats shared by the overview pieces
import type { Fmt, JStat } from './analytics';
const n0 = new Intl.NumberFormat('ar-SA-u-nu-latn', { maximumFractionDigits: 0 });
const n2 = new Intl.NumberFormat('ar-SA-u-nu-latn', { maximumFractionDigits: 2 });

export const qty = (v: number): string => n0.format(v);
export const sar = (v: number | null): string => (v == null ? '—' : `${n2.format(v)} ر.س`);
export const pct = (v: number | null): string => (v == null ? '—' : `${n2.format(v * 100)}%`);
const long = new Intl.DateTimeFormat('ar-SA-u-nu-latn-ca-gregory', { day: 'numeric', month: 'long', timeZone: 'UTC' });
export const longDay = (day: string): string => long.format(new Date(day + 'T00:00:00Z'));
export const shortDay = (day: string): string => {
  const [, m, d] = day.split('-');
  return `${Number(d)}/${Number(m)}`;
};

// The journey's values by kind: count, riyals, percent (already ×100) and times
export const show: Record<Fmt, (v: number | null) => string> = {
  qty: v => (v == null ? '—' : qty(v)), sar, pct: v => (v == null ? '—' : `${v.toFixed(2)}%`), x: v => (v == null ? '—' : `${v.toFixed(2)}×`),
};

// A journey value as shown: its text when the number would mislead («غير مربوط»), else the number
export const val = (x: JStat): string => x.missing ?? show[x.fmt](x.now);
