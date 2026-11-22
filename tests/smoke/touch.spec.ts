// Touch targets on a phone (docs/PRD.md §3.10, milestone M2; UX audit 2026-11-12 measured them only in a 390px iframe):
// every visible control a finger presses is at least 44×44 CSS px at 390px wide. Links inside running text are exempt
// (WCAG 2.5.8 exception "inline"), as are controls the browser draws (checkbox inside a bigger label).
import { test, expect } from '@playwright/test';
import { login, addSession } from './helpers';

const PAGES = ['/today/', '/control/', '/overview/', '/social/', '/content/', '/design/', '/listening/', '/connectors/', '/knowledge/', '/maestro/', '/admin/', '/account/', '/settings/'];
const MIN = 44;

for (const path of PAGES) {
  test(`touch targets ≥ ${MIN}px at 390px: ${path}`, async ({ page, context, request }) => {
    await addSession(context, await login(request, 'owner'));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const small = await page.evaluate(min => {
      const out: string[] = [];
      const sel = 'button, a[href], [role=button], [role=tab], [role=menuitem], select, input:not([type=hidden]):not([type=checkbox]):not([type=radio]), summary';
      for (const el of document.querySelectorAll<HTMLElement>(sel)) {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (!r.width || !r.height || cs.visibility === 'hidden' || el.closest('[hidden],[inert],[aria-hidden=true]')) continue;
        if (r.bottom < 0 || r.top > innerHeight * 4) continue;
        // a link inside a sentence: its line box is the text's own
        if (el.tagName === 'A' && cs.display === 'inline' && el.parentElement && /^(P|LI|SPAN|SMALL|TD|DIV)$/.test(el.parentElement.tagName) && (el.parentElement.textContent || '').trim().length > (el.textContent || '').trim().length + 8) continue;
        // a checkbox/radio drawn by the browser inside a label: the label is the target
        if (r.width >= min - 0.5 && r.height >= min - 0.5) continue;
        const id = el.id ? '#' + el.id : '', cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
        out.push(`${el.tagName.toLowerCase()}${id}${cls} ${Math.round(r.width)}×${Math.round(r.height)} «${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24)}»`);
      }
      return out;
    }, MIN);
    expect(small, small.join('\n')).toEqual([]);
  });
}
