// Post media: per-company R2 keys, the public /m/ path, upload checks, and serving it back. No network.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../lib/auth';
import { need } from '../../lib/gate';
import { serveSite } from '../../lib/site';
import { mediaKey, mediaPath } from './media';
import { upload } from './routes';

const CO = '00000000-0000-0000-0000-000000000001';
const E: A.AuthEnv = { SUPABASE_URL: 'https://sb.example', SUPABASE_SERVICE_ROLE_KEY: 's', SESSION_SECRET: 'x'.repeat(40), OWNER_EMAIL: 'leen@example.com' };
const cfg = A.env(E);
const leen: A.Profile = { id: '11111111-1111-1111-1111-111111111111', email: 'leen@example.com', active: true, company_id: CO };
afterEach(() => { vi.unstubAllGlobals(); });

describe('post media', () => {
  it('keys are per company and the public path maps back to the same key', () => {
    const k = mediaKey(CO, 'jpg', () => 'a'.repeat(32));
    expect(k).toBe(`social/${CO}/${'a'.repeat(32)}.jpg`);
    expect(mediaPath(`/m/${CO}/${'a'.repeat(32)}.jpg`)).toBe(k);
    expect(mediaPath(`/m/${CO}/../secret.jpg`)).toBeNull();
    expect(mediaPath(`/m/${CO}/${'a'.repeat(32)}.html`)).toBeNull();
    expect(() => mediaKey('nope', 'jpg')).toThrow();
  });

  it('the public path skips the login, everything else under /m/ does not', () => {
    expect(need(`/m/${CO}/${'b'.repeat(32)}.mp4`, '')).toBeNull();
    expect(need(`/m/${CO}/x.mp4`, '')).not.toBeNull();
  });

  it('uploads an image to R2 and refuses other types', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([leen]))));
    const put = vi.fn(async () => ({}));
    const env = { ...E, FILES: { put } } as unknown as A.AuthEnv;
    const cookie = `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(leen, cfg), cfg.secret))}`;
    const req = (type: string) => new Request('https://well.example/api/social/upload', { method: 'POST',
      headers: { cookie, origin: 'https://well.example', 'sec-fetch-site': 'same-origin', 'content-type': type }, body: new Uint8Array([1, 2, 3]) });
    const ok = await upload.POST(req('image/png'), env);
    const j = (await ok.json()) as { url: string; type: string };
    expect(ok.status).toBe(200);
    expect(j.type).toBe('image');
    expect(j.url).toMatch(new RegExp(`^https://well.example/m/${CO}/[0-9a-f]{32}\\.png$`));
    expect((put.mock.calls[0] as unknown[])[0]).toBe('social/' + j.url.split('/m/')[1]);
    expect((await upload.POST(req('text/html'), env)).status).toBe(415);
  });

  it('serves the file publicly with its type', async () => {
    const key = `social/${CO}/${'c'.repeat(32)}.jpg`;
    const bucket = { get: async (k: string) => (k === key ? { body: 'IMG', httpEtag: '"e"', httpMetadata: { contentType: 'image/jpeg' } } : null) } as unknown as R2Bucket;
    const res = await serveSite(new Request(`https://well.example/m/${CO}/${'c'.repeat(32)}.jpg`), bucket);
    expect(res?.status).toBe(200);
    expect(res?.headers.get('content-type')).toBe('image/jpeg');
    expect(await res?.text()).toBe('IMG');
  });
});
