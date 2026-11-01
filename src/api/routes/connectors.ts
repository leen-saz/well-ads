// /api/connectors/*. Port of web/lib/routes/connectors/*.js (#43). Values go to Supabase Vault through the
// service-role-only RPCs of 005_connectors.sql and never come back to the browser; audit logs names only.
import {
  env, sb, json, html, readJson, handle, requireUser, audit, sign, verify, readCookie, loadProfile, sessionFor, can,
  type AuthEnv, type Cfg, type Session,
} from '../../lib/auth';
import { PLATFORMS, OAUTH, byId, appCreds, authorizeUrl, exchange, oauth1, check, type Platform, type Values, type Exchanged } from '../../lib/connectors';

type Row = Record<string, unknown>;
const rows = (d: unknown): Row[] => (Array.isArray(d) ? (d as Row[]) : []);
const vars = (e: AuthEnv) => e as unknown as Record<string, unknown>;

const OAUTH_COOKIE = '__Secure-well_oauth'; // not __Host-: its path is /api/connectors/ only
const redirectFor = (request: Request) => new URL('/api/connectors/callback', request.url).toString();

// ---- Vault writes (vault.js)
async function saveValues(cfg: Cfg, user: Session, p: Platform, method: 'key' | 'oauth', values: Values,
  { shown = {}, expiresIn = null, checked = null }: { shown?: Values; expiresIn?: number | null; checked?: string | null } = {}): Promise<void> {
  const names = Object.keys(values);
  for (const name of names) {
    const r = await sb(cfg, '/rest/v1/rpc/connector_put', { method: 'POST', admin: true, body: { p_name: name, p_value: values[name] } });
    if (!r.ok) throw new Error('vault write failed');
  }
  const old = await sb(cfg, `/rest/v1/connections?platform=eq.${encodeURIComponent(p.id)}&select=names,shown`, { admin: true });
  const prev = (old.ok ? rows(old.data)[0] : undefined) || { names: [], shown: {} };
  const row: Row = {
    platform: p.id, method, names: [...new Set([...((prev.names as string[]) || []), ...names])], shown: { ...((prev.shown as Values) || {}), ...shown },
    connected_by: user.email, connected_at: new Date().toISOString(), checked,
  };
  if (expiresIn) row.expires_at = new Date(Date.now() + expiresIn * 1000).toISOString();
  else if (method === 'key') row.expires_at = null;
  const w = await sb(cfg, '/rest/v1/connections', { method: 'POST', admin: true, headers: { Prefer: 'return=minimal,resolution=merge-duplicates' }, body: row });
  if (!w.ok) throw new Error('connections write failed');
  await audit(cfg, user, 'connector_saved', { target: { platform: p.id, method, names } });
}

async function dropPlatform(cfg: Cfg, user: Session, p: Platform): Promise<void> {
  const old = await sb(cfg, `/rest/v1/connections?platform=eq.${encodeURIComponent(p.id)}&select=names`, { admin: true });
  const names = ((old.ok ? rows(old.data)[0] : undefined)?.names as string[] | undefined) || [];
  if (names.length) await sb(cfg, '/rest/v1/rpc/connector_drop', { method: 'POST', admin: true, body: { p_names: names } });
  await sb(cfg, `/rest/v1/connections?platform=eq.${encodeURIComponent(p.id)}`, { method: 'DELETE', admin: true });
  await audit(cfg, user, 'connector_removed', { target: { platform: p.id, names } });
}

