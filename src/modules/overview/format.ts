// Arabic number formats shared by the overview pieces
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
