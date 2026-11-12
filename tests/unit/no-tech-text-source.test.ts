// What a normal user reads must never name a Worker secret, a SQL file, Supabase, Cloudflare, RLS or a raw HTTP code.
// Two guards:
//  1. The helpers that build "not set up yet" messages (notApplied, notEnabled, gemini's notReady) answer in plain words
//     for every role, the owner included; the file or key to fix goes to the logs and to the owner-only pages.
//  2. A scan of every Arabic string literal in src/ and public/: none may carry a technical name, except the files below,
//     which are owner-only (Connectors, Data health, Permissions, the model routing table) or not shown as page text.
import { describe, expect, it, vi } from 'vitest';
import { notApplied, notEnabled } from '../../src/lib/auth';
import { notReady } from '../../src/lib/gemini';
import { TECH_WORDS } from '../shared/tech-words';

const TECH = /\b[A-Z][A-Z0-9]{2,}_(?:KEY|SECRET|TOKEN|SID|URL)\b|\.sql\b|Supabase|SQL Editor|\bRLS\b|Cloudflare|\bWorkers?\b|\bR2\b|PGRST|stack ?trace|HTTP ?\d{3}|الجدول ناقص|مايقريشن|متغيرات البيئة/;

describe('"not set up yet" messages are plain for every role', () => {
  for (const role of ['member', 'owner']) {
    it(`${role}: no file name, secret name or service name`, () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const said = [notApplied({ role }, '034_video.sql'), notApplied({ role }, 'migration 015_copy.sql'), notEnabled({ role }, 'توليد الصوت', 'GEMINI_API_KEY'),
        notEnabled({ role }, 'المدير', 'PAPERCLIP_URL و PAPERCLIP_TOKEN'), notReady({ role }), notReady({ role }, 'OPENAI_API_KEY')];
      for (const s of said) { expect(s).not.toMatch(TECH); expect(s).not.toMatch(TECH_WORDS); }
    });
  }
  it('the file and the key still reach the logs', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    notApplied({ role: 'owner' }, '034_video.sql'); notEnabled({ role: 'owner' }, 'x', 'GEMINI_API_KEY');
    expect(warn).toHaveBeenCalledWith('not_applied', '034_video.sql');
    expect(warn).toHaveBeenCalledWith('not_enabled', 'GEMINI_API_KEY');
  });
});

// Owner-only or technical on purpose (a normal user cannot open them), or not page text
const ALLOWED = [
  /^src\/lib\/connectors\.ts$/, /^src\/api\/routes\/connectors\.ts$/, /connectors?\//i, /^public\/assets\/connectors\.js$/,   // the Connectors page
  /^public\/modules\/health\//, /^src\/modules\/maestro\/(schema|datahealth|health)\.ts$/, /^src\/lib\/(health|migrations-list)\.ts$/,   // data health, owner only
  /^public\/assets\/admin\.js$/, /^src\/modules\/maestro\/models\.ts$/, /^src\/lib\/watchdog\.ts$/,                               // permissions, model routing, the owner's alert email
  /\.test\.ts$/, /^public\/assets\/i18n-en\.js$/,
  /^src\/modules\/video\//, /^public\/modules\/video\//,                                    // the Video tab is handled by its own agent
  /^src\/modules\/(design\/motion|listening\/social)\.ts$/,                                  // SQL text kept as code, not page text
  /^src\/modules\/[^/]+\/skills\.ts$/,
];
// Every source file, as text (Vite reads them; no file-system access needed)
const SOURCES = import.meta.glob(['../../src/**/*.{ts,js,astro}', '../../public/**/*.js'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const LIT = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
describe('no technical name in page text', () => {
  it('scans the source', () => {
    const bad: string[] = []; let seen = 0;
    for (const [path, src] of Object.entries(SOURCES)) {
      const f = path.replace('../../', '');
      if (ALLOWED.some(re => re.test(f))) continue;
      seen++;
      for (const m of src.matchAll(LIT)) {
        const t = m[1] ?? m[2] ?? m[3] ?? '';
        // a bare list of key names is an argument for the logs, not text
        if (/[؀-ۿ]/.test(t) && TECH.test(t) && !/^[A-Z0-9_ و]+$/.test(t)) bad.push(`${f}:${src.slice(0, m.index).split('\n').length}: ${t.slice(0, 90).replace(/\s+/g, ' ')}`);
      }
    }
    expect(seen).toBeGreaterThan(100);
    expect(bad).toEqual([]);
  });
});
