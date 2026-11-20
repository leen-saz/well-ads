// The command palette's search (public/assets/palette.js, docs/PRD.md §4.5, milestone M4)
import { describe, expect, it } from 'vitest';
import { fold, search, entries } from '../../public/assets/palette.js';
import { sections } from '../../public/assets/sidebar.js';

const L = (ar: string) => ar;
type E = { href: string };
const hrefs = (x: E[]) => x.map(e => e.href);
const owner = { role: 'owner', dashboards: [], modules: [], approver: true };

describe('fold', () => {
  it('folds Arabic spellings and diacritics', () => {
    expect(fold('الإعـدادات')).toBe(fold('الاعدادات'));
    expect(fold('لوحةُ القرارات')).toBe(fold('لوحه القرارات'));
    expect(fold('مستوى')).toBe(fold('مستوي'));
    expect(fold('  Approvals ')).toBe('approvals');
  });
});

describe('search', () => {
  const list = [
    { label: 'لوحة القرارات', hint: 'القرارات', href: '/control/', kind: 'page' },
    { label: 'الاعتمادات', hint: 'ينتظر اعتمادك', href: '/approvals/', kind: 'page' },
    { label: 'منشور جديد', hint: 'النشر', href: '/social/?new=1', kind: 'action' },
  ];
  it('every word must appear; label starts first', () => {
    expect(hrefs(search(list, 'قرار'))).toEqual(['/control/']);
    expect(hrefs(search(list, 'الاعتماد'))[0]).toBe('/approvals/');
    expect(hrefs(search(list, 'منشور نشر'))).toEqual(['/social/?new=1']);
    expect(search(list, 'xyz')).toEqual([]);
    expect(search(list, '')).toHaveLength(3);
  });
});

describe('entries', () => {
  it('only what the user may open: approvals for approvers, actions by dashboard, no duplicates', () => {
    const own = entries(owner, L, sections as never);
    expect(own.some(e => e.href === '/approvals/')).toBe(true);
    expect(own.some(e => e.href === '/control/new/')).toBe(true);
    expect(new Set(own.map(e => e.href)).size).toBe(own.length);
    const nobody = entries({ role: 'member', dashboards: [], modules: [], approver: false }, L, sections as never);
    expect(nobody.some(e => e.href === '/approvals/' || e.href === '/control/new/' || e.href === '/social/?new=1')).toBe(false);
  });
});

describe('before the user is known', () => {
  it('lists the always-open pages without failing', () => {
    expect(entries(null as never, L, sections as never).map(e => e.href)).toEqual(['/settings/', '/account/']);
  });
});
