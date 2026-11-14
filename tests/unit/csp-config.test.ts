import { describe, expect, it } from 'vitest';
// @ts-expect-error node types are not installed in this project; vitest itself runs on node
import { readFileSync } from 'node:fs';

// The page scripts play generated voice and preview uploaded pictures from blob: URLs (voice, voiceover, vision, transcribe):
// the CSP must allow exactly that and nothing remote.
const cfg: string = readFileSync('astro.config.mjs', 'utf8');

describe('CSP directives in astro.config.mjs', () => {
  it('lets the page play and show blob: media it made itself', () => {
    expect(cfg).toContain(`"media-src 'self' blob:"`);
    expect(cfg).toContain(`"img-src 'self' data: blob:"`);
  });

  it('keeps everything else closed (no wildcard, no remote origins, no unsafe-eval)', () => {
    expect(cfg).toContain(`"default-src 'self'"`);
    expect(cfg).toContain(`"connect-src 'self'"`);
    expect(cfg).toContain(`"object-src 'none'"`);
    expect(cfg).not.toMatch(/(img|media|script|connect)-src[^"]*(https?:|\*)/);
    expect(cfg).not.toContain('unsafe-eval');
  });
});
