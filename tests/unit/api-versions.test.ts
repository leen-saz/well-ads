// Ad-platform API versions: one version per platform across the Python pipeline and the Worker, and every version in
// use has its end of support written down here with the public page it came from.
// Why: the version string is repeated in many files in two languages, so an upgrade can easily miss one, and nothing
// said when a version runs out. No clock in this test on purpose: it fails only when the code changes (a partial
// upgrade, or a version nobody looked up), never on its own on a quiet day.
// Files are read through Vite (?raw): node:fs breaks typecheck.
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';

const found = import.meta.glob(['../../pipeline/**/*.py', '../../src/**/*.{ts,tsx,astro}', '!../../pipeline/tests/**', '!../../src/**/*.test.ts'],
  { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

type Platform = 'meta' | 'google_ads' | 'snap' | 'tiktok';
const PATTERNS: Record<Platform, RegExp> = {
  meta: /(?:graph|www)\.facebook\.com\/(v\d+\.\d+)\b/g,
  google_ads: /googleads\.googleapis\.com\/(v\d+)\b/g,
  snap: /adsapi\.snapchat\.com\/(v\d+)\b/g,
  tiktok: /business-api\.tiktok\.com\/open_api\/(v\d+\.\d+)\b/g,
};

// End of support per version in use, as the platform publishes it. `until` is an ISO date, the last day of the month
// when the page gives only a month, or null when no end date was found. `source` is null only when no public page could
// be read, and the note must then say so.
// Changing a version in the code means adding its row here (look the date up, do not copy the old one).
const SUPPORT: Record<Platform, Record<string, { until: string | null; note: string; source: string | null; checked: string }>> = {
  meta: {
    'v23.0': {
      until: '2026-06-09',
      note: 'Marketing API end date (ads calls). The same version stays available for non-ads Graph calls until 2027-10-08. '
        + 'Past its Marketing API end date: Meta says such calls "may fail or be upgraded to the next available version". Upgrade is a deferred proposal.',
      source: 'https://developers.facebook.com/docs/graph-api/changelog/versions',
      checked: '2026-11-13',
    },
  },
  google_ads: {
    v24: { until: '2027-05-31', note: 'Sunset month: May 2027. Google does not upgrade calls: a sunset version returns errors.', source: 'https://developers.google.com/google-ads/api/docs/sunset-dates', checked: '2026-11-13' },
  },
  snap: {
    v1: { until: null, note: 'The public changelog names no version and no end date for v1 (it does announce field changes, read it each round).', source: 'https://developers.snap.com/api/marketing-api/Ads-API/changelog', checked: '2026-11-13' },
  },
  tiktok: {
    'v1.3': { until: null, note: 'Not confirmed: the public docs portal renders in the browser only, so no end date could be read on the checked day.', source: null, checked: '2026-11-13' },
  },
};

const used = (p: Platform) => {
  const by = new Map<string, string[]>();
  for (const [file, text] of Object.entries(found)) {
    for (const m of text.matchAll(PATTERNS[p])) by.set(m[1] as string, [...(by.get(m[1] as string) ?? []), file.replace('../../', '')]);
  }
  return by;
};

describe('ad-platform API versions', () => {
  it('reads the pipeline and the Worker sources', () => {
    expect(Object.keys(found).some(f => f.endsWith('pipeline/fetch_data.py'))).toBe(true);
    expect(Object.keys(found).some(f => f.endsWith('src/lib/connectors.ts'))).toBe(true);
  });

  for (const p of Object.keys(PATTERNS) as Platform[]) {
    const by = used(p);
    it(`${p}: one version everywhere`, () => {
      const seen = [...by].map(([v, files]) => `${v}: ${[...new Set(files)].join(', ')}`);
      expect(by.size, `more than one ${p} API version in use (a partial upgrade?)\n${seen.join('\n')}`).toBe(1);
    });
    it(`${p}: the version in use has its end of support recorded with a public source`, () => {
      for (const v of by.keys()) {
        const row = SUPPORT[p][v];
        expect(row, `${p} ${v} is used in the code but has no row in SUPPORT: look up its end of support and add it`).toBeTruthy();
        if (row!.source === null) expect(row!.note).toMatch(/^Not confirmed/);
        else expect(row!.source).toMatch(/^https:\/\//);
        expect(row!.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        if (row!.until !== null) expect(Number.isNaN(Date.parse(row!.until))).toBe(false);
      }
    });
    it(`${p}: no leftover row for a version the code no longer uses`, () => {
      expect(Object.keys(SUPPORT[p]).filter(v => !by.has(v))).toEqual([]);
    });
  }
});