// ---- list: platforms and their status. No secret value: names, status and account ids only.
export const list = {
  GET: handle(async (request, e) => {
    const { cfg } = await requireUser(request, e, 'connectors');
    const r = await sb(cfg, '/rest/v1/connections?select=platform,method,names,shown,connected_by,connected_at,expires_at,checked', { admin: true });
    if (!r.ok) return json(500, { error: 'ما قدرت أقرأ حالة الربط. تأكد إن 005_connectors.sql انطبق على القاعدة' });
    const by = Object.fromEntries(rows(r.data).map(x => [String(x.platform), x]));
    const platforms = PLATFORMS.map(p => {
      const c = by[p.id] || null;
      const o = OAUTH[p.id];
      const required = p.fields.filter(f => !f.optional && !f.manual).map(f => f.env);
      for (const name of o?.needs || []) if (!required.includes(name)) required.push(name);
      const have = new Set<string>(c ? (c.names as string[]) || [] : []);
      const expires = c?.expires_at as string | null | undefined;
      // mcp ملاحظة ثانوية في الواجهة. الشارة تتبع المفتاح المحفوظ: مربوط فقط بعد ما ينحفظ.
      const status = !c ? 'none' : expires && new Date(expires) < new Date() ? 'expired' : required.every(n => have.has(n)) ? 'ok' : 'partial';
      const shown = (c?.shown as Values | undefined) || {};
      return {
        id: p.id, name: p.name, group: p.group, fetch: !!p.fetch, mcp: !!p.mcp, docs: p.docs, help: p.help,
        oauth: !!o, oauthReady: !!(o && appCreds(p, vars(e))), expiresNote: o?.expires || null, logo: p.logo || null, color: p.color || null,
        fields: p.fields.map(f => ({ env: f.env, label: f.label, secret: f.secret, type: f.type, optional: !!f.optional, manual: !!f.manual,
          placeholder: f.placeholder || '', saved: have.has(f.env), shown: !f.secret && c ? shown[f.env] || '' : '' })),
        status, method: c && c.method, by: c && c.connected_by, at: c && c.connected_at, expires: c && c.expires_at, checked: c && c.checked,
      };
    });
    return json(200, { platforms });
  }),
};

// ---- save: keys by hand, per the platform's docs. An empty field keeps the saved value.
const MAX = 20000; // a service account JSON is a few thousand characters
export const save = {
  POST: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'connectors', { write: true });
    const body = await readJson(request, 100000);
    const p = byId(body.platform);
    if (!p || p.mcp) return json(400, { error: 'منصة غير معروفة' });
    const given = (body.values && typeof body.values === 'object' ? body.values : {}) as Row;
    const values: Values = {}, shown: Values = {};
    for (const f of p.fields) {
      const raw = given[f.env];
      const v = typeof raw === 'string' ? raw.trim() : '';
      if (!v) continue;
      if (v.length > MAX) return json(400, { error: `${f.label}: القيمة طويلة` });
      values[f.env] = v;
      if (!f.secret) shown[f.env] = v;
    }
    if (!Object.keys(values).length) return json(400, { error: 'عبّئ خانة وحدة على الأقل' });
    const t = await check(p, values).catch(() => ({ ok: false, msg: 'ما قدرت أجرّب المفتاح' }));
    if (t && !t.ok) return json(400, { error: t.msg });
    await saveValues(cfg, user, p, 'key', values, { shown, checked: t ? t.msg : null });
    return json(200, { ok: true, checked: t ? t.msg : null });
  }),
};

// ---- disconnect: wipes the platform's values and status. The pipeline falls back to old GitHub secrets if any.
export const disconnect = {
  POST: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'connectors', { write: true });
    const p = byId((await readJson(request)).platform);
    if (!p) return json(400, { error: 'منصة غير معروفة' });
    await dropPlatform(cfg, user, p);
    return json(200, { ok: true });
  }),
};

