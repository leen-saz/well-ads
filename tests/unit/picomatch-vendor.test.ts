// picomatch is vendored with an upstream ReDoS fix (vendor/picomatch/WELL-PATCH.md, GHSA-fc5q-39xc-vjpf) because no patched release exists.
// Part 1 proves the copy that npm installs is the patched one; part 2 keeps the vendoring from being removed or bypassed by accident.
// No network: whether upstream has shipped the fix is a manual check, see the removal rule in WELL-PATCH.md.
import { describe, expect, it } from 'vitest';

// No @types/node here, so node modules load through a variable specifier (same trick as repo-hygiene.test.ts).
const fsm = 'node:fs', modm = 'node:module';
const { existsSync, readFileSync } = (await import(/* @vite-ignore */ fsm)) as { existsSync: (p: string) => boolean; readFileSync: (p: string, e: 'utf8') => string };
const { createRequire } = (await import(/* @vite-ignore */ modm)) as { createRequire: (u: string) => { resolve: (id: string) => string; (id: string): unknown } };
const require = createRequire(import.meta.url);
const picomatch = require('picomatch') as ((glob: string, opts?: object) => (s: string) => boolean) & {
  isMatch: (s: string, glob: string, opts?: object) => boolean;
  makeRe: (glob: string, opts?: object) => RegExp;
};
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

describe('vendored picomatch: GHSA-fc5q-39xc-vjpf', () => {
  const input = 'a'.repeat(50) + 'b';

  it('rejects ReDoS-style single-branch repeated extglobs quickly', () => {
    for (const pattern of ['+(*a)', '*(*a)', '+(*a)c', 'x+(*a)']) {
      const start = performance.now();
      expect(picomatch.isMatch(input, pattern)).toBe(false);
      expect(performance.now() - start, `${pattern} took too long`).toBeLessThan(100);
    }
  });

  it('does not nest quantifiers in the generated regex', () => {
    for (const pattern of ['+(*)', '+(*a)', '*(*a)', '+(a*)', '+(a*b)', '*(*.js)']) {
      expect(picomatch.makeRe(pattern).source, pattern).not.toMatch(/\)[+*]/);
    }
  });

  it('keeps matching results correct for those patterns', () => {
    expect(picomatch.isMatch('abc', '+(*)c')).toBe(true);
    expect(picomatch.isMatch('aaa', '+(*a)')).toBe(true);
    expect(picomatch.isMatch('a.a', '+(*a)')).toBe(true);
    expect(picomatch.isMatch('ab', '+(*a)')).toBe(false);
    expect(picomatch.isMatch('axbayb', '+(a*b)')).toBe(true);
    expect(picomatch.isMatch('axbay', '+(a*b)')).toBe(false);
    expect(picomatch.isMatch('foo.js', '*(*.js)')).toBe(true);
    expect(picomatch.isMatch('foo.ts', '*(*.js)')).toBe(false);
  });

  it('still matches ordinary globs (smoke)', () => {
    expect(picomatch.isMatch('src/a/b.ts', 'src/**/*.ts')).toBe(true);
    expect(picomatch.isMatch('src/a/b.js', 'src/**/*.ts')).toBe(false);
    expect(picomatch.isMatch('a.md', '*.{md,txt}')).toBe(true);
    expect(picomatch.isMatch('b.txt', '*.{md,txt}')).toBe(true);
    expect(picomatch.isMatch('c.png', '*.{md,txt}')).toBe(false);
    expect(picomatch.isMatch('foo.js', '!(bar).js')).toBe(true);
    expect(picomatch('x/*')('x/y')).toBe(true);
  });
});

describe('picomatch vendoring stays in place', () => {
  it('resolves to the vendored, patched copy', () => {
    const installed = json(require.resolve('picomatch/package.json'));
    expect(installed.version).toBe('4.0.8-well.1');
    expect(require.resolve('picomatch')).toMatch(/vendor\/picomatch\//);
  });

  it('package.json points at it and every dependent shares it', () => {
    const pkg = json('package.json');
    expect(pkg.devDependencies.picomatch).toBe('file:vendor/picomatch');
    expect(pkg.overrides.picomatch).toBe('$picomatch');
    const lock = json('package-lock.json').packages;
    expect(lock['node_modules/picomatch']).toMatchObject({ resolved: 'vendor/picomatch', link: true });
    const copies = Object.keys(lock).filter((k) => /(^|\/)node_modules\/picomatch$/.test(k));
    expect(copies, 'no second picomatch copy may appear in the lockfile').toEqual(['node_modules/picomatch']);
  });

  it('keeps the patch note, the license and the fix', () => {
    const note = readFileSync('vendor/picomatch/WELL-PATCH.md', 'utf8');
    expect(note).toContain('https://github.com/micromatch/picomatch/pull/237');
    expect(note).toContain('GHSA-fc5q-39xc-vjpf');
    expect(note).toMatch(/Removal rule/);
    expect(existsSync('vendor/picomatch/LICENSE')).toBe(true);
    expect(readFileSync('vendor/picomatch/lib/parse.js', 'utf8')).toContain('isSelfRepeatingStarBranch');
  });
});
