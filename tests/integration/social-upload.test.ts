// The size-limit path end to end, with synthetic files only: a 60 MB fake video is streamed through the upload route and
// the biggest piece the (fake) bucket ever sees is one 64 KB chunk, never the file. Oversized files are refused from the
// header before any of the body is read. No network, no real data.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../src/lib/auth';
import { upload } from '../../src/modules/social/routes';
import { VIDEO_MAX } from '../../src/modules/social/media';
import { fakeR2, synthetic, MP4_HEAD } from '../shared/fake-r2';

const CO = '00000000-0000-0000-0000-000000000001';
const E: A.AuthEnv = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'leen@example.com' };
const cfg = A.env(E);
const leen: A.Profile = { id: '11111111-1111-1111-1111-111111111111', email: 'leen@example.com', active: true, company_id: CO };
afterEach(() => { vi.unstubAllGlobals(); });

async function send(size: number, declared: number) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([leen]))));
  const r2 = fakeR2();
  const cookie = `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(leen, cfg), cfg.secret))}`;
  const req = new Request('https://well.example/api/social/upload', { method: 'POST', duplex: 'half',
    headers: { cookie, origin: 'https://well.example', 'sec-fetch-site': 'same-origin', 'content-type': 'video/mp4', 'content-length': String(declared) },
    body: synthetic(size, MP4_HEAD) } as RequestInit);
  const res = await upload.POST(req, { ...E, FILES: r2.bucket } as unknown as A.AuthEnv);
  return { res, r2 };
}

describe('social upload limits', () => {
  it('streams a 60 MB video to R2 without ever holding it', async () => {
    const size = 60 * 1024 * 1024;
    const { res, r2 } = await send(size, size);
    expect(res.status).toBe(200);
    expect([...r2.objs.values()][0]?.size).toBe(size);
    expect(r2.stat.maxChunk).toBeLessThanOrEqual(65536);
    expect(r2.stat.bufferedPuts).toBe(0);
  });
  it('refuses a 100 MB video from its header, before reading', async () => {
    const { res, r2 } = await send(1024, 100 * 1024 * 1024);
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: string }).error).toContain('64 ميقا');
    expect(r2.stat.puts).toBe(0);
    expect(VIDEO_MAX).toBe(64 * 1024 * 1024);
  });
});
