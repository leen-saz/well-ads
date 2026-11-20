// Gemini Files API: every call has a deadline, and a slow or overloaded provider says «busy» instead of hanging the transcription job.
import { describe, expect, it, vi } from 'vitest';
import { GEMINI_FILE_MS, GEMINI_UPLOAD_MS, deleteFile, fileState, uploadFile } from '../../src/lib/gemini';

const E = { GEMINI_API_KEY: 'k' };
const as = (f: unknown) => f as typeof fetch;
const body = () => new Response('x').body!;
const sig = (f: ReturnType<typeof vi.fn>, n: number) => (f.mock.calls[n] as unknown as [string, RequestInit])[1].signal;
const expired = () => vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => { const c = new AbortController(); c.abort(); return c.signal; });

describe('Gemini Files API deadlines', () => {
  it('the upload bytes get a longer deadline than the small calls', () => {
    expect(GEMINI_UPLOAD_MS).toBeGreaterThan(GEMINI_FILE_MS);
  });
  it('uploadFile passes a signal on both requests', async () => {
    const f = vi.fn(async (u: string) => u.includes('/upload/') ? new Response('{}', { headers: { 'x-goog-upload-url': 'https://up.example/x' } }) : new Response(JSON.stringify({ file: { name: 'files/a', uri: 'u', state: 'ACTIVE' } })));
    await uploadFile(E, body(), 'audio/mpeg', 1, 't', as(f));
    expect(sig(f, 0)).toBeInstanceOf(AbortSignal); expect(sig(f, 1)).toBeInstanceOf(AbortSignal);
  });
  it('a stalled upload is busy, and 503 is busy while 500 stays failed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const spy = expired();
    await expect(uploadFile(E, body(), 'audio/mpeg', 1, 't', as(async () => { throw new Error('aborted'); }))).rejects.toMatchObject({ code: 'rate_limited' });
    spy.mockRestore();
    await expect(uploadFile(E, body(), 'audio/mpeg', 1, 't', as(async () => new Response('', { status: 503 })))).rejects.toMatchObject({ code: 'rate_limited' });
    await expect(uploadFile(E, body(), 'audio/mpeg', 1, 't', as(async () => new Response('', { status: 500 })))).rejects.toMatchObject({ code: 'failed', status: 500 });
    warn.mockRestore();
  });
  it('fileState: signal passed, timeout and 503 are busy, 404 stays failed', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ name: 'files/a', uri: 'u', state: 'ACTIVE' })));
    await fileState(E, 'files/a', 'audio/mpeg', as(f));
    expect(sig(f, 0)).toBeInstanceOf(AbortSignal);
    await expect(fileState(E, 'files/a', 'audio/mpeg', as(async () => new Response('', { status: 503 })))).rejects.toMatchObject({ code: 'rate_limited' });
    await expect(fileState(E, 'files/a', 'audio/mpeg', as(async () => new Response('', { status: 404 })))).rejects.toMatchObject({ code: 'failed', status: 404 });
    const spy = expired();
    await expect(fileState(E, 'files/a', 'audio/mpeg', as(async () => { throw new Error('aborted'); }))).rejects.toMatchObject({ code: 'rate_limited' });
    spy.mockRestore();
  });
  it('deleteFile: signal passed, a hung delete returns false instead of throwing', async () => {
    const f = vi.fn(async () => new Response('{}'));
    expect(await deleteFile(E, 'files/a', as(f))).toBe(true);
    expect(sig(f, 0)).toBeInstanceOf(AbortSignal);
    const spy = expired();
    expect(await deleteFile(E, 'files/a', as(async () => { throw new Error('aborted'); }))).toBe(false);
    spy.mockRestore();
  });
});
