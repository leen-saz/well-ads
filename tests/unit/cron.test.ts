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
});
