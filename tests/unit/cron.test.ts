import { describe, expect, it, vi } from 'vitest';
import { DISPATCH_URL, dispatchRefresh } from '../../src/lib/cron';

describe('cron dispatch', () => {
  it('starts refresh.yml on main with the token', async () => {
    const f = vi.fn(async () => new Response(null, { status: 204 }));
    expect(await dispatchRefresh({ GH_DISPATCH_TOKEN: 'tok' }, f as unknown as typeof fetch)).toBe(204);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(DISPATCH_URL);
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer tok');
    expect(JSON.parse(String(init.body))).toEqual({ ref: 'main' });
  });
  it('does nothing without a token', async () => {
    const f = vi.fn();
    expect(await dispatchRefresh({}, f as unknown as typeof fetch)).toBe(0);
    expect(f).not.toHaveBeenCalled();
  });
  it('a failed dispatch is saved for the health page, a good one too', async () => {
    const put = vi.fn(async () => ({}));
    const files = { put };
    await dispatchRefresh({ GH_DISPATCH_TOKEN: 't', FILES: files }, (async () => new Response('no', { status: 403 })) as unknown as typeof fetch);
    expect(JSON.parse(String((put.mock.calls[0] as unknown[])[1]))).toMatchObject({ ok: false, status: 403 });
    await dispatchRefresh({ GH_DISPATCH_TOKEN: 't', FILES: files }, (async () => new Response(null, { status: 204 })) as unknown as typeof fetch);
    expect(JSON.parse(String((put.mock.calls[1] as unknown[])[1]))).toMatchObject({ ok: true, status: 204 });
  });
  it('a network error or a missing token is a failure signal too, and a broken bucket does not throw', async () => {
    const put = vi.fn(async () => { throw new Error('r2'); });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await dispatchRefresh({ GH_DISPATCH_TOKEN: 't', FILES: { put } }, (async () => { throw new Error('net'); }) as unknown as typeof fetch)).toBe(0);
    expect(await dispatchRefresh({ FILES: { put } })).toBe(0);
    expect(put).toHaveBeenCalledTimes(2);
    err.mockRestore();
  });
});
