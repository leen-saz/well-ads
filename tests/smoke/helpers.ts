import type { APIRequestContext, BrowserContext } from '@playwright/test';
import { PASSWORD, DOMAIN } from './fake-supabase.mjs';

export const emailFor = (who: string) => `${who}@${DOMAIN}`;
// The same ports as playwright.smoke.config.ts: a spec that writes 8787 or 8788 itself breaks a run on other ports
// (SMOKE_PORT / SMOKE_FAKE_PORT), or talks to another checkout's servers when two runs share one machine
export const BASE = `http://localhost:${process.env['SMOKE_PORT'] || 8787}`;
export const FAKE = `http://localhost:${process.env['SMOKE_FAKE_PORT'] || 8788}`;

// Signs in through the real /api/auth/login and returns the session cookie as {name, value}
export async function login(request: APIRequestContext, who: string): Promise<{ name: string; value: string; header: string }> {
  const res = await request.post('/api/auth/login', {
    data: { email: emailFor(who), password: PASSWORD },
    headers: { origin: BASE },
    maxRedirects: 0,
  });
  if (res.status() !== 200) throw new Error(`login for ${who} answered ${res.status()}`);
  const set = res.headers()['set-cookie'] || '';
  const m = set.match(/^([^=]+)=([^;]+)/);
  if (!m) throw new Error('login set no cookie');
  return { name: m[1]!, value: m[2]!, header: `${m[1]}=${m[2]}` };
}

export async function addSession(context: BrowserContext, c: { name: string; value: string }) {
  await context.addCookies([{ name: c.name, value: c.value, domain: 'localhost', path: '/', httpOnly: true, secure: true, sameSite: 'Strict' }]);
}
