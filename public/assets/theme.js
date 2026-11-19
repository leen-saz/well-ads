// Light / dark / follow the device (docs/PRD.md §4.3). The choice lives in the «well-theme» cookie so the Worker paints
// the next page in it before any script runs (src/lib/theme.ts); here it is applied at once to the open page.
export const THEMES = ['light', 'dark', 'system'];
export const THEME_NAMES = { light: 'فاتح', dark: 'داكن', system: 'حسب الجهاز' };

export function currentTheme() {
  const t = document.documentElement.dataset.theme;
  return THEMES.includes(t) ? t : 'light';
}

export function setTheme(t) {
  if (!THEMES.includes(t)) return;
  document.documentElement.dataset.theme = t;
  // A preference, not a secret: readable by scripts on purpose; one year; the whole site
  document.cookie = `well-theme=${t}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
}

/** The next theme in the order light → dark → system → light. */
export const nextTheme = t => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length];
