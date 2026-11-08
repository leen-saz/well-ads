// The page language, read from the same place as public/assets/i18n.js (?lang=, then well-ads-lang in localStorage).
// Not from <html lang>: the island can render before i18n.js has set it. Text built here (sentences with numbers in
// them) can't go through i18n.js's word list, so it comes out in the right language already; the word list leaves it alone.
export type Lang = 'ar' | 'en';
export function pageLang(): Lang {
  if (typeof window === 'undefined') return 'ar';
  const q = new URLSearchParams(window.location.search).get('lang');
  if (q === 'en' || q === 'ar') return q;
  try { if (window.localStorage.getItem('well-ads-lang') === 'en') return 'en'; } catch { /* storage blocked */ }
  return document.documentElement.lang === 'en' ? 'en' : 'ar';
}
export const pick = (l: Lang, ar: string, en: string): string => (l === 'en' ? en : ar);
// The same in the current page language: T('الصرف', 'Spend')
export const T = (ar: string, en: string): string => pick(pageLang(), ar, en);
