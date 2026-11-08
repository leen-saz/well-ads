// Number and date formats shared by the overview pieces, in the page language (lang.ts). Digits are Latin in both.
import type { Fmt, JStat } from './analytics';
import { pageLang } from './lang';

const LOCALE = { ar: 'ar-SA-u-nu-latn-ca-gregory', en: 'en-US' } as const;
const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();
const nf = (digits: number) => {
  const k = `n${digits}${pageLang()}`;
  if (!cache.has(k)) cache.set(k, new Intl.NumberFormat(LOCALE[pageLang()], { maximumFractionDigits: digits }));
  return cache.get(k) as Intl.NumberFormat;
};
const df = () => {
  const k = `d${pageLang()}`;
  if (!cache.has(k)) cache.set(k, new Intl.DateTimeFormat(LOCALE[pageLang()], { day: 'numeric', month: 'long', timeZone: 'UTC' }));
  return cache.get(k) as Intl.DateTimeFormat;
};

export const qty = (v: number): string => nf(0).format(v);
export const sar = (v: number | null): string => (v == null ? '—' : `${nf(2).format(v)} ${pageLang() === 'en' ? 'SAR' : 'ر.س'}`);
export const pct = (v: number | null): string => (v == null ? '—' : `${nf(2).format(v * 100)}%`);
export const longDay = (day: string): string => df().format(new Date(day + 'T00:00:00Z'));
// Day/month in Arabic, month/day in English (the way each reads a short date)
export const shortDay = (day: string): string => {
  const [, m, d] = day.split('-');
  return pageLang() === 'en' ? `${Number(m)}/${Number(d)}` : `${Number(d)}/${Number(m)}`;
};

// The journey's values by kind: count, riyals, percent (already ×100) and times
export const show: Record<Fmt, (v: number | null) => string> = {
  qty: v => (v == null ? '—' : qty(v)), sar, pct: v => (v == null ? '—' : `${v.toFixed(2)}%`), x: v => (v == null ? '—' : `${v.toFixed(2)}×`),
};

// A journey value as shown: its text when the number would mislead («غير مربوط»), else the number
export const val = (x: JStat): string => x.missing ?? show[x.fmt](x.now);
