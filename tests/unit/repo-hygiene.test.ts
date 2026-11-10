// The repo is public: a file that .gitignore lists but git still tracks (it was committed before the rule) keeps
// publishing whatever it holds. Runs inside `npm run test:unit`, so the required "ci / gate" check fails on it.
// Fix: git rm --cached <path> (the file stays on disk, the build regenerates it).
import { describe, expect, it } from 'vitest';

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
