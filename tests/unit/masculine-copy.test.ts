// @ts-expect-error node types are not installed in this project; vitest itself runs on node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The dashboard speaks to the user in the masculine and never names one person as the owner: «المالك», not «المالكة» / «مالكة اللوحة»,
// «المؤثر», and «موافقة المالك», not a name. Page code is scanned; i18n-en.js keeps the old keys on purpose (the server still sends a few).
const walk = (d: string): string[] => readdirSync(d).flatMap((n: string) => { const f = `${d}/${n}`; return statSync(f).isDirectory() ? walk(f) : [f]; });
const files = [...walk('public'), ...walk('src/modules'), ...walk('src/pages')].filter(f => /\.(js|astro)$/.test(f) && !f.endsWith('i18n-en.js'));
const FEMININE = /المالكة|مالكة اللوحة|المؤثرة|مسؤولة اللوحة/;
const BY_NAME = /(?:موافقة|قواعد|قرار|عند) لين(?![؀-ۿ])|لين بس/;

describe('page copy', () => {
  it('has no feminine owner or influencer wording', () => {
    const bad = files.filter(f => FEMININE.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
  it('does not name one person as the approver', () => {
    const bad = files.filter(f => BY_NAME.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });
});