// ---- start: the "Connect" button. Signed state tied to a short SameSite=Lax nonce cookie (it comes back with the platform's redirect).
export const start = {
  GET: handle(async (request, e) => {
    const { cfg, user } = await requireUser(request, e, 'connectors');
    const p = byId(new URL(request.url).searchParams.get('platform'));
    const o = p ? OAUTH[p.id] : undefined;
    if (!p || !o) return html(400, 'المنصة ما تدعم زر الربط.');
    const app = appCreds(p, vars(e));
    if (!app) return html(400, 'بيانات تطبيق المنصة ناقصة في إعدادات السيرفر. أضفها كأسرار في Cloudflare.');
    const nonce = crypto.randomUUID();
    const state = await sign({ uid: user.uid, p: p.id, n: nonce, exp: Date.now() + 10 * 60 * 1000 }, cfg.secret);
    let location = authorizeUrl(p, { id: app.id, redirect: redirectFor(request), state }), cookie = nonce;
    if (o.v1) { // X: request token first; its temporary secret stays in the cookie until the redirect back
      const rt = await oauth1(o.request as string, { key: app.id, secret: app.secret, extra: { oauth_callback: `${redirectFor(request)}?state=${encodeURIComponent(state)}` } });
      location = `${o.authorize}?oauth_token=${encodeURIComponent(rt.oauth_token ?? '')}`;
      cookie = `${nonce}.${rt.oauth_token_secret ?? ''}`;
    }
    return new Response(null, { status: 302, headers: {
      location,
      'set-cookie': `${OAUTH_COOKIE}=${encodeURIComponent(cookie)}; Path=/api/connectors/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
      'cache-control': 'no-store',
    } });
  }),
};

// ---- callback: the platform's redirect. The Strict session cookie does not come with a cross-site redirect,
// so the signed state + nonce cookie prove the request, and the user's rights are read from the DB.
// After saving, a small page navigates back to the connectors page (same-site, so the session works again).
const back = (to: string, cookieOff: boolean) => new Response(
  `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${to}"><title>Well</title><p style="font-family:system-ui;padding:40px">جاري الرجوع لصفحة الربط…</p>`,
  { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
    ...(cookieOff ? { 'set-cookie': `${OAUTH_COOKIE}=; Path=/api/connectors/; HttpOnly; Secure; SameSite=Lax; Max-Age=0` } : {}) } });

type State = { uid?: string; p?: string; n?: string };

export const callback = {
  GET: async (request: Request, e: AuthEnv): Promise<Response> => {
    let cfg: Cfg;
    try { cfg = env(e); } catch { return html(503, 'الإعداد غير مكتمل.'); }
    const q = new URL(request.url).searchParams;
    const st = (await verify(q.get('state'), cfg.secret)) as unknown as State | null;
    const [nonce, tokenSecret] = (readCookie(request, OAUTH_COOKIE) || '').split('.');
    if (!st || !st.p || !st.uid || !nonce || st.n !== nonce) return back('/connectors/?err=state', true);
    const p = byId(st.p);
    const o = OAUTH[st.p];
    const v1 = !!o?.v1;
    const code = q.get('auth_code') || q.get('code') || '';
    if (q.get('error') || q.get('denied') || !(v1 ? q.get('oauth_verifier') : code)) return back(`/connectors/?err=denied&p=${encodeURIComponent(st.p)}`, true);
    const profile = await loadProfile(cfg, st.uid);
    const user = profile && profile.active !== false ? sessionFor(profile, cfg) : null;
    const app = p && appCreds(p, vars(e));
    if (!user || !p || !o || !can(user, 'connectors', cfg) || !app) return back('/connectors/?err=access', true);
    try {
      let got: Exchanged;
      if (v1) {
        const t = await oauth1(o.access as string, { key: app.id, secret: app.secret, token: q.get('oauth_token') || '', tokenSecret: tokenSecret || '', extra: { oauth_verifier: q.get('oauth_verifier') || '' } });
        const s = o.store || {};
        if (!t.oauth_token || !t.oauth_token_secret || !s.token || !s.secret || !s.id || !s.key) throw new Error('no token');
        got = { values: { [s.token]: t.oauth_token, [s.secret]: t.oauth_token_secret, [s.id]: app.id, [s.key]: app.secret } };
      } else {
        got = await exchange(p, { code, redirect: redirectFor(request), ...app });
      }
      await saveValues(cfg, user, p, 'oauth', got.values, { expiresIn: got.expiresIn || null, checked: 'انربط من صفحة المنصة' });
    } catch (err) {
      console.error('connector oauth', p.id, err instanceof Error ? err.message : 'error');
      return back(`/connectors/?err=exchange&p=${encodeURIComponent(p.id)}`, true);
    }
    return back(`/connectors/?ok=${encodeURIComponent(p.id)}`, true);
  },
};
