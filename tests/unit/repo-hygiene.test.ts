// The repo is public: a file that .gitignore lists but git still tracks (it was committed before the rule) keeps
// publishing whatever it holds. Runs inside `npm run test:unit`, so the required "ci / gate" check fails on it.
// Fix: git rm --cached <path> (the file stays on disk, the build regenerates it).
import { describe, expect, it } from 'vitest';

// What a public repo may carry: no real people, accounts or ads. The checks only know what an obviously fake value looks like, so they hold
// no real value themselves: anything that is not clearly fake fails and must be replaced (or, if it is truly public, added below with a reason).
const TEXT = /\.(ts|js|mjs|py|astro|json|jsonc|md|yml|yaml|sql|html|css|sh|toml|txt)$/;
const SKIP = /^(package-lock\.json|tests\/parity\/golden\.json|tests\/unit\/repo-hygiene\.test\.ts)$|^node_modules\//;   // the last one holds the sample values of the self-check below
// Email domains a file may contain: reserved example domains, short fake ones used by tests, and mail providers that identify nobody
const EMAIL_OK = /(^|\.)(example\.(com|org|net)|example|test|invalid|localhost)$|^(x|b|e|f|d|c|other|acme)\.(co|com)$|^elsewhere\.org$|^(gmail|users\.noreply\.github)\.com$|^(anthropic|github|noreply)\.com$|^[a-z]\.(co|com|test)$/i;
const FAKE_ID = /(\d)\1{6,}/;   // a long run of one digit: 9000000000000000001, 17840000000000001
const FAKE_PHONE = /1234567|(\d)\1{5,}/;   // 0551234567, 966500000000
// A file that still holds a real-looking id on purpose until the change that owns it lands. Remove the entry when it does.
const ID_EXEMPT = new Set(['pipeline/tests/test_report.py']);   // the excluded TikTok account id the page script still carries (data-pull fix PR removes both)

async function tracked(): Promise<{ path: string; text: string }[]> {
  const cp = 'node:child_process', fsm = 'node:fs';
  const { execFileSync } = (await import(/* @vite-ignore */ cp)) as { execFileSync: (c: string, a: string[], o: { encoding: 'utf8'; maxBuffer: number }) => string };
  const { readFileSync } = (await import(/* @vite-ignore */ fsm)) as { readFileSync: (p: string, e: 'utf8') => string };
  let list: string[] = [];
  try { list = execFileSync('git', ['ls-files'], { encoding: 'utf8', maxBuffer: 1 << 26 }).split('\n').filter(Boolean); }
  catch { return []; /* not a git checkout */ }
  return list.filter(f => TEXT.test(f) && !SKIP.test(f)).map(f => { try { return { path: f, text: readFileSync(f, 'utf8') }; } catch { return { path: f, text: '' }; } });
}

describe('repo hygiene: no real contact or account data in a public repo', () => {
  it('every email address uses a reserved, fake or provider domain', async () => {
    const bad: string[] = [];
    for (const { path, text } of await tracked()) {
      for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g)) {
        const domain = m[1] as string;
        if (/\.(png|jpe?g|svg|webp|gif|css|js|map)$/i.test(domain) || /^\d/.test(domain) || /\.[a-z]$/i.test(domain)) continue;   // "icon@2x.png", "pkg@1.2.3", "a@b.c"
        if (!EMAIL_OK.test(domain)) bad.push(`${path}: ${m[0].replace(/^[^@]+/, '…')}`);
      }
    }
    expect([...new Set(bad)], 'a real-looking email domain: replace it with an @example.com style address (the value is hidden here on purpose)').toEqual([]);
  });
  it('no phone number of the real kind (Saudi mobile) in code, tests or docs', async () => {
    const bad: string[] = [];
    for (const { path, text } of await tracked()) {
      if (/\.(sql|json)$/.test(path) && !/fixtures?\//.test(path)) continue;
      for (const m of text.matchAll(/(?<![\d.])(?:\+|00)9665\d{8}(?!\d)|(?<![\d.\-])05\d{8}(?![\d.])/g)) if (!FAKE_PHONE.test(m[0])) bad.push(`${path}: a phone-number-shaped value`);
    }
    expect([...new Set(bad)]).toEqual([]);
  });
  it('test fixtures use obviously fake long ids (a run of one digit), not recorded platform ids', async () => {
    const bad: string[] = [];
    for (const { path, text } of await tracked()) {
      if ((!/^(tests|pipeline\/tests)\//.test(path) && !/\.test\.(ts|js)$/.test(path)) || ID_EXEMPT.has(path)) continue;
      for (const m of text.matchAll(/(?<![\d.])\d{15,20}(?![\d.])/g)) if (!FAKE_ID.test(m[0])) bad.push(`${path}: a ${m[0].length}-digit id that is not obviously fake`);
    }
    expect([...new Set(bad)], 'replace it with an id like 9000000000000000001').toEqual([]);
  });
  it('the check itself recognises fake and real-looking values', () => {
    expect(EMAIL_OK.test('example.com')).toBe(true); expect(EMAIL_OK.test('acme.example')).toBe(true); expect(EMAIL_OK.test('some-company.co')).toBe(false);
    expect(FAKE_PHONE.test('0551234567')).toBe(true); expect(FAKE_PHONE.test('0537294816')).toBe(false);
    expect(FAKE_ID.test('9000000000000000001')).toBe(true); expect(FAKE_ID.test('4821907365518204')).toBe(false);
  });
});

describe('repo hygiene', () => {
  it('no tracked file sits under an ignored path', async () => {
    // The project has no Node type definitions (Workers types only), so the module is loaded by name
    const mod = 'node:child_process';
    const { execFileSync } = (await import(/* @vite-ignore */ mod)) as { execFileSync: (c: string, a: string[], o: { encoding: 'utf8' }) => string };
    let out = '';
    try { out = execFileSync('git', ['ls-files', '-c', '-i', '--exclude-standard'], { encoding: 'utf8' }); }
    catch { return; /* not a git checkout (a source tarball): nothing to check */ }
    expect(out.split('\n').filter(Boolean)).toEqual([]);
  });
});
