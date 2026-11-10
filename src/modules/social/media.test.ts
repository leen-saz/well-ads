// Post media: per-company R2 keys, the public /m/ path, upload checks, and serving it back. No network.
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as A from '../../lib/auth';
import { need } from '../../lib/gate';
import { serveSite } from '../../lib/site';
import { mediaKey, mediaPath, sniff, IMAGE_MAX, VIDEO_MAX } from './media';
import { fakeR2, PNG_HEAD } from '../../../tests/shared/fake-r2';
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

  it('uploads an image to R2 as a stream and refuses other types', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([leen]))));
    const r2 = fakeR2();
    const env = { ...E, FILES: r2.bucket } as unknown as A.AuthEnv;
    const cookie = `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(leen, cfg), cfg.secret))}`;
    const req = (type: string, body: Uint8Array = new Uint8Array([...PNG_HEAD, 1, 2, 3])) => new Request('https://well.example/api/social/upload', { method: 'POST',
      headers: { cookie, origin: 'https://well.example', 'sec-fetch-site': 'same-origin', 'content-type': type, 'content-length': String(body.byteLength) }, body: body as unknown as BodyInit });
    const ok = await upload.POST(req('image/png'), env);
    const j = (await ok.json()) as { url: string; type: string };
    expect(ok.status).toBe(200);
    expect(j.type).toBe('image');
    expect(j.url).toMatch(new RegExp(`^https://well.example/m/${CO}/[0-9a-f]{32}\\.png$`));
    expect([...r2.objs.keys()][0]).toBe('social/' + j.url.split('/m/')[1]);
    expect(r2.stat.bufferedPuts).toBe(0);                                  // a stream went to R2, not a buffer
    expect((await upload.POST(req('text/html'), env)).status).toBe(415);
    // a text file renamed as a photo: refused by its first bytes and removed again
    const fake = await upload.POST(req('image/png', new TextEncoder().encode('<html>not a png</html>')), env);
    expect(fake.status).toBe(415);
    expect(r2.objs.size).toBe(1);
  });

  it('says how big a file may be before reading it (header only)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([leen]))));
    const r2 = fakeR2();
    const env = { ...E, FILES: r2.bucket } as unknown as A.AuthEnv;
    const cookie = `${A.SESSION}=${encodeURIComponent(await A.sign(A.sessionFor(leen, cfg), cfg.secret))}`;
    let read = false;
    const lying = (type: string, len: number) => new Request('https://well.example/api/social/upload', { method: 'POST', duplex: 'half',
      headers: { cookie, origin: 'https://well.example', 'sec-fetch-site': 'same-origin', 'content-type': type, 'content-length': String(len) },
      body: new ReadableStream({ pull(c) { read = true; c.close(); } }, { highWaterMark: 0 }) } as RequestInit);
    const img = await upload.POST(lying('image/jpeg', IMAGE_MAX + 1), env);
    expect(img.status).toBe(413);
    expect(((await img.json()) as { error: string }).error).toBe('الصورة أكبر من 8 ميقا. صغّرها وارفعها مرة ثانية');
    const vid = await upload.POST(lying('video/mp4', VIDEO_MAX + 1), env);
    expect(vid.status).toBe(413);
    expect(((await vid.json()) as { error: string }).error).toContain('الفيديو أكبر من 64 ميقا');
    expect(read).toBe(false); expect(r2.stat.puts).toBe(0);                // the body was never touched
    expect((await upload.POST(new Request('https://well.example/api/social/upload', { method: 'POST', headers: { cookie, origin: 'https://well.example', 'sec-fetch-site': 'same-origin', 'content-type': 'image/png', 'content-length': '0' } }), env)).status).toBe(400);
  });

  it('sniffs the real type from the first bytes', () => {
    expect(sniff(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniff(new Uint8Array(PNG_HEAD))).toBe('image/png');
    expect(sniff(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniff(new TextEncoder().encode('\0\0\0\x18ftypisom'))).toBe('video/mp4');
    expect(sniff(new TextEncoder().encode('\0\0\0\x14ftypqt  '))).toBe('video/quicktime');
    expect(sniff(new TextEncoder().encode('<html>'))).toBeNull();
  });

  it('serves a range of a video as 206 and a HEAD without opening the body', async () => {
    const r2 = fakeR2(); const key = `social/${CO}/${'d'.repeat(32)}.mp4`;
    await r2.bucket.put(key, new Blob([new Uint8Array(1000)]).stream(), { httpMetadata: { contentType: 'video/mp4' } });
    const url = `https://well.example/m/${CO}/${'d'.repeat(32)}.mp4`;
    const part = await serveSite(new Request(url, { headers: { range: 'bytes=0-9' } }), r2.bucket);
    expect(part?.status).toBe(206);
    expect(part?.headers.get('content-range')).toBe('bytes 0-9/1000');
    expect(part?.headers.get('content-length')).toBe('10');
    expect(part?.headers.get('accept-ranges')).toBe('bytes');
    expect(part?.headers.get('cache-control')).toContain('immutable');
    const full = await serveSite(new Request(url), r2.bucket);
    expect(full?.status).toBe(200); expect(full?.headers.get('content-length')).toBe('1000');
    const head = await serveSite(new Request(url, { method: 'HEAD' }), r2.bucket);
    expect(head?.status).toBe(200); expect(head?.headers.get('content-length')).toBe('1000'); expect(await head?.text()).toBe('');
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
