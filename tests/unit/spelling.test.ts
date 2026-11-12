// One spelling per word across the interface: «انستقرام» (not إنستغرام/إنستجرام/انستجرام), «النتائج» (not النتايج),
// «الإقفالات» (not الاقفالات). The data pipeline's own dashboard (pipeline/) keeps its text until its fixtures move with it.
import { describe, expect, it } from 'vitest';

const SOURCES = import.meta.glob(['../../src/**/*.{ts,tsx,js,astro}', '../../public/**/*.js'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const WRONG = /إنستغرام|إنستجرام|انستجرام|نتايج|(?<![؀-ۿ])ا?ل?اقفال|(?<=ال)اقفال/;
// the dictionary keeps the old spellings on purpose: text still arriving from the data pipeline is written that way
const ALLOWED = [/i18n-en\.js$/, /\.test\.ts$/];

describe('spelling', () => {
  it('uses one spelling for انستقرام, النتائج and الإقفالات', () => {
    const bad: string[] = [];
    for (const [path, src] of Object.entries(SOURCES)) {
      if (ALLOWED.some(re => re.test(path))) continue;
      src.split('\n').forEach((line, i) => { if (WRONG.test(line)) bad.push(`${path.replace('../../', '')}:${i + 1}: ${line.trim().slice(0, 100)}`); });
    }
    expect(bad).toEqual([]);
  });
});
