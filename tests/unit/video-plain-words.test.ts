// The Video tab's wording: nothing a normal user can read names a secret, a file, Supabase, SQL, a Worker or an API key.
// (The names live in the owner's status card; the browser side is checked in tests/smoke/video-plain.spec.ts.)
/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { SAY } from '../../src/modules/video/jobs';
import { TECH_WORDS } from '../shared/tech-words';

// Nothing a normal user can read in this tab names a secret, a file, Supabase, SQL, a Worker or an API key
describe('plain words', () => {
  const FORBIDDEN = new RegExp(`${TECH_WORDS.source}|HIGGSFIELD|OPENAI|\\.sql|wrangler|\\bkey\\b`, 'i');
  const files = import.meta.glob('../../src/modules/video/{routes,jobs,brief,script,safe-fetch}.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const sources = Object.values(files);
  it('every answer text the routes can send is free of technical words', () => {
    const texts: string[] = Object.values(SAY);
    for (const src of sources) {
      for (const m of src.matchAll(/error:\s*(?:\w+ \? )?'([^']+)'|NOT_READY\s*=\s*'([^']+)'/g)) texts.push(m[1] || m[2] || '');
    }
    expect(texts.length).toBeGreaterThan(10);
    expect(texts.filter(t => FORBIDDEN.test(t))).toEqual([]);
  });
  it('a missing table answers with the one plain sentence, for everyone', () => {
    for (const [f, src] of Object.entries(files)) expect(src, f).not.toMatch(/notApplied|notEnabled/);
  });
});
