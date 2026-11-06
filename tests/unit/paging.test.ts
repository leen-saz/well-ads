// Big reads: PostgREST cuts every answer at 1000 rows, so a `limit=` above that is a silent truncation and unordered
// Range pages can skip or repeat rows. Reads go through readAll (src/lib/paging.ts).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../src/lib/auth';
import { readAll } from '../../src/lib/paging';

const cfg = env({ SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'o@example.com' });
afterEach(() => { vi.unstubAllGlobals(); });

// A table of n rows that answers like PostgREST: at most 1000 rows, the Range asked for, in the order asked for
function table(n: number) {
  const seen: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    seen.push(url);
    const [a, b] = String((init.headers as Record<string, string>).Range).split('-').map(Number) as [number, number];
    const all = Array.from({ length: n }, (_, i) => ({ id: i }));
    return new Response(JSON.stringify(all.slice(a, Math.min(b, a + 999) + 1)));
  }));
  return seen;
}

describe('readAll', () => {
  it('reads every page, in the order the caller names', async () => {
    const seen = table(2500);
    const r = await readAll<{ id: number }>(cfg, '/rest/v1/ad_metrics?select=id', 'ad_key.asc,day.asc');
    expect(r.rows.length).toBe(2500);
    expect(new Set(r.rows.map(x => x.id)).size).toBe(2500);
    expect(r.full).toBe(true);
    expect(seen.length).toBe(3);
    for (const u of seen) expect(u).toContain('&order=ad_key.asc,day.asc');
  });
  it('says when it stopped at the page limit, and refuses a path that brings its own order', async () => {
    table(5000);
    expect((await readAll(cfg, '/rest/v1/x?select=id', 'id.asc', 2))).toMatchObject({ ok: true, full: false });
    await expect(readAll(cfg, '/rest/v1/x?select=id&order=id.desc', 'id.asc')).rejects.toThrow();
  });
  it('a missing table reads as empty and not ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"code":"42P01"}', { status: 404 })));
    expect(await readAll(cfg, '/rest/v1/nope?select=id', 'id.asc')).toEqual({ ok: false, rows: [], full: false });
  });
});

describe('no read asks for more than the server gives', () => {
  const files = import.meta.glob(['../../src/**/*.ts', '../../src/**/*.astro', '!../../src/**/*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  it('`limit=` in a REST path is at most 1000 (or the read pages)', () => {
    const bad: string[] = [];
    for (const [f, text] of Object.entries(files)) text.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/rest\/v1\/[^`'"]*[?&]limit=(\d+)/g)) if (Number(m[1]) > 1000) bad.push(`${f}:${i + 1} limit=${m[1]}`);
    });
    expect(Object.keys(files).length).toBeGreaterThan(100);
    expect(bad).toEqual([]);
  });
});
