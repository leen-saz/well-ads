import type { APIRequestContext, BrowserContext } from '@playwright/test';
import { PASSWORD, DOMAIN } from './fake-supabase.mjs';

export const emailFor = (who: string) => `${who}@${DOMAIN}`;
const BASE = 'http://localhost:8787';

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
